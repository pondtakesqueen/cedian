/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, DisposableMap, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { ScrollNotes, stillCopy, type StillCopy } from './blocks/copy.js';
import { moving, stretching } from './blocks/motion.js';
import { pop } from './blocks/popin.js';
import { ground, holdScroll, moved, stretchFrames, type Box, type Card } from './blocks/stretch.js';

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

/** A view of VS Code's grid (a part, an editor group) as it lays itself out in its slot. */
interface Laid {
	layout(width: number, height: number, top: number, left: number): void;
}

type LayoutFn = Laid['layout'];

interface Held {
	view: Laid;
	layout: LayoutFn;
	width: string;
	height: string;
	size: Box;
	big: { width: number; height: number };
	fresh: boolean;
}

/**
 * The window divides its room among its blocks the way Hyprland tiles its windows (owner,
 * 2026-11-05, the open/close mockup's H, its spring taken out): a block that opens grows in from
 * 87% of its size as it fades in (popin.ts), one that closes shrinks to it as it fades out, and
 * the blocks beside them move aside or back over WINDOWS_MS (motion.ts). VS Code lays a change
 * out once, at once; a block that shrinks is laid out by that same layout at the size it had,
 * until it has moved (`wrap`), and then once at its own. Each block is then drawn at the box it is passing through with transform and
 * clip-path (stretch.ts), its content held at its start corner and cut at its far sides: never
 * stretched, never laid out per frame, its text never wrapped again on the way.
 * - A block opened beside another (a file opened to the side, a split, a tool) pops in where VS
 *   Code put it, and the block it split from moves aside.
 * - A block closed pops out where it stood (its own element, which VS Code has taken out), over the
 *   block that takes its room, which moves back over it.
 * - A side block shown or hidden (blockStretch.ts pops it) makes the editor's blocks and the other
 *   side blocks move the same way.
 * - A block moved, dropped somewhere else or put somewhere new by a layout goes from where it
 *   stood; a group a drop makes, from the block its editor came from.
 * Where the blocks stood is noted at each change, as VS Code has laid it out, when a pointer is let
 * go (a sash dragged), a drag drops and the window is resized; never per frame or per key. Opening
 * a file in a block that is there already moves nothing. Off with the window's reduced motion.
 */
