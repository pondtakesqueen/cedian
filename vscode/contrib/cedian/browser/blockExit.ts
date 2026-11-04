/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { addDisposableListener, getWindow } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';

/** The side blocks whose leaving is shown. The editor groups are followed one by one. */
const SIDE_PARTS: readonly Parts[] = [Parts.SIDEBAR_PART, Parts.AUXILIARYBAR_PART, Parts.PANEL_PART];

/** How a block leaves: the prototype's pop-in run backwards, as long as the arrival (workbench.css). */
const EXIT_MS = 160;

/**
 * A block that goes leaves as the prototype's do: it fades and shrinks a little where it stood
 * instead of vanishing. VS Code takes the block out of the layout at once, and its neighbours take
 * the room straight away; only a picture of it is left behind, so nothing lays out again. That
 * picture is the block's own element when VS Code has removed it (a closed editor group), a copy
 * when it only hides it (a side bar). Where each block stood is noted when a key or a pointer is
 * pressed, before the command that closes it runs. Off with the window's reduced motion.
 */
export class CedianBlockExit extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.blockExit';

	private readonly rects = new Map<HTMLElement, DOMRect>();

	constructor(
		@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService,
		@IEditorGroupsService groups: IEditorGroupsService,
	) {
		super();
		const note = () => this.note();
		this._register(addDisposableListener(mainWindow, 'pointerdown', note, true));
		this._register(addDisposableListener(mainWindow, 'keydown', note, true));
		this._register(layout.onDidChangePartVisibility(e => {
			if (e.visible) {
				return;
			}
			const part = SIDE_PARTS.find(p => p === e.partId);
			const element = part ? layout.getContainer(mainWindow, part) : undefined;
			if (element) {
				this.leave(element, true);
			}
		}));
		// The group's element is the one noted that is no longer in the window.
		this._register(groups.onDidRemoveGroup(() => {
			for (const element of [...this.rects.keys()]) {
				if (!element.isConnected && element.classList.contains('editor-group-container')) {
					this.leave(element, false);
				}
			}
		}));
		note();
	}

	/** Where each block stands now. */
	private note(): void {
		this.rects.clear();
		for (const part of SIDE_PARTS) {
			const element = this.layout.getContainer(mainWindow, part);
			if (element && element.offsetParent) {
				this.rects.set(element, element.getBoundingClientRect());
			}
		}
		const editor = this.layout.getContainer(mainWindow, Parts.EDITOR_PART);
		for (const group of editor?.querySelectorAll<HTMLElement>('.editor-group-container') ?? []) {
			if (group.offsetParent) {
				this.rects.set(group, group.getBoundingClientRect());
			}
		}
	}

	private leave(element: HTMLElement, copy: boolean): void {
		const rect = this.rects.get(element);
		this.rects.delete(element);
		const workbench = this.layout.mainContainer;
		if (!rect || rect.width === 0 || !workbench.classList.contains('monaco-enable-motion')) {
			return;
		}
		const ghost = copy ? element.cloneNode(true) as HTMLElement : element;
		const holder = getWindow(workbench).document.createElement('div');
		holder.className = 'cedian-block-exit';
		holder.setAttribute('aria-hidden', 'true');
		holder.style.left = `${rect.left}px`;
		holder.style.top = `${rect.top}px`;
		holder.style.width = `${rect.width}px`;
		holder.style.height = `${rect.height}px`;
		ghost.style.width = '100%';
		ghost.style.height = '100%';
		holder.appendChild(ghost);
		workbench.appendChild(holder);
		const done = () => holder.remove();
		const run = holder.animate(
			[{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.98)' }],
			{ duration: EXIT_MS, easing: 'cubic-bezier(.2, .7, .3, 1)', fill: 'forwards' },
		);
		run.onfinish = done;
		run.oncancel = done;
	}
}
