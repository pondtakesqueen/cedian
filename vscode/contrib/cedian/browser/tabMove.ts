/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { EditorsOrder } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { closing, moving, opening } from './blocks/motion.js';


/** Where a tab was laid out in its row, and a copy of it to show if it closes. */
interface Spot { editor: EditorInput; left: number; top: number; width: number; height: number; copy: HTMLElement; scrollLeft: number; scrollTop: number }

/**
 * A group's tabs move as its blocks do: a tab opened is uncovered from its left edge while the tabs
 * after it slide aside to make room, a tab closed collapses into its left edge while the tabs after
 * it slide over into its room, and tabs reordered (dragged, pinned) slide to their new places.
 * VS Code redraws the row at once, reusing its tab elements in order, so each tab is followed by the
 * editor it shows: where every editor's tab stood is noted after each change and as a key or a
 * pointer is pressed. Once VS Code has drawn the change, before the frame is painted, each tab is
 * put back where its editor's stood with a transform and eased to its place; only transform and
 * clip-path move, so the row never lays out again and its scrolling, the active tab's line and
 * sticky tabs stay VS Code's. A closed tab's copy is shown over the row, outside VS Code's tabs.
 * Never scaled, never faded. Off with the window's reduced motion.
 */
export class CedianTabMove extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.tabMove';

	private readonly spots = new Map<IEditorGroup, Spot[]>();
	private readonly pending = new Set<IEditorGroup>();
	private readonly watched = this._register(new DisposableMap<IEditorGroup>());

	constructor(
		@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService,
		@IEditorGroupsService groups: IEditorGroupsService,
	) {
		super();
		const part = groups.mainPart;
		for (const group of part.groups) {
			this.watch(group);
		}
		this._register(part.onDidAddGroup(group => this.watch(group)));
		this._register(part.onDidRemoveGroup(group => { this.watched.deleteAndDispose(group); this.spots.delete(group); }));
		// Noted before a key or a click changes the row, in case it moved since (a tab grew a dirty mark).
		const note = () => { for (const group of part.groups) { if (!this.pending.has(group)) { this.note(group); } } };
		this._register(addDisposableListener(mainWindow, 'pointerdown', note, true));
		this._register(addDisposableListener(mainWindow, 'keydown', note, true));
		this._register(part.onDidLayout(() => mainWindow.requestAnimationFrame(note)));
	}

	private watch(group: IEditorGroup): void {
		this.note(group);
		this.watched.set(group, group.onDidModelChange(() => this.changed(group)));
	}

	private tabsOf(group: IEditorGroup): HTMLElement[] {
		const element = (group as IEditorGroup & { element?: HTMLElement }).element;
		const row = element?.querySelector<HTMLElement>('.tabs-container');
		return row ? [...row.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains('tab')) : [];
	}

	private note(group: IEditorGroup): void {
		const editors = group.getEditors(EditorsOrder.SEQUENTIAL);
		const tabs = this.tabsOf(group);
		if (tabs.length !== editors.length) {
			this.spots.set(group, []);
			return;
		}
		// Where it was seen: the row scrolls, and VS Code scrolls it back in the frame a tab closes.
		const row = tabs[0]?.parentElement;
		const scrollLeft = row?.scrollLeft ?? 0;
		const scrollTop = row?.scrollTop ?? 0;
		this.spots.set(group, editors.map((editor, i) => {
			const tab = tabs[i];
			return { editor, left: tab.offsetLeft, top: tab.offsetTop, width: tab.offsetWidth, height: tab.offsetHeight, copy: tab.cloneNode(true) as HTMLElement, scrollLeft, scrollTop };
		}));
	}

	private changed(group: IEditorGroup): void {
		if (this.pending.has(group)) {
			return;
		}
		this.pending.add(group);
		// After VS Code has drawn the row, before the frame is painted.
		mainWindow.requestAnimationFrame(() => {
			this.pending.delete(group);
			try {
				if (moving(this.layout.mainContainer)) {
					this.move(group, this.spots.get(group) ?? []);
				}
			} finally {
				this.note(group);
			}
		});
	}

	private move(group: IEditorGroup, before: readonly Spot[]): void {
		const editors = group.getEditors(EditorsOrder.SEQUENTIAL);
		const tabs = this.tabsOf(group);
		if (tabs.length !== editors.length) {
			return;
		}
		const was = new Map(before.map(s => [s.editor, s]));
		// Only tabs closed: the row closes up on the closing timing, as a closing block does.
		const now = new Set(editors);
		const timing = editors.every(e => was.has(e)) && before.some(s => !now.has(s.editor)) ? closing : opening;
		editors.forEach((editor, i) => {
			const tab = tabs[i];
			const spot = was.get(editor);
			if (!spot) {
				// Opened: uncovered from its left edge as the tabs after it make room.
				tab.animate([{ clipPath: 'inset(0px 100% 0px 0px)' }, { clipPath: 'inset(0px 0px 0px 0px)' }], opening);
				return;
			}
			const row = tab.parentElement;
			const dx = (spot.left - spot.scrollLeft) - (tab.offsetLeft - (row?.scrollLeft ?? 0));
			const dy = (spot.top - spot.scrollTop) - (tab.offsetTop - (row?.scrollTop ?? 0));
			if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
				tab.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], timing);
			}
		});
		const row = tabs[0]?.parentElement ?? this.rowOf(group);
		for (const spot of before) {
			if (!now.has(spot.editor) && row) {
				this.collapse(row, spot, timing);
			}
		}
	}

	private rowOf(group: IEditorGroup): HTMLElement | null {
		return (group as IEditorGroup & { element?: HTMLElement }).element?.querySelector<HTMLElement>('.tabs-container') ?? null;
	}

	/** A closed tab's copy, where it stood, collapsing into its left edge as the tabs after it slide over. */
	private collapse(row: HTMLElement, spot: Spot, timing: KeyframeAnimationOptions): void {
		// Beside the row, not in it: VS Code finds its tabs by their place among the row's children.
		const holder = row.parentElement;
		if (!holder) {
			return;
		}
		const copy = spot.copy;
		copy.classList.add('cedian-tab-closing');
		copy.setAttribute('aria-hidden', 'true');
		copy.removeAttribute('tabindex');
		copy.draggable = false;
		copy.style.position = 'absolute';
		copy.style.left = `${spot.left - spot.scrollLeft}px`;
		copy.style.top = `${spot.top - spot.scrollTop}px`;
		copy.style.width = `${spot.width}px`;
		copy.style.height = `${spot.height}px`;
		holder.appendChild(copy);
		const run = copy.animate([{ clipPath: 'inset(0px 0px 0px 0px)' }, { clipPath: 'inset(0px 100% 0px 0px)' }], { ...timing, fill: 'forwards' });
		const done = () => copy.remove();
		run.onfinish = done;
		run.oncancel = done;
	}
}