export class CedianBlockMove extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.blockMove';

	/** Where each block stood, and its card (a closed group's is gone with it). */
	private boxes = new Map<HTMLElement, Noted>();
	/**
	 * Views laid out bigger than the grid has them while their blocks move, by slot: the slot's own
	 * style, the size and place the grid gave the view, and its own layout to lay it out at them.
	 * `fresh`: held by the change being laid out now, not yet moved.
	 */
	private held = new Map<HTMLElement, Held>();
	/** The size each view was last laid out at. */
	private readonly drawn = new WeakMap<Laid, { width: number; height: number }>();
	/** VS Code is laying out a change that moves the blocks: a view that shrinks is held. */
	private transit = 0;
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

	constructor(
		@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService,
		@IEditorGroupsService private readonly groups: IEditorGroupsService,
	) {
		super();
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
			this.wrapGroup(group);
		}
		// Not the editor itself: its grid lays its groups out smaller, and they are held, each in its
		// own slot at its own place.
		for (const name of SIDE_PARTS) {
			const view = this.part(name);
			if (view) {
				this.wrap(view, () => this.layout.getContainer(mainWindow, name)?.parentElement ?? undefined);
			}
		}
		// A split lays its group out smaller as it adds the new one.
		const editors = part as unknown as { addGroup: (...args: unknown[]) => unknown };
		const addGroup = editors.addGroup;
		if (typeof addGroup === 'function') {
			editors.addGroup = (...args: unknown[]) => {
				this.transit++;
				try {
					return addGroup.apply(part, args);
				} finally {
					this.transit--;
				}
			};
			this._register(toDisposable(() => editors.addGroup = addGroup));
		}
		this._register(part.onDidAddGroup(group => { this.watch(group); this.wrapGroup(group); this.added.add(group); this.changed(); }));
		this._register(part.onDidRemoveGroup(group => { this.watching.deleteAndDispose(group.id); this.changed(); }));
		this._register(part.onDidMoveGroup(() => this.changed()));
		// A side block shown or hidden. The grid tells it from within the change, before it lays the
		// window out again; by the end of this task it has, and nothing is painted yet.
		this._register(layout.onDidChangePartVisibility(() => {
			if (!this.resizing) {
				this.resizing = true;
				this.transit++;
				queueMicrotask(() => {
					this.resizing = false;
					this.transit--;
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

	/** Notes where the blocks stand as VS Code has laid them out: one held, at the size the grid gave it. */
	private note(): void {
		this.boxes = new Map();
		for (const element of this.blocks()) {
			const box = boxOf(element);
			const held = element.parentElement && this.held.get(element.parentElement);
			if (held) {
				box.width = held.size.width;
				box.height = held.size.height;
			}
			this.boxes.set(element, { ...box, card: cardOf(element), ground: groundOf(element) });
		}
	}

	/** An editor group, laid out by the editor's grid in its element's parent. */
	private wrapGroup(group: IEditorGroup): void {
		const element = elementOf(group);
		this.wrap(group as unknown as Laid, () => element?.parentElement ?? undefined);
	}

	/**
	 * Takes over a view's layout: while VS Code lays out a change that moves the blocks, a view it
	 * makes smaller is laid out at the bigger of its two sizes instead, its slot made as big, so its
	 * block is drawn shrinking over its own content, cut at its far sides, never past it (owner,
	 * 2026-11-05: text never stretched, never wrapped again on the way). One layout, VS Code's own,
	 * not one more; `release` lays it out at the grid's size once it has moved.
	 */
	private wrap(view: Laid, slotOf: () => HTMLElement | undefined): void {
		const layout = view.layout;
		if (typeof layout !== 'function' || this.drawn.has(view)) {
			return;
		}
		const slot = slotOf();
		if (slot?.offsetWidth) {
			this.drawn.set(view, { width: slot.offsetWidth, height: slot.offsetHeight });
		}
		view.layout = (width, height, top, left) => {
			const at = slotOf();
			const held = at && this.held.get(at);
			if (held && held.view === view) {
				held.size = { left, top, width, height };
				if (width <= held.big.width && height <= held.big.height) {
					return;
				}
				held.big = { width: Math.max(width, held.big.width), height: Math.max(height, held.big.height) };
				this.size(at, held.big);
				layout.call(view, held.big.width, held.big.height, top, left);
				return;
			}
			const was = this.drawn.get(view);
			if (at && was?.width && this.transit && (width < was.width - 0.5 || height < was.height - 0.5) && moving(this.layout.mainContainer)) {
				const big = { width: Math.max(width, was.width), height: Math.max(height, was.height) };
				this.held.set(at, { view, layout, width: at.style.width, height: at.style.height, size: { left, top, width, height }, big, fresh: true });
				this.size(at, big);
				layout.call(view, big.width, big.height, top, left);
				this.drawn.set(view, big);
				// Held for a change nothing moves for: given its size back after a frame.
				mainWindow.requestAnimationFrame(() => mainWindow.requestAnimationFrame(() => {
					if (!this.sliding) {
						this.release(true);
					}
				}));
				return;
			}
			this.drawn.set(view, { width, height });
			layout.call(view, width, height, top, left);
		};
		this._register(toDisposable(() => view.layout = layout));
	}

	private size(slot: HTMLElement, size: { width: number; height: number }): void {
		slot.style.width = `${size.width}px`;
		slot.style.height = `${size.height}px`;
	}

	/**
	 * The grid's sizes back to the slots held bigger, each view laid out at them: the grid would
	 * not, its views' sizes being unchanged as far as it knows. Not those the change being laid out
	 * now holds, unless `all`.
	 */
	private release(all = false): void {
		for (const [slot, held] of [...this.held]) {
			if (held.fresh && !all) {
				continue;
			}
			this.held.delete(slot);
			slot.style.width = held.width;
			slot.style.height = held.height;
			const { width, height, top, left } = held.size;
			this.drawn.set(held.view, { width, height });
			held.layout.call(held.view, width, height, top, left);
		}
	}

	/** The views held by the change just laid out are now moving, theirs to release. */
	private claim(): void {
		for (const held of this.held.values()) {
			held.fresh = false;
		}
	}

	/** VS Code's own part, which lays itself out in its slot. */
	private part(part: Parts): Laid | undefined {
		const get = (this.layout as unknown as { getPart?(part: Parts): Laid }).getPart;
		const found = typeof get === 'function' ? get.call(this.layout, part) : undefined;
		return typeof found?.layout === 'function' ? found : undefined;
	}

	/** A side block was shown or hidden: the blocks that were there move to their new boxes. */
	private resized(): void {
		if (this.pending) {
			return; // the group change under way notes them after it
		}
		const before = this.boxes;
		this.release();
		this.note();
		this.claim();
		if (!moving(this.layout.mainContainer)) {
			return;
		}
		for (const [element, to] of this.boxes) {
			const was = before.get(element);
			// One just shown has no box before it: it pops in (blockStretch.ts).
			if (was && moved(was, to)) {
				this.stretch(element, boxOf(element), was, to, was, false, true);
			}
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
			const before = this.boxes;
			try {
				this.release();
				this.note();
				this.claim();
				if (moving(this.layout.mainContainer)) {
					this.settle(dropped, before);
				}
			} finally {
				this.added.clear();
				this.byEditor = new Map();
			}
		});
	}

	private settle(dropped: boolean, before: Map<HTMLElement, Noted>): void {
		const groups = this.groups.mainPart.groups;
		const now = new Map<HTMLElement, Box>();
		for (const group of groups) {
			const element = elementOf(group);
			const box = element && this.boxes.get(element);
			if (element && box) {
				now.set(element, box);
			}
		}
		// A closed group pops out where it stood, over the block that takes its room. One a drop
		// emptied has nothing to show: its editor slides into its new block.
		for (const [element, box] of dropped ? [] : before) {
			if (element.isConnected) {
				continue;
			}
			if ([...now.values()].some(other => overlap(box, other) > 0)) {
				this.fold(element, box);
			}
		}
		for (const group of groups) {
			const element = elementOf(group);
			const to = element && now.get(element);
			if (!element || !to) {
				continue;
			}
			const fromDrop = group.activeEditor ? this.byEditor.get(group.activeEditor) : undefined;
			if (this.added.has(group) && !fromDrop) {
				// Out of a block that stood where it stands now: it pops in there.
				if (groups.some(other => !this.added.has(other) && overlap(before.get(elementOf(other) as HTMLElement) ?? { left: 0, top: 0, width: 0, height: 0 }, to) > 0)) {
					this.grow(element);
				}
				continue;
			}
			const was = before.get(element);
			const from = was ?? fromDrop;
			if (from && moved(from, to)) {
				const own = { card: was?.card ?? cardOf(element), ground: was?.ground ?? groundOf(element) };
				this.stretch(element, boxOf(element), from, to, own, !was, false);
			}
		}
	}

	/** A new block pops in where VS Code put it. */
	private grow(element: HTMLElement): void {
		element.style.animation = 'none';
		holdScroll(element, this.layout.mainContainer, pop(element, 'in'));
	}

	/**
	 * A block laid out at `at` drawn going from where it stood to where it is laid out now: moved
	 * from its start corner and cut at its far sides, its content never stretched. Laid out smaller
	 * than it is drawn (one not held), its card's ground carries on past its content. `over`: it
	 * crosses the others, drawn over them. `window`: it may be drawn outside the editor, beside a side
	 * block that came or went.
	 */
	private stretch(element: HTMLElement, at: Box, from: Box, to: Box, own: { card: Card; ground: string }, over: boolean, window: boolean): void {
		// Re-attached by a move, it would play an animation of its own again.
		element.style.animation = 'none';
		element.getAnimations().forEach(a => a.cancel());
		const dx = from.left - to.left;
		const dy = from.top - to.top;
		// Drawn outside its slot, or held bigger than it: what hides overflow around it is lifted.
		if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1 || moved(at, to)) {
			this.unclip(element, window);
		}
		// A block that crosses others passes over them.
		if (over || Math.abs(dx) > to.width / 2 || Math.abs(dy) > to.height / 2) {
			element.style.zIndex = '1';
		}
		this.sliding++;
		const run = element.animate(stretchFrames(at, from, to, own.card), stretching);
		holdScroll(element, this.layout.mainContainer, run);
		const past = ground(at, from, to, own.card);
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
			element.classList.add(past.box.width - at.width >= past.box.height - at.height ? 'cedian-ground-right' : 'cedian-ground-bottom');
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
				this.release();
				this.note();
			}
		};
		run.onfinish = done;
		run.oncancel = done;
	}

	/**
	 * A closed group, its own element (VS Code has taken it out) shown where it stood over the block
	 * that takes its room, popping out as that block moves back over it.
	 */
	private fold(element: HTMLElement, box: Noted): void {
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
		// Its card's corners and gaps, as it stood.
		holder.style.clipPath = stretchFrames(box, box, box, box.card)[0].clipPath as string;
		const run = pop(holder, 'out');
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
