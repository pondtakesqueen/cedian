/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';

/** How long the blocks take to slide to their new places, and how they ease: they set off at once and land softly. */
const MOVE_MS = 320;
const MOVE_EASE = 'cubic-bezier(.2, .7, .3, 1)';

/** A group's element: every group VS Code makes is a view that has one, which IEditorGroup does not say. */
const elementOf = (group: IEditorGroup): HTMLElement | undefined => (group as IEditorGroup & { element?: HTMLElement }).element;

/** True from a drop until the blocks have been measured in their new places: a group the drop
 * takes away has slid into its new place already, so blockExit.ts leaves it be. */
export const dropping = { now: false };

/**
 * A block dropped somewhere else slides there, and the blocks it passes slide out of its way, in
 * place of popping in where it lands (workbench.css). VS Code moves an editor group, or the editor
 * dragged out of one into a new group, within the one drop, and lays the grid out again at once.
 * Where every block stood, and which editors each held, is measured as the drop starts. Once the
 * grid has laid out, before the frame is painted, each block is put back where it stood with a
 * transform and eased to its new place: a group that was there is followed by its element, a new
 * one by the editor it now shows. Only transform moves, so nothing lays out again while it slides.
 * Off with the window's reduced motion.
 */
export class CedianBlockMove extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.blockMove';

	constructor(
		@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService,
		@IEditorGroupsService private readonly groups: IEditorGroupsService,
	) {
		super();
		// Capture: measured before VS Code's own drop handlers move anything.
		this._register(addDisposableListener(mainWindow, 'drop', () => this.drop(), true));
	}

	private drop(): void {
		if (!this.layout.mainContainer.classList.contains('monaco-enable-motion')) {
			return;
		}
		const byElement = new Map<HTMLElement, DOMRect>();
		const byEditor = new Map<unknown, DOMRect>();
		for (const group of this.groups.mainPart.groups) {
			const element = elementOf(group);
			const rect = element?.getBoundingClientRect();
			if (!element || !rect || rect.width === 0 || rect.height === 0) {
				continue;
			}
			byElement.set(element, rect);
			for (const editor of group.editors) {
				byEditor.set(editor, rect);
			}
		}
		dropping.now = true;
		// After the drop's handlers have run and the grid has laid out, before it is painted.
		mainWindow.requestAnimationFrame(() => {
			dropping.now = false;
			this.slide(byElement, byEditor);
		});
	}

	private slide(byElement: Map<HTMLElement, DOMRect>, byEditor: Map<unknown, DOMRect>): void {
		for (const group of this.groups.mainPart.groups) {
			const element = elementOf(group);
			if (!element) {
				continue;
			}
			const from = byElement.get(element) ?? (group.activeEditor ? byEditor.get(group.activeEditor) : undefined);
			if (!from) {
				continue; // A block the drop made with nothing from before grows in as any new one.
			}
			// Re-attached by the move, it would play its pop-in again.
			element.style.animation = 'none';
			const to = element.getBoundingClientRect();
			if (to.width === 0 || to.height === 0) {
				continue;
			}
			const dx = from.left - to.left;
			const dy = from.top - to.top;
			const sx = from.width / to.width;
			const sy = from.height / to.height;
			if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < .01 && Math.abs(sy - 1) < .01) {
				continue;
			}
			// The grid clips each block to its slot; it slides over its neighbours while it moves.
			const opened = this.unclip(element);
			const moved = !byElement.has(element) || Math.abs(dx) > to.width / 2 || Math.abs(dy) > to.height / 2;
			if (moved) {
				element.style.zIndex = '1';
			}
			const run = element.animate(
				[{ transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: '0 0', transform: 'none' }],
				{ duration: MOVE_MS, easing: MOVE_EASE },
			);
			const done = () => {
				element.style.zIndex = '';
				for (const [node, overflow] of opened) {
					node.style.overflow = overflow;
				}
			};
			run.onfinish = done;
			run.oncancel = done;
		}
	}

	/** Lets the block show outside its slot: the grid's views and the grid itself hide what overflows. */
	private unclip(element: HTMLElement): [HTMLElement, string][] {
		const part = element.closest('.part.editor');
		const opened: [HTMLElement, string][] = [];
		for (let node = element.parentElement; node && node !== part; node = node.parentElement) {
			if (mainWindow.getComputedStyle(node).overflow !== 'visible') {
				opened.push([node, node.style.overflow]);
				node.style.overflow = 'visible';
			}
		}
		return opened;
	}
}
