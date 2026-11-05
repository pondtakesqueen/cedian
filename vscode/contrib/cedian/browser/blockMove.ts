/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { moving, stretching } from './blocks/motion.js';
import { edgeBox, ground, moved, OPPOSITE, stretchFrames, type Box, type Card, type Edge } from './blocks/stretch.js';

/** The side blocks, which make room for each other and for the editor's blocks as they come and go. */
const SIDE_PARTS = [Parts.SIDEBAR_PART, Parts.AUXILIARYBAR_PART, Parts.PANEL_PART];

/** Where a block stood, its card (workbench.css: the gaps between groups, and its corners) and its card's ground. */
type Noted = Box & { card: Card; ground: string };

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
 * - A side block shown or hidden (blockStretch.ts grows or shrinks it) makes the editor's blocks
 *   and the other side blocks shrink or stretch the same way.
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
	private resizeTimer: ReturnType<typeof setTimeout> | undefined;

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
		this._register(part.onDidAddGroup(group => { this.added.add(group); this.changed(); }));
		this._register(part.onDidRemoveGroup(() => this.changed()));
		this._register(part.onDidMoveGroup(() => this.changed()));
		// A side block shown or hidden: VS Code has laid the window out again by now, before it paints.
		this._register(layout.onDidChangePartVisibility(() => this.resized()));
		this.note();
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
			this.boxes.set(element, { ...boxOf(element), card: cardOf(element), ground: mainWindow.getComputedStyle(element).backgroundColor });
		}
	}

	/** A side block was shown or hidden: the blocks that were there shrink or stretch to their new boxes. */
	private resized(): void {
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
			try {
				if (moving(this.layout.mainContainer)) {
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
				const own = { card: was?.card ?? cardOf(element), ground: was?.ground ?? mainWindow.getComputedStyle(element).backgroundColor };
				this.stretch(element, from, to, own, !was, false);
			}
		}
	}

	/** A new block grows out of `edge`, the side away from the block it split from, its content coming in with that side. */
	private grow(element: HTMLElement, to: Box, edge: Edge): void {
		element.style.animation = 'none';
		element.animate(stretchFrames(to, edgeBox(to, edge), to, cardOf(element)), stretching);
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
			strip.style.backgroundColor = own.ground;
			this.layout.mainContainer.appendChild(strip);
			strip.animate(past.frames, { ...stretching, fill: 'forwards' });
		}
		const done = () => {
			strip?.remove();
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
		element.style.width = element.style.height = '100%';
		element.style.animation = element.style.clipPath = 'none';
		holder.appendChild(element);
		this.layout.mainContainer.appendChild(holder);
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
