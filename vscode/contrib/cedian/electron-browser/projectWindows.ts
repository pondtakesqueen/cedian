/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { isSingleFolderWorkspaceIdentifier } from '../../../../platform/workspace/common/workspace.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { logPhases } from '../browser/launchTiming.js';
import { PhaseLog } from '../browser/timing/phases.js';
import { coldWindows, recentFrom, RECENT_KEY, touched, type ProjectWindow } from '../browser/agent-pane/project-tabs.js';

/** The command a project tab runs to show its project (projectTabs.ts). */
export const SHOW_PROJECT = 'cedian.showProject';

/**
 * Shows a project as a browser shows a tab, in what reads as one window: every project's window
 * stands in the same place, and only the one shown is on screen; the others are hidden (patch
 * 0021, `hideWindow`), kept loaded. Picking a kept one (WARM_PROJECTS) puts it where this one
 * stands, brings it up and hides this one, with nothing to load; another opens clear over this
 * one, and shows as this one hides once it is drawn. The windows of projects shown longest ago close past the ones kept.
 */
CommandsRegistry.registerCommand(SHOW_PROJECT, async (accessor: ServicesAccessor, root: unknown) => {
	if (typeof root !== 'string' || !root) {
		return;
	}
	const native = accessor.get(INativeHostService);
	const host = accessor.get(IHostService);
	const storage = accessor.get(IStorageService);
	const log = accessor.get(ILogService);
	// Where the switch's time goes on this side; a project without a window then loads one, and that
	// window's own launch line (launchTiming.ts) says where the rest went.
	const phases = new PhaseLog('tab switch');
	phases.mark('pressed');
	const windows: ProjectWindow[] = (await native.getWindows({ includeAuxiliaryWindows: false })).map(w => ({
		id: w.id,
		root: w.workspace && isSingleFolderWorkspaceIdentifier(w.workspace) && w.workspace.uri.scheme === 'file' ? w.workspace.uri.fsPath : undefined,
		dirty: w.dirty,
	}));
	phases.mark('windows listed');
	const recent = recentFrom(storage.get(RECENT_KEY, StorageScope.APPLICATION));
	storage.store(RECENT_KEY, JSON.stringify(touched(recent, root)), StorageScope.APPLICATION, StorageTarget.MACHINE);
	const strip = (path: string) => path.length > 1 ? path.replace(/[\\/]+$/, '') : path;
	const warm = windows.find(w => w.root !== undefined && strip(w.root) === strip(root));
	// Where this one stands, unless it fills a screen of its own: the other then shows where it is.
	const at = await native.isFullScreen() ? undefined : await native.getActiveWindowPosition();
	if (warm) {
		if (at) {
			await native.positionWindow(at, { targetWindowId: warm.id });
		}
		phases.mark('window placed');
		await native.showWindow({ targetWindowId: warm.id });
		await native.focusWindow({ targetWindowId: warm.id });
		phases.mark('window shown');
		// This one leaves the screen, kept loaded: the person sees one window whose project changed.
		await native.hideWindow();
		phases.mark('this window hidden');
	} else {
		// Opened clear where this one stands; once it is drawn it shows and this one hides, in one
		// step in the main process (patch 0021): no opening animation, no window still loading.
		await native.openNextWindowQuietly(at);
		await host.openWindow([{ folderUri: URI.file(root) }], { forceNewWindow: true });
		phases.mark('new window asked for');
	}
	for (const id of coldWindows(windows, recent, root)) {
		await native.closeWindow({ targetWindowId: id });
	}
	phases.mark('old windows closed');
	const report = phases.report();
	logPhases(log, { ...report, what: warm ? 'tab switch (kept window)' : 'tab switch (new window)' });
});

/**
 * On launch VS Code restores every project window open last time, each on screen; only the one
 * that ends up in front stays shown, as a switch leaves it, and that one hides the others. A window brought forward later (Mission
 * Control, Cmd+`) shows again (hideWindow, patch 0021).
 */
class CedianOneProjectWindow extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.oneProjectWindow';

	constructor(@INativeHostService native: INativeHostService, @ILogService log: ILogService) {
		super();
		// A window a project tab opened clear (openNextWindowQuietly) shows once its restored
		// workbench is painted, and the tab's old window hides in the same step; any other window
		// is not waiting, and the call does nothing.
		mainWindow.requestAnimationFrame(() => mainWindow.requestAnimationFrame(() => { void native.revealQuietWindow(); }));
		const timer = setTimeout(async () => {
			const windows = (await native.getWindows({ includeAuxiliaryWindows: false })).filter(w => w.workspace && isSingleFolderWorkspaceIdentifier(w.workspace));
			// The one in front; with the app not in front (launched from a script), the one VS Code
			// restored last, which is the one that was in front when the app quit.
			const active = await native.getActiveWindowId();
			const keep = active !== undefined && windows.some(w => w.id === active) ? active : Math.max(...windows.map(w => w.id));
			log.info(`[cedian windows] this ${native.windowId}, active ${active}, keep ${keep}, project windows ${windows.map(w => w.id).join(',')}`);
			// The kept one hides the rest: a window behind others is occluded, and its timers may
			// never run to hide itself.
			if (windows.length > 1 && keep === native.windowId) {
				for (const w of windows) {
					if (w.id !== keep) {
						await native.hideWindow({ targetWindowId: w.id });
					}
				}
			}
		}, 2500);
		this._register({ dispose: () => clearTimeout(timer) });
	}
}
registerWorkbenchContribution2(CedianOneProjectWindow.ID, CedianOneProjectWindow, WorkbenchPhase.AfterRestored);
