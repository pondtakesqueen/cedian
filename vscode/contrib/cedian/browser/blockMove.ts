/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, DisposableMap, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { GroupDirection, IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ScrollNotes, stillCopy, type StillCopy } from './blocks/copy.js';
import { moving, stretching } from './blocks/motion.js';
import { play, type Playing } from './blocks/resize.js';
import { RESIZED, RESIZING } from './blockStretch.js';
import { edgeBox, ground, holdScroll, moved, OPPOSITE, stretchFrames, type Box, type Card, type Edge } from './blocks/stretch.js';

/** The side blocks, which make room for each other and for the editor's blocks as they come and go. */
const SIDE_PARTS = [Parts.SIDEBAR_PART, Parts.AUXILIARYBAR_PART, Parts.PANEL_PART];

/** Where a block stood, its card (workbench.css: the gaps between groups, and its corners) and its card's ground. */
type Noted = Box & { card: Card; ground: string };

/**
 * A block's card ground as a CSS background: its own colour, and its header's band (an editor
 * group's tab row) carried on across the top, so a block drawn past its content keeps its header.
 */
function groundOf(element: HTMLElement): string {
	const color = mainWindow.getComputedStyle(element).backgroundColor;
	const title = element.querySelector<HTMLElement>(':scope > .title');
	if (title?.offsetHeight) {
		// The tab row is drawn as an image over its colour (modern UI), or by its colour alone.
		const style = mainWindow.getComputedStyle(title);
		const band = style.backgroundImage !== 'none' ? style.backgroundImage : `linear-gradient(${style.backgroundColor}, ${style.backgroundColor})`;
		return `${band} 0 ${title.offsetTop}px / 100% ${title.offsetHeight}px no-repeat, ${color}`;
	}
	return color;
}

/** Each block's card as last read at rest: a block in motion has its clip animated, and that is not its card. */
const cards = new WeakMap<HTMLElement, Card>();

function cardOf(element: HTMLElement): Card {
	const known = cards.get(element);
	if (known && element.getAnimations().length) {
		return known;
	}
	const style = mainWindow.getComputedStyle(element);
	const match = /^inset\(([^)]*?)(?:\s+round\s+([^)]*))?\)$/.exec(style.clipPath);
	const sides = (match?.[1] ?? '').trim().split(/\s+/).map(v => parseFloat(v) || 0);
	const [top = 0, right = top, bottom = top, left = right] = sides;
	const card = { top, right, bottom, left, radius: parseFloat(match?.[2] ?? '') || parseFloat(style.borderTopLeftRadius) || 0 };
	cards.set(element, card);
	return card;
}

/** A group's element, which IEditorGroup does not say it has. */
const elementOf = (group: IEditorGroup): HTMLElement | undefined => {
	const element = (group as IEditorGroup & { element?: unknown }).element;
	return element instanceof HTMLElement ? element : undefined;
};

/** Where an element is laid out, leaving out any transform on it or above it (a block in flight). */
function boxOf(element: HTMLElement): Box {
	let left = 0;
	let top = 0;
	for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
		left += node.offsetLeft;
		top += node.offsetTop;
	}
	return { left, top, width: element.offsetWidth, height: element.offsetHeight };
}

const overlap = (a: Box, b: Box) =>
	Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left))
	* Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

/** Which of `box`'s sides faces `other`, a block beside it. */
function facing(box: Box, other: Box): Edge {
	const across = Math.abs(other.top - box.top) < 2 || Math.abs(other.height - box.height) < Math.abs(other.width - box.width);
	return across ? (other.left < box.left ? 'left' : 'right') : (other.top < box.top ? 'top' : 'bottom');
}

