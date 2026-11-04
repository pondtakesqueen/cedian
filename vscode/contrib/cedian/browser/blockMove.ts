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
import { closing, easeOpen, moving, OPEN_MS, opening } from './blocks/motion.js';



interface Box { left: number; top: number; width: number; height: number }

/** The inset a block's card is drawn at within its slot (workbench.css: the gaps between groups), and its corners. */
interface Inset { top: number; right: number; bottom: number; left: number; radius: string }

function insetOf(element: HTMLElement): Inset {
	const clip = mainWindow.getComputedStyle(element).clipPath;
	const match = /^inset\(([^)]*?)(?:\s+round\s+([^)]*))?\)$/.exec(clip);
	const sides = (match?.[1] ?? '').trim().split(/\s+/).map(v => parseFloat(v) || 0);
	const [top = 0, right = top, bottom = top, left = right] = sides;
	return { top, right, bottom, left, radius: match?.[2]?.trim() || mainWindow.getComputedStyle(element).borderTopLeftRadius || '0px' };
}

/** A clip-path that draws the card at its inset with this much more taken off each side. */
const clipOf = (inset: Inset, more: Partial<Omit<Inset, 'radius'>> = {}) =>
	`inset(${inset.top + (more.top ?? 0)}px ${inset.right + (more.right ?? 0)}px ${inset.bottom + (more.bottom ?? 0)}px ${inset.left + (more.left ?? 0)}px round ${inset.radius})`;

