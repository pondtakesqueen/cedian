/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { closing, moving, opening } from './blocks/motion.js';

interface Box { left: number; top: number; width: number; height: number }

/** The inset a block's card is drawn at within its slot (workbench.css: the gaps between groups), and its corners. */
interface Inset { top: number; right: number; bottom: number; left: number; radius: string }

/** Each block's card as last read at rest: a block being uncovered has its clip animated, and that is not its card. */
const cards = new WeakMap<HTMLElement, Inset>();

function insetOf(element: HTMLElement): Inset {
	const known = cards.get(element);
	if (known && element.getAnimations().length) {
		return known;
	}
	const style = mainWindow.getComputedStyle(element);
	const match = /^inset\(([^)]*?)(?:\s+round\s+([^)]*))?\)$/.exec(style.clipPath);
	const sides = (match?.[1] ?? '').trim().split(/\s+/).map(v => parseFloat(v) || 0);
	const [top = 0, right = top, bottom = top, left = right] = sides;
	const inset = { top, right, bottom, left, radius: match?.[2]?.trim() || style.borderTopLeftRadius || '0px' };
	cards.set(element, inset);
	return inset;
}

/** A clip-path that draws the card at its inset with this much more taken off each side. */
const clipOf = (inset: Inset, more: Partial<Omit<Inset, 'radius'>> = {}) =>
	`inset(${inset.top + (more.top ?? 0)}px ${inset.right + (more.right ?? 0)}px ${inset.bottom + (more.bottom ?? 0)}px ${inset.left + (more.left ?? 0)}px round ${inset.radius})`;

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
function facing(box: Box, other: Box): 'left' | 'right' | 'top' | 'bottom' {
	const across = Math.abs(other.top - box.top) < 2 || Math.abs(other.height - box.height) < Math.abs(other.width - box.width);
	return across ? (other.left < box.left ? 'left' : 'right') : (other.top < box.top ? 'top' : 'bottom');
}

/**
 * The editor's blocks move as a tiling window manager's do, on the compositor alone (owner,
 * 2026-11-04: lean before smooth): VS Code lays a change out once, at once, and the blocks are
 * drawn moving toward it with transform and clip-path, so nothing is laid out while they move.
 * - A block opened beside another (a file opened to the side, a split, a tool) is uncovered from
 *   the edge it shares with the block it split from.
 * - A block closed folds into the edge away from the block that takes its room, over it (its own
 *   element, which VS Code has taken out, shown where it stood).
 * - A block moved, dropped somewhere else or put somewhere new by a layout slides from where it
 *   stood; a group a drop makes, from the block its editor came from. A size is VS Code's, at once.
 * Where the blocks stood is noted after each change, when a pointer is let go (a sash dragged), a
 * drag drops and the window is resized; never per frame or per key. Opening a file in a block
 * that is there already moves nothing. Off with the window's reduced motion.
 */
export class CedianBlockMove extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.blockMove';

	/** Where each block stood, and the inset its card was drawn at (a closed group's is gone with it). */
	private boxes = new Map<HTMLElement, Box & { inset: Inset }>();
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
		// A side block shown or hidden moves the editor's blocks at once: noted again, nothing slides.
		this._register(layout.onDidChangePartVisibility(() => mainWindow.requestAnimationFrame(note)));
		this.note();
	}

	private note(): void {
		this.boxes = new Map();
		for (const group of this.groups.mainPart.groups) {
			const element = elementOf(group);
			if (element?.offsetParent) {
				this.boxes.set(element, { ...boxOf(element), inset: insetOf(element) });
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
				this.fold(element, box, facing(box, taker));
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
					this.uncover(element, facing(to, source));
				}
				continue;
			}
			const from = before.get(element) ?? fromDrop;
			if (from) {
				this.slide(element, from, to, !before.has(element));
			}
		}
	}

	/** Uncovers a new block from `edge`, the side it shares with the block it split from. */
	private uncover(element: HTMLElement, edge: 'left' | 'right' | 'top' | 'bottom'): void {
		element.style.animation = 'none';
		const inset = insetOf(element);
		const span = edge === 'left' || edge === 'right' ? element.offsetWidth : element.offsetHeight;
		const far = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[edge] as keyof Omit<Inset, 'radius'>;
		element.animate([{ clipPath: clipOf(inset, { [far]: span - inset[far] - inset[edge] }) }, { clipPath: clipOf(inset) }], opening);
	}

	/** Slides a block from where it stood to where it is laid out now: its place only, its size VS Code's. */
	private slide(element: HTMLElement, from: Box, to: Box, over: boolean): void {
		// Re-attached by a move, it would play an animation of its own again.
		element.style.animation = 'none';
		const dx = from.left - to.left;
		const dy = from.top - to.top;
		if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
			return;
		}
		element.getAnimations().forEach(a => a.cancel());
		this.unclip(element);
		// A block that crosses others passes over them.
		if (over || Math.abs(dx) > to.width / 2 || Math.abs(dy) > to.height / 2) {
			element.style.zIndex = '1';
		}
		this.sliding++;
		const run = element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], opening);
		const done = () => {
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
	 * that takes its room, taken off from `toward`, the side that block comes from, so it folds into
	 * the side away from it.
	 */
	private fold(element: HTMLElement, box: Box & { inset: Inset }, toward: 'left' | 'right' | 'top' | 'bottom'): void {
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
		const card = box.inset;
		const span = toward === 'left' || toward === 'right' ? box.width - card.left - card.right : box.height - card.top - card.bottom;
		// Taken off from the side the taker comes from, so it folds into the side away from it.
		const run = holder.animate([{ clipPath: clipOf(card) }, { clipPath: clipOf(card, { [toward]: span }) }], { ...closing, fill: 'forwards' });
		const gone = () => holder.remove();
		run.onfinish = gone;
		run.oncancel = gone;
	}

	/** Lets a block show outside its slot: the grid's views and the grid itself hide what overflows. */
	private unclip(element: HTMLElement): void {
		const part = element.closest('.part.editor');
		for (let node = element.parentElement; node && node !== part; node = node.parentElement) {
			if (!this.lifted.has(node) && mainWindow.getComputedStyle(node).overflow !== 'visible') {
				this.lifted.set(node, node.style.overflow);
				node.style.overflow = 'visible';
			}
		}
	}
}