/**
 * The window divides its room among its blocks (owner, 2026-11-05, the open/close mockup's E): a
 * block that opens grows out of its edge while the blocks beside it shrink to make room, and one
 * that closes shrinks back into its edge while they stretch back. VS Code lays a change out once,
 * at once, and each block is drawn at the box it is passing through with transform and clip-path
 * (stretch.ts), so nothing is laid out while they move; a block drawn bigger than it is laid out
 * shows its card's ground past its content.
 * - A block opened beside another (a file opened to the side, a split, a tool) grows out of its
 *   far edge, the one away from the block it split from, which shrinks to make room.
 * - A block closed shrinks into the edge away from the block that takes its room, which stretches
 *   back over it (its own element, which VS Code has taken out, shown where it stood).
 * - A side block shown or hidden by its commands is laid out at every size it passes through
 *   (blockStretch.ts), and every block with it; nothing here moves then. Shown or hidden another
 *   way, the editor's blocks and the other side blocks shrink or stretch the way above.
 * - A block moved, dropped somewhere else or put somewhere new by a layout goes from where it
 *   stood; a group a drop makes, from the block its editor came from.
 * Opening and closing take the same time and curve. Where the blocks stood is noted after each
 * change, when a pointer is let go (a sash dragged), a drag drops and the window is resized; never
 * per frame or per key. Opening a file in a block that is there already moves nothing. Off with
 * the window's reduced motion.
 */
