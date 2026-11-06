/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { CURTAIN_MAX_MS, lift, lower } from './blocks/curtain.js';

/**
 * The curtain over the main window while it loads and while it shuts down (src/blocks/curtain.ts):
 * a project tab switch loads the window again, and without it the old window drops Cedian's
 * styling, then VS Code's own empty workbench shows and jumps into Cedian's layout. Down from the
 * restore phase (before the first frame is painted); up once the window is laid out
 * (CedianCurtainUp, the last contribution of the restored phase), or after CURTAIN_MAX_MS whatever
 * is still loading; down again when the window starts to shut down. workbench.css lifts it on its
 * own after 4 s should none of this run.
 */
export class CedianCurtain extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.curtain';

	constructor(
		@IWorkbenchLayoutService layout: IWorkbenchLayoutService,
		@ILifecycleService lifecycle: ILifecycleService,
	) {
		super();
		const workbench = layout.mainContainer;
		lower(workbench);
		const timer = setTimeout(() => lift(workbench, false), CURTAIN_MAX_MS);
		this._register(toDisposable(() => clearTimeout(timer)));
		this._register(lifecycle.onWillShutdown(() => {
			clearTimeout(timer);
			lower(workbench);
		}));
	}
}

/**
 * Lifts the curtain once the restored phase's contributions have laid the window out (the places,
 * the blocks, the agent in the middle) and the editors are back, two frames on, so what shows
 * first is the window as it stays. Registered last.
 */
export class CedianCurtainUp implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.curtainUp';

	constructor(
		@IWorkbenchLayoutService layout: IWorkbenchLayoutService,
		@IEditorGroupsService groups: IEditorGroupsService,
	) {
		const workbench = layout.mainContainer;
		const up = () => mainWindow.requestAnimationFrame(() => mainWindow.requestAnimationFrame(() => {
			lift(workbench, workbench.classList.contains('monaco-enable-motion'));
		}));
		groups.whenRestored.then(up, up);
	}
}
