/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';

const OVERLAY_ID = 'monaco-workbench-editor-drop-overlay';

/** A length VS Code gives the drop target ('0', '50%', '100%') as a share of its container. */
function share(value: string): number | undefined {
	if (value === '0' || value === '0px') {
		return 0;
	}
	const match = /^(\d+(?:\.\d+)?)%$/.exec(value.trim());
	return match ? Number(match[1]) / 100 : undefined;
}

/**
 * The drop target shown while a tab or a block is held over a group covers the whole block, its
 * tab row too, as one card: the whole of it, or half of it from edge to edge. VS Code lays its drop
 * area out below the tab row, so a tab dropped on the row still reorders, and places the target in
 * that area as shares of it ('0', '50%', '100%'). The area stays where it is; only the target is
 * drawn taller: each share VS Code gives it is taken of the whole block instead, the tab row's
 * height above the area added (`calc`), so a half is half the block. The target takes no pointer
 * events, so drops still land where VS Code expects. Its card's corners and gaps are workbench.css's.
 */
export class CedianDropTarget extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.dropTarget';

	constructor(@IWorkbenchLayoutService layout: IWorkbenchLayoutService) {
		super();
		const part = layout.getContainer(mainWindow, Parts.EDITOR_PART);
		if (!part) {
			return;
		}
		const watching = new WeakSet<HTMLElement>();
		const fit = (target: HTMLElement) => {
			const area = target.parentElement;
			const lift = area ? parseFloat(area.style.top) || 0 : 0;
			const top = share(target.style.top);
			const height = share(target.style.height);
			// Already taken of the block, or nothing to take it of.
			if (top === undefined || height === undefined) {
				return;
			}
			target.style.top = `calc(${top} * (100% + ${lift}px) - ${lift}px)`;
			target.style.height = `calc(${height} * (100% + ${lift}px))`;
		};
		const observer = new MutationObserver(records => {
			for (const record of records) {
				const target = record.target as HTMLElement;
				if (record.type === 'attributes' && target.classList.contains('editor-group-overlay-indicator')) {
					fit(target);
				}
				for (const node of record.addedNodes) {
					const indicator = node instanceof HTMLElement && node.id === OVERLAY_ID ? node.querySelector<HTMLElement>('.editor-group-overlay-indicator') : null;
					if (indicator && !watching.has(indicator)) {
						watching.add(indicator);
						observer.observe(indicator, { attributes: true, attributeFilter: ['style'] });
						fit(indicator);
					}
				}
			}
		});
		// Watched only while something is dragged: the editor's own changes (typing) are none of its business.
		let observing = false;
		const watch = () => {
			if (!observing) {
				observing = true;
				observer.observe(part, { childList: true, subtree: true });
			}
		};
		const stop = () => {
			if (observing) {
				observing = false;
				observer.disconnect();
			}
		};
		this._register(addDisposableListener(mainWindow, 'dragenter', watch, true));
		this._register(addDisposableListener(mainWindow, 'dragend', stop, true));
		this._register(addDisposableListener(mainWindow, 'drop', () => setTimeout(stop, 0), true));
		this._register(toDisposable(stop));
	}
}