export class CedianBlockMove extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.blockMove';

	/** Where each block stood, and its card (a closed group's is gone with it). */
	private boxes = new Map<HTMLElement, Noted>();
	/** From a drop: where each editor's block stood. */
	private byEditor = new Map<unknown, Box>();
	private readonly added = new Set<IEditorGroup>();
	private pending = false;
	private dropping = false;
	/** Ancestors whose clipping is lifted while blocks slide over each other, and what it was. */
	private readonly lifted = new Map<HTMLElement, string>();
	private sliding = 0;
	/** A side block was shown or hidden, and the window is being laid out again. */
	private resizing = false;
	private resizeTimer: ReturnType<typeof setTimeout> | undefined;
	/** What has scrolled, so a group's last look shows each list where it was (copy.ts). */
	private readonly scrolls = new ScrollNotes(mainWindow.document);
	/**
	 * Each group's last look before its last editor closed. A group closed with its editors in it
	 * (closing a split) has them closed first, and would fold away showing its empty page.
	 */
	private readonly lastLook = new WeakMap<HTMLElement, StillCopy & { at: number }>();
	private readonly watching = this._register(new DisposableMap<number>());
	/** A split shrinking away before it closes. */
	private shrinking: Playing | undefined;
	/** The next change was played out already (a split shrunk away): it only needs noting. */
	private quiet = false;

	constructor(
		@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService,
		@IEditorGroupsService private readonly groups: IEditorGroupsService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IInstantiationService instantiation: IInstantiationService,
	) {
		super();
		// Closing a split by its commands: it shrinks away first, laid out at every size.
		for (const id of ['workbench.action.closeGroup', 'workbench.action.closeEditorsAndGroup', 'workbench.action.closeActiveEditor']) {
			const own = CommandsRegistry.getCommand(id);
			if (!own) {
				continue;
			}
			this._register(CommandsRegistry.registerCommand({
				id,
				metadata: own.metadata,
				handler: (accessor, ...args) => {
					const run = () => instantiation.invokeFunction(own.handler, ...args);
					this.shrinking?.finish();
					const group = this.groups.mainPart.activeGroup;
					const whole = id !== 'workbench.action.closeActiveEditor'
						|| (group.count === 1 && this.configuration.getValue('workbench.editor.closeEmptyGroups') !== false);
					// From a tab's menu (a group named), or one that would ask to save first: at once.
					if (!whole || args.some(a => a !== undefined) || group.editors.some(e => e.isDirty())) {
						return run();
					}
					return this.shrinkAway(group, run);
				},
			}));
		}
		const note = () => { if (!this.pending && !this.sliding) { this.note(); } };
		// The blocks move between changes only by hand (a sash let go) or with the window: a key
		// changes nothing until it changes them, and then they are noted after that change.
		this._register(addDisposableListener(mainWindow, 'pointerup', note, true));
		this._register(addDisposableListener(mainWindow, 'resize', () => {
			clearTimeout(this.resizeTimer);
			this.resizeTimer = setTimeout(note, 150);
		}));
		this._register(toDisposable(() => clearTimeout(this.resizeTimer)));
		// Capture: measured before VS Code's own drop handlers move anything.
		this._register(addDisposableListener(mainWindow, 'drop', () => this.drop(), true));
		const part = groups.mainPart;
		this._register({ dispose: () => this.scrolls.dispose() });
		for (const group of part.groups) {
			this.watch(group);
		}
		this._register(part.onDidAddGroup(group => { this.watch(group); this.added.add(group); this.changed(); }));
		this._register(part.onDidRemoveGroup(group => { this.watching.deleteAndDispose(group.id); this.changed(); }));
		this._register(part.onDidMoveGroup(() => this.changed()));
		// A side block shown or hidden. The grid tells it from within the change, before it lays the
		// window out again; by the end of this task it has, and nothing is painted yet.
		this._register(addDisposableListener(layout.mainContainer, RESIZED, () => { if (!this.pending && !this.sliding) { this.note(); } }));
		this._register(layout.onDidChangePartVisibility(() => {
			if (!this.resizing) {
				this.resizing = true;
				queueMicrotask(() => {
					this.resizing = false;
					this.resized();
				});
			}
		}));
		this.note();
	}

	/**
	 * Notes a group's look as its editors start to leave it: closed, or moved out as the group is
	 * closed with them in it (VS Code merges them into another group, one by one). Once per task,
	 * before the first of them goes.
	 */
	private watch(group: IEditorGroup): void {
		let taken = false;
		const look = () => {
			const element = elementOf(group);
			if (taken || !element?.offsetParent || !moving(this.layout.mainContainer)) {
				return;
			}
			taken = true;
			queueMicrotask(() => taken = false);
			this.lastLook.set(element, { ...stillCopy(element, this.scrolls), at: Date.now() });
		};
		const store = new DisposableStore();
		store.add(group.onWillCloseEditor(look));
		store.add(group.onWillMoveEditor(look));
		this.watching.set(group.id, store);
	}

	/** The editor's blocks and the side blocks shown now. */
	private blocks(): HTMLElement[] {
		const out: HTMLElement[] = [];
		for (const group of this.groups.mainPart.groups) {
			const element = elementOf(group);
			if (element?.offsetParent) {
				out.push(element);
			}
		}
		for (const part of SIDE_PARTS) {
			const element = this.layout.getContainer(mainWindow, part);
			if (element?.offsetParent && this.layout.isVisible(part, mainWindow)) {
				out.push(element);
			}
		}
		return out;
	}

	private note(): void {
		this.boxes = new Map();
		for (const element of this.blocks()) {
			this.boxes.set(element, { ...boxOf(element), card: cardOf(element), ground: groundOf(element) });
		}
	}

	/** A side block was shown or hidden: the blocks that were there shrink or stretch to their new boxes. */
	private resized(): void {
		if (this.layout.mainContainer.classList.contains(RESIZING)) {
			return; // laid out at every size it passes through (blockStretch.ts); noted once it is done
		}
		if (this.pending) {
			return; // the group change under way notes them after it
		}
		const before = this.boxes;
		try {
			if (moving(this.layout.mainContainer)) {
				for (const element of this.blocks()) {
					const was = before.get(element);
					const to = boxOf(element);
					// One just shown has no box before it: it grows out of its edge (blockStretch.ts).
					if (was && moved(was, to)) {
						this.stretch(element, was, to, was, false, true);
					}
				}
			}
		} finally {
			this.note();
		}
	}

	private drop(): void {
		if (!moving(this.layout.mainContainer)) {
			return;
		}
		if (!this.sliding) {
			this.note();
		}
		this.byEditor = new Map();
		for (const group of this.groups.mainPart.groups) {
			const box = this.boxes.get(elementOf(group) as HTMLElement);
			if (box) {
				for (const editor of group.editors) {
					this.byEditor.set(editor, box);
				}
			}
		}
		this.dropping = true;
		this.changed();
	}

	/** Moves the blocks once the grid has laid out the change, before the frame is painted. */
	private changed(): void {
		if (this.pending) {
			return;
		}
		this.pending = true;
		mainWindow.requestAnimationFrame(() => {
			this.pending = false;
			const dropped = this.dropping;
			this.dropping = false;
			const quiet = this.quiet;
			this.quiet = false;
			try {
				if (moving(this.layout.mainContainer) && !quiet) {
					this.settle(dropped);
				}
			} finally {
				this.added.clear();
				this.byEditor = new Map();
				this.note();
			}
		});
	}

	private settle(dropped: boolean): void {
		const before = this.boxes;
		const groups = this.groups.mainPart.groups;
		const now = new Map<HTMLElement, Box>();
		for (const group of groups) {
			const element = elementOf(group);
			if (element?.offsetParent) {
				now.set(element, boxOf(element));
			}
		}
		// A closed group folds into the edge away from the block that takes its room. One a drop
		// emptied has nothing to show: its editor slides into its new block.
		for (const [element, box] of dropped ? [] : before) {
			if (element.isConnected) {
				continue;
			}
			let taker: Box | undefined;
			let most = 0;
			for (const other of now.values()) {
				const shared = overlap(box, other);
				if (shared > most) {
					most = shared;
					taker = other;
				}
			}
			if (taker) {
				this.fold(element, box, OPPOSITE[facing(box, taker)]);
			}
		}
		// A split: the new block is laid out at every size it grows through, and the blocks beside
		// it with it, so nothing else here moves.
		if (!dropped && this.sizeOut(groups, before, now)) {
			return;
		}
		for (const group of groups) {
			const element = elementOf(group);
			const to = element && now.get(element);
			if (!element || !to) {
				continue;
			}
			const fromDrop = group.activeEditor ? this.byEditor.get(group.activeEditor) : undefined;
			if (this.added.has(group) && !fromDrop) {
				// Out of the block it split from: the one that stood where it stands now.
				let source: Box | undefined;
				let most = 0;
				for (const other of groups) {
					const box = !this.added.has(other) ? before.get(elementOf(other) as HTMLElement) : undefined;
					const shared = box ? overlap(box, to) : 0;
					if (box && shared > most) {
						most = shared;
						source = box;
					}
				}
				if (source) {
					this.grow(element, to, OPPOSITE[facing(to, source)]);
				}
				continue;
			}
			const was = before.get(element);
			const from = was ?? fromDrop;
			if (from && moved(from, to)) {
				const own = { card: was?.card ?? cardOf(element), ground: was?.ground ?? groundOf(element) };
				this.stretch(element, from, to, own, !was, false);
			}
		}
	}

	/**
	 * Grows the one block a split added from nothing to the size VS Code laid it out at, laying the
	 * editor out at every size between (owner, 2026-11-05: every frame resized, as the mockup's E),
	 * so the block it split from shrinks with it and what sits on either one's far edge moves with
	 * that edge. Its least size (220 by 70 px, an editor's) is let down to nothing meanwhile. False
	 * when the change is not one split, for the drawn motion to take it.
	 */
	private sizeOut(groups: readonly IEditorGroup[], before: Map<HTMLElement, Noted>, now: Map<HTMLElement, Box>): boolean {
		const added = groups.filter(g => this.added.has(g));
		const group = added[0];
		const element = group && elementOf(group);
		const to = element && now.get(element);
		if (added.length !== 1 || !element || !to || [...before.keys()].some(e => !e.isConnected)) {
			return false;
		}
		let source: Box | undefined;
		let most = 0;
		for (const other of groups) {
			const box = other !== group ? before.get(elementOf(other) as HTMLElement) : undefined;
			const shared = box ? overlap(box, to) : 0;
			if (box && shared > most) {
				most = shared;
				source = box;
			}
		}
		if (!source) {
			return false;
		}
		const edge = facing(to, source);
		const across = edge === 'left' || edge === 'right';
		const least = across ? 'minimumWidth' : 'minimumHeight';
		// The group's own getter, shadowed on it for now and taken away after.
		Object.defineProperty(group, least, { value: 0, configurable: true, writable: true });
		this.sliding++;
		const playing = play(0, across ? to.width : to.height, size => {
			this.groups.mainPart.setSize(group, across ? { width: size, height: to.height } : { width: to.width, height: size });
		}, {
			request: cb => mainWindow.requestAnimationFrame(cb),
			cancel: id => mainWindow.cancelAnimationFrame(id),
			now: () => mainWindow.performance.now(),
		});
		void playing.done.then(() => {
			delete (group as unknown as Record<string, unknown>)[least];
			if (--this.sliding === 0) {
				this.note();
			}
		});
		return true;
	}

	/**
	 * Shrinks a group into nothing, laying the editor out at every size between, then closes it:
	 * the block beside it stretches back over its room as the mockup's E has it. If it is still
	 * there after (closing it was refused), it is put back at its size.
	 */
	private async shrinkAway<T>(group: IEditorGroup, close: () => T): Promise<Awaited<T>> {
		const element = elementOf(group);
		const part = this.groups.mainPart;
		const across = !!(part.findGroup({ direction: GroupDirection.LEFT }, group) ?? part.findGroup({ direction: GroupDirection.RIGHT }, group));
		const down = !!(part.findGroup({ direction: GroupDirection.UP }, group) ?? part.findGroup({ direction: GroupDirection.DOWN }, group));
		if (!element?.offsetParent || !moving(this.layout.mainContainer) || part.count < 2 || (!across && !down)) {
			return await close();
		}
		const size = { width: element.offsetWidth, height: element.offsetHeight };
		const least = across ? 'minimumWidth' : 'minimumHeight';
		Object.defineProperty(group, least, { value: 0, configurable: true, writable: true });
		this.sliding++;
		const playing = play(across ? size.width : size.height, 0, s => {
			part.setSize(group, across ? { width: s, height: size.height } : { width: size.width, height: s });
		}, {
			request: cb => mainWindow.requestAnimationFrame(cb),
			cancel: id => mainWindow.cancelAnimationFrame(id),
			now: () => mainWindow.performance.now(),
		});
		this.shrinking = playing;
		await playing.done;
		if (this.shrinking === playing) {
			this.shrinking = undefined;
		}
		delete (group as unknown as Record<string, unknown>)[least];
		// Gone at no size: nothing to fold or stretch for it.
		this.quiet = true;
		try {
			return await close();
		} finally {
			queueMicrotask(() => {
				if (part.groups.includes(group)) {
					part.setSize(group, size);
				}
				if (--this.sliding === 0) {
					this.note();
				}
			});
		}
	}

	/** A new block grows out of `edge`, the side away from the block it split from, its content coming in with that side. */
	private grow(element: HTMLElement, to: Box, edge: Edge): void {
		element.style.animation = 'none';
		holdScroll(element, this.layout.mainContainer, element.animate(stretchFrames(to, edgeBox(to, edge), to, cardOf(element)), stretching));
	}

	/**
	 * A block drawn going from where it stood to where it is laid out now: it moves from its start
	 * corner and its far sides shrink or stretch, and past its content, while it is drawn bigger
	 * than it is laid out, its card's ground carries on. `over`: it crosses the others, drawn over
	 * them. `window`: it may be drawn outside the editor, beside a side block that came or went.
	 */
	private stretch(element: HTMLElement, from: Box, to: Box, own: { card: Card; ground: string }, over: boolean, window: boolean): void {
		// Re-attached by a move, it would play an animation of its own again.
		element.style.animation = 'none';
		element.getAnimations().forEach(a => a.cancel());
		const dx = from.left - to.left;
		const dy = from.top - to.top;
		if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
			this.unclip(element, window);
		}
		// A block that crosses others passes over them.
		if (over || Math.abs(dx) > to.width / 2 || Math.abs(dy) > to.height / 2) {
			element.style.zIndex = '1';
		}
		this.sliding++;
		const run = element.animate(stretchFrames(to, from, to, own.card), stretching);
		holdScroll(element, this.layout.mainContainer, run);
		const past = ground(to, from, to, own.card);
		let strip: HTMLElement | undefined;
		if (past) {
			strip = mainWindow.document.createElement('div');
			strip.className = 'cedian-block-ground';
			strip.setAttribute('aria-hidden', 'true');
			strip.style.left = `${past.box.left}px`;
			strip.style.top = `${past.box.top}px`;
			strip.style.width = `${past.box.width}px`;
			strip.style.height = `${past.box.height}px`;
			strip.style.background = own.ground;
			// Where its ground carries on, the block's own edge is not drawn (workbench.css).
			element.classList.add(past.box.width - to.width >= past.box.height - to.height ? 'cedian-ground-right' : 'cedian-ground-bottom');
			this.layout.mainContainer.appendChild(strip);
			strip.animate(past.frames, { ...stretching, fill: 'forwards' });
		}
		const done = () => {
			strip?.remove();
			element.classList.remove('cedian-ground-right', 'cedian-ground-bottom');
			element.style.zIndex = '';
			if (--this.sliding === 0) {
				for (const [node, overflow] of this.lifted) {
					node.style.overflow = overflow;
				}
				this.lifted.clear();
				this.note();
			}
		};
		run.onfinish = done;
		run.oncancel = done;
	}

	/**
	 * A closed group, its own element (VS Code has taken it out) shown where it stood over the block
	 * that takes its room, shrinking into `edge`, the side away from that block, which stretches back.
	 */
	private fold(element: HTMLElement, box: Noted, edge: Edge): void {
		const holder = mainWindow.document.createElement('div');
		holder.className = 'cedian-block-closing';
		holder.setAttribute('aria-hidden', 'true');
		holder.style.left = `${box.left}px`;
		holder.style.top = `${box.top}px`;
		holder.style.width = `${box.width}px`;
		holder.style.height = `${box.height}px`;
		// How it looked with its editors in it, if they were closed with it.
		// Taken as the group closes; one older than that is from an editor closed before, the group
		// kept, and is not how it looks now.
		const noted = this.lastLook.get(element);
		this.lastLook.delete(element);
		const look = noted && Date.now() - noted.at < 1000 ? noted : undefined;
		const shown = look?.copy ?? element;
		shown.style.width = shown.style.height = '100%';
		shown.style.animation = shown.style.clipPath = 'none';
		// VS Code draws a group's insides by where it sits, in the editor's content: the same two
		// boxes around it out here, or its tabs and pages lose their styles.
		const part = mainWindow.document.createElement('div');
		part.className = 'part editor';
		const content = mainWindow.document.createElement('div');
		content.className = 'content';
		content.appendChild(shown);
		part.appendChild(content);
		holder.appendChild(part);
		this.layout.mainContainer.appendChild(holder);
		look?.settle();
		const run = holder.animate(stretchFrames(box, box, edgeBox(box, edge), box.card), { ...stretching, fill: 'forwards' });
		const gone = () => holder.remove();
		run.onfinish = gone;
		run.oncancel = gone;
	}

	/**
	 * Lets a block show outside its slot: the grid's views and the grid itself hide what overflows.
	 * Within the editor, up to it; beside a side block that came or went, up to the window's grid.
	 */
	private unclip(element: HTMLElement, window: boolean): void {
		const stop = window ? this.layout.mainContainer : element.closest('.part.editor') ?? this.layout.mainContainer;
		for (let node = element.parentElement; node && node !== stop; node = node.parentElement) {
			if (!this.lifted.has(node) && mainWindow.getComputedStyle(node).overflow !== 'visible') {
				this.lifted.set(node, node.style.overflow);
				node.style.overflow = 'visible';
			}
		}
	}
}
