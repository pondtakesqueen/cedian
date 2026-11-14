/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { isSingleFolderWorkspaceIdentifier } from '../../../../platform/workspace/common/workspace.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { coldWindows, recentFrom, RECENT_KEY, touched, type ProjectWindow } from '../browser/agent-pane/project-tabs.js';

/** The command a project tab runs to show its project (projectTabs.ts). */
export const SHOW_PROJECT = 'cedian.showProject';

/**
 * Shows a project as a browser shows a tab: the projects used last keep their windows
 * (WARM_PROJECTS), so one of them is put where this window stands and brought to the front, with
 * nothing to load. Another opens in a new window over this one (`window.newWindowDimensions` is
 * "inherit", src/settings/desktop.ts), and the windows of projects shown longest ago close past
 * the ones kept.
 */
CommandsRegistry.registerCommand(SHOW_PROJECT, async (accessor: ServicesAccessor, root: unknown) => {
	if (typeof root !== 'string' || !root) {
		return;
	}
	const native = accessor.get(INativeHostService);
	const host = accessor.get(IHostService);
	const storage = accessor.get(IStorageService);
	const windows: ProjectWindow[] = (await native.getWindows({ includeAuxiliaryWindows: false })).map(w => ({
		id: w.id,
		root: w.workspace && isSingleFolderWorkspaceIdentifier(w.workspace) && w.workspace.uri.scheme === 'file' ? w.workspace.uri.fsPath : undefined,
		dirty: w.dirty,
	}));
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
		await native.focusWindow({ targetWindowId: warm.id });
	} else {
		await host.openWindow([{ folderUri: URI.file(root) }], { forceNewWindow: true });
	}
	for (const id of coldWindows(windows, recent, root)) {
		await native.closeWindow({ targetWindowId: id });
	}
});
