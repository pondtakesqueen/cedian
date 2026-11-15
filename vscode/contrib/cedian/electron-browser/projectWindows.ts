/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
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
 * Shows a project as a browser shows a tab: each project's window is a tab of one window frame
 * (macOS's window tabs, their bar hidden; patch 0021), and the projects used last keep theirs
 * (WARM_PROJECTS), so picking one selects its tab in place with nothing to load. Another opens as
 * a new tab of this frame, and the tabs of projects shown longest ago close past the ones kept.
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
	if (warm) {
		// Where this one stands, unless it fills a screen of its own: the other then shows where it is.
		const at = await native.isFullScreen() ? undefined : await native.getActiveWindowPosition();
		if (at) {
			await native.positionWindow(at, { targetWindowId: warm.id });
		}
		phases.mark('window placed');
		await native.focusWindow({ targetWindowId: warm.id });
		phases.mark('window focused');
	} else {
		// On macOS the new window is a tab of this one (patch 0021, macOS's window tabs with their
		// own bar hidden): one frame, as a browser keeps its tabs, switched by the project tabs.
		await host.openWindow([{ folderUri: URI.file(root) }], { forceNewWindow: true, forceNewTabbedWindow: true });
		phases.mark('new window asked for');
	}
	for (const id of coldWindows(windows, recent, root)) {
		await native.closeWindow({ targetWindowId: id });
	}
	phases.mark('old windows closed');
	const report = phases.report();
	logPhases(log, { ...report, what: warm ? 'tab switch (kept window)' : 'tab switch (new window)' });
});
