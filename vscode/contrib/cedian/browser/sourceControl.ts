/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ISCMRepository, ISCMService, ISCMViewService } from '../../scm/common/scm.js';

/** macOS's /var and /tmp are links into /private, which git names and a thread's cwd may not. */
const unlinked = (path: string) => path.replace(/^\/private(?=\/(var|tmp)\/)/, '');

/** How long a repository the git extension is opening may take to reach the SCM view. */
const ADDED_WITHIN_MS = 5000;

/**
 * The git pane (spec §11 Phase D): VS Code's own Source Control, on the open thread's folder.
 * Opens `path` as a repository in the git extension (reopening one closed before; a thread's
 * worktree is otherwise found only once `git.detectWorktrees` has listed it), then focuses and
 * pins it, so Changes, Commit, Pull, Push and the graph are the thread's.
 */
export async function showRepository(commands: ICommandService, scm: ISCMService, scmView: ISCMViewService, path: string): Promise<void> {
	const at = (r: ISCMRepository) => r.provider.providerId === 'git' && !!r.provider.rootUri && unlinked(r.provider.rootUri.fsPath) === unlinked(path);
	await commands.executeCommand('git.openRepository', path);
	const repository = [...scm.repositories].find(at) ?? await Promise.race([
		Event.toPromise(Event.filter(scm.onDidAddRepository, at)),
		new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), ADDED_WITHIN_MS)),
	]);
	if (!repository) {
		return;
	}
	scmView.focus(repository);
	scmView.pinActiveRepository(repository);
}
