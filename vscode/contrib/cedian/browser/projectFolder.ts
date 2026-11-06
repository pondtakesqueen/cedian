/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';

/**
 * The project's folder: the window's first root, the primary that keys the project's threads
 * and layout. None while no folder is open, or the first is not on disk (cedia runs on files).
 */
export function projectFolder(workspace: IWorkspaceContextService): IWorkspaceFolder | undefined {
	const folder = workspace.getWorkspace().folders[0];
	return folder?.uri.scheme === 'file' ? folder : undefined;
}