/** A group view as the grid sees it: its sizes and layout, which IEditorGroup does not say. */
interface GroupView { element: HTMLElement; layout(width: number, height: number, top: number, left: number): void }
const viewOf = (group: IEditorGroup): GroupView | undefined => {
	const view = group as IEditorGroup & Partial<GroupView>;
	return view.element instanceof HTMLElement && typeof view.layout === 'function' ? view as IEditorGroup & GroupView : undefined;
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

/**
 * The editor's blocks tile as a tiling window manager's do: whatever changes the layout, they move
 * and never pop. A block opened beside another (a file opened to the side, a split, a new tool)
 * stretches open out of the block it split from, its real size moving frame by frame as a side
 * block's does, and the block it came from gives up the room as it grows. Its contents stay laid out
 * at their full size, held at the edge away from that block, and its moving edge uncovers them.
 * Every other block whose place changed (a block closed, moved, dropped somewhere else) slides from
 * where it stood: it is laid out in its new place at once, put back with a transform before the
 * frame is painted, and eased there, a block that grew uncovered as it goes rather than scaled, so
 * nothing is stretched. A group a drop makes slides from the block its editor came from.
 * Where the blocks stood is noted after each frame the editor lays out, and as a key or a pointer is
 * pressed and a drag starts or drops. Opening a file in a block that is there already moves nothing.
 * Off with the window's reduced motion.
 */
export class CedianBlockMove extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.blockMove';

	/** Where each block stood when last painted at rest. */
	private boxes = new Map<HTMLElement, Box>();
	/** The inset each block's card was drawn at then: a closed group's is gone with it. */
	private insets = new Map<HTMLElement, Inset>();
	/** From a drop: where each editor's block stood. */
	private byEditor = new Map<unknown, Box>();
	private readonly added = new Set<IEditorGroup>();
	private pending = false;
	private dropping = false;
	private noting = false;
	/** Running slides and stretches, by block, so a new change takes over from where each is. */
	private readonly runs = new Map<HTMLElement, () => void>();
	/** Ancestors whose clipping is lifted while blocks slide over each other, and what it was. */
	private readonly lifted = new Map<HTMLElement, string>();

	constructor(
		@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService,
		@IEditorGroupsService private readonly groups: IEditorGroupsService,
	) {
		super();
		const note = () => { if (!this.pending && !this.runs.size) { this.note(); } };
		for (const type of ['pointerdown', 'pointerup', 'keydown', 'dragstart']) {
			this._register(addDisposableListener(mainWindow, type, note, true));
		}
		// Capture: measured before VS Code's own drop handlers move anything.
		this._register(addDisposableListener(mainWindow, 'drop', () => this.drop(), true));
		const part = groups.mainPart;
		this._register(part.onDidAddGroup(group => { this.added.add(group); this.changed(); }));
		this._register(part.onDidRemoveGroup(() => this.changed()));
		this._register(part.onDidMoveGroup(() => this.changed()));
		// A side block shown or hidden without stretching (blockStretch.ts) goes at once: the editor's
		// blocks slide into its room. One that stretches has already been set back to where it was.
		this._register(layout.onDidChangePartVisibility(() => this.changed()));
		// Where they stand now, once the frame the editor laid out in is drawn.
		this._register(part.onDidLayout(() => {
			if (this.noting || this.pending) {
				return;
			}
			this.noting = true;
			mainWindow.requestAnimationFrame(() => {
				this.noting = false;
				if (!this.pending && !this.runs.size) {
					this.note();
				}
			});
		}));
		this._register(toDisposable(() => { for (const stop of [...this.runs.values()]) { stop(); } }));
		this.note();
	}

	private moving(): boolean {
		return moving(this.layout.mainContainer);
	}

	private note(): void {
		this.boxes = new Map();
		this.insets = new Map();
		for (const group of this.groups.mainPart.groups) {
			const element = viewOf(group)?.element;
			if (element?.offsetParent) {
				this.boxes.set(element, boxOf(element));
				this.insets.set(element, insetOf(element));
			}
		}
	}

	private drop(): void {
		if (!this.moving()) {
			return;
		}
		if (!this.runs.size) {
			this.note();
		}
		this.byEditor = new Map();
		for (const group of this.groups.mainPart.groups) {
			const box = this.boxes.get(viewOf(group)?.element as HTMLElement);
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
				if (this.moving()) {
					this.settle(dropped);
				}
			} finally {
				this.added.clear();
				this.byEditor = new Map();
				if (!this.runs.size) {
					this.note();
				}
			}
		});
	}

	private settle(dropped: boolean): void {
		const before = this.boxes;
		const groups = this.groups.mainPart.groups;
		const now = groups.map(g => viewOf(g)?.element).filter((e): e is HTMLElement => !!e?.offsetParent);
		// A change that only took blocks away moves on the closing timing, the rest on the opening's.
		const gone = !dropped && !this.added.size && [...before.keys()].some(e => !e.isConnected);
		const timing = gone ? closing : opening;
		// A group that closed collapses into the edge away from the block that takes its room. One a
		// drop emptied has nothing to show: its editor slides into its new block.
		for (const [element, box] of dropped ? [] : before) {
			if (!element.isConnected) {
				let taker: Box | undefined;
				let most = 0;
				for (const other of now) {
					const shared = overlap(box, boxOf(other));
					if (shared > most) {
						most = shared;
						taker = boxOf(other);
					}
				}
				this.collapse(element, box, taker, this.insets.get(element), timing);
			}
		}
		for (const group of groups) {
			const view = viewOf(group);
			if (!view || !view.element.offsetParent) {
				continue;
			}
			const element = view.element;
			const to = boxOf(element);
			const fromDrop = group.activeEditor ? this.byEditor.get(group.activeEditor) : undefined;
			if (this.added.has(group) && !fromDrop) {
				// Out of the block it split from: the one that stood where it stands now.
				let source: Box | undefined;
				let most = 0;
				for (const other of groups) {
					const box = !this.added.has(other) ? before.get(viewOf(other)?.element as HTMLElement) : undefined;
					const shared = box ? overlap(box, to) : 0;
					if (box && shared > most) {
						most = shared;
						source = box;
					}
				}
				const tall = !!source && Math.abs(source.left - to.left) < 2 && Math.abs(source.width - to.width) < 2;
				const far = !!source && (tall ? to.top > source.top : to.left > source.left);
				this.stretch(group, view, tall, far);
				continue;
			}
			const from = before.get(element) ?? fromDrop;
			if (from) {
				this.slide(element, from, to, !before.has(element), timing);
			}
		}
	}

	/** Opens a new block from nothing to its size, as a side block does, its neighbour giving way. */
	private stretch(group: IEditorGroup, view: GroupView, tall: boolean, far: boolean): void {
		const part = this.groups.mainPart;
		const element = view.element;
		const full = part.getSize(group);
		const target = tall ? full.height : full.width;
		if (target <= 0) {
			return;
		}
		this.runs.get(element)?.();
		const key = tall ? 'minimumHeight' : 'minimumWidth';
		// Its minimum lifted while it opens, its contents laid out at full size the whole time.
		Object.defineProperty(view, key, { configurable: true, get: () => 0 });
		const own = Object.getPrototypeOf(view).layout as GroupView['layout'];
		view.layout = (width, height, top, left) => own.call(view, tall ? width : Math.max(width, target), tall ? Math.max(height, target) : height, top, left);
		element.style.animation = 'none';
		element.style.overflow = 'hidden';
		const inner = [...element.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
		const set = (size: number) => {
			part.setSize(group, tall ? { width: full.width, height: size } : { width: size, height: full.height });
			for (const c of inner) {
				c.style.transform = far ? `translate${tall ? 'Y' : 'X'}(${size - target}px)` : '';
			}
		};
		let frame = 0;
		let stopped = false;
		const stop = () => {
			if (stopped) {
				return;
			}
			stopped = true;
			mainWindow.cancelAnimationFrame(frame);
			const record = view as unknown as Record<string, unknown>;
			delete record[key];
			delete record.layout;
			element.style.overflow = '';
			for (const c of inner) {
				c.style.transform = '';
			}
			if (this.runs.get(element) === stop) {
				this.runs.delete(element);
			}
			if (element.isConnected) {
				part.setSize(group, full);
			}
		};
		this.runs.set(element, stop);
		const start = mainWindow.performance.now();
		const step = () => {
			if (stopped) {
				return;
			}
			if (!element.isConnected) {
				stop();
				return;
			}
			const t = Math.min(1, (mainWindow.performance.now() - start) / OPEN_MS);
			set(Math.round(target * easeOpen(t)));
			if (t < 1) {
				frame = mainWindow.requestAnimationFrame(step);
				return;
			}
			stop();
			this.note();
		};
		set(0);
		frame = mainWindow.requestAnimationFrame(step);
	}

	/** Slides a block from where it stood to where it is laid out now; a side that grew is uncovered as it goes. */
	private slide(element: HTMLElement, from: Box, to: Box, over: boolean, timing: KeyframeAnimationOptions): void {
		const dx = from.left - to.left;
		const dy = from.top - to.top;
		const right = Math.max(0, to.width - from.width);
		const bottom = Math.max(0, to.height - from.height);
		// Re-attached by a move, it would play an animation of its own again.
		element.style.animation = 'none';
		if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && right < 1 && bottom < 1) {
			return;
		}
		this.runs.get(element)?.();
		// Its own card's inset (the gaps between groups) kept, and the side that grew taken off it.
		const inset = insetOf(element);
		this.unclip(element);
		// A block that crosses others passes over them.
		if (over || Math.abs(dx) > to.width / 2 || Math.abs(dy) > to.height / 2) {
			element.style.zIndex = '1';
		}
		const run = element.animate(
			[
				{ transform: `translate(${dx}px, ${dy}px)`, clipPath: clipOf(inset, { right, bottom }) },
				{ transform: 'none', clipPath: clipOf(inset) },
			],
			timing,
		);
		const stop = () => {
			if (this.runs.get(element) !== stop) {
				return;
			}
			this.runs.delete(element);
			run.cancel();
			element.style.zIndex = '';
			if (!this.runs.size) {
				for (const [node, overflow] of this.lifted) {
					node.style.overflow = overflow;
				}
				this.lifted.clear();
				this.note();
			}
		};
		this.runs.set(element, stop);
		run.onfinish = stop;
	}

	/**
	 * Shows a closed group collapsing into its edge, fully drawn, while the block that takes its room
	 * slides over it: its edge moves on the same curve and in the same time as that block's, so the
	 * two meet all the way. VS Code has taken the group out already, so its own element is shown
	 * where it stood, above the editor, and removed when it is gone.
	 */
	private collapse(element: HTMLElement, box: Box, taker: Box | undefined, inset: Inset | undefined, timing: KeyframeAnimationOptions): void {
		if (!taker || box.width === 0 || box.height === 0) {
			return;
		}
		// The taker is on one side of it: it grows over the group from that side.
		const sideways = Math.abs(taker.top - box.top) < 2 || Math.abs(taker.height - box.height) > Math.abs(taker.width - box.width);
		const before = sideways ? taker.left < box.left : taker.top < box.top;
		const holder = mainWindow.document.createElement('div');
		holder.className = 'cedian-block-closing';
		holder.setAttribute('aria-hidden', 'true');
		holder.style.left = `${box.left}px`;
		holder.style.top = `${box.top}px`;
		holder.style.width = `${box.width}px`;
		holder.style.height = `${box.height}px`;
		element.style.width = element.style.height = '100%';
		element.style.animation = 'none';
		holder.appendChild(element);
		this.layout.mainContainer.appendChild(holder);
		// Its card drawn as it was, between the same gaps; the holder's own card goes.
		const card = inset ?? { top: 0, right: 0, bottom: 0, left: 0, radius: '0px' };
		element.style.clipPath = 'none';
		const gone = sideways
			? clipOf(card, before ? { left: box.width - card.left - card.right } : { right: box.width - card.left - card.right })
			: clipOf(card, before ? { top: box.height - card.top - card.bottom } : { bottom: box.height - card.top - card.bottom });
		const run = holder.animate([{ clipPath: clipOf(card) }, { clipPath: gone }], { ...timing, fill: 'forwards' });
		const done = () => holder.remove();
		run.onfinish = done;
		run.oncancel = done;
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
