/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IDialogService, IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js';
import { AUX_WINDOW_GROUP, PreferredGroup } from '../../../services/editor/common/editorService.js';
import { ISCMService, ISCMViewService } from '../../scm/common/scm.js';
import type { PaneHost } from './agent-pane/pane.js';
import { ICedianReviewService } from './review.js';
import { showRepository } from './sourceControl.js';

/** Videos cedia takes on `--image` and shows as frames. */
const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'];

/** Where an agent pane is drawn, for what differs between the side pane and one popped out. */
export interface PanePlace {
	/** The editor group reviews open in; the active one when not given. */
	reviewGroup?: () => PreferredGroup;
	/** Opens a thread in a pane of its own window; none for a pane already popped out. */
	popOut?: (thread: string | undefined) => void;
}

/** What an agent pane needs from the workbench around it, for the project folder `folder`. */
export function createPaneHost(accessor: ServicesAccessor, folder: IWorkspaceFolder, place: PanePlace): PaneHost {
	const searchService = accessor.get(ISearchService);
	const queryBuilder = accessor.get(IInstantiationService).createInstance(QueryBuilder);
	const fileDialogService = accessor.get(IFileDialogService);
	const environmentService = accessor.get(IEnvironmentService);
	const fileService = accessor.get(IFileService);
	const reviews = accessor.get(ICedianReviewService);
	const notifications = accessor.get(INotificationService);
	const openerService = accessor.get(IOpenerService);
	const commands = accessor.get(ICommandService);
	const scm = accessor.get(ISCMService);
	const scmView = accessor.get(ISCMViewService);
	const dialogs = accessor.get(IDialogService);
	// A review that can't open says so in a notification (spec §8.4: transient).
	const reviewFailed = (e: unknown) => notifications.warn(`Couldn't open the review: ${e instanceof Error ? e.message : e}`);
	return {
		cwd: folder.uri.fsPath,
		files: async query => {
			const source = new CancellationTokenSource();
			try {
				const result = await searchService.fileSearch(queryBuilder.file([folder], { filePattern: query, maxResults: 40, sortByScore: true }), source.token);
				return result.results.map(r => relativePath(folder.uri, r.resource) ?? r.resource.fsPath);
			} finally {
				source.dispose();
			}
		},
		pickImages: async video => {
			const images = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
			const picked = await fileDialogService.showOpenDialog({
				canSelectFiles: true,
				canSelectMany: true,
				title: video ? 'Attach images or videos' : 'Attach images',
				filters: video ? [{ name: 'Images and videos', extensions: [...images, ...VIDEO_EXTENSIONS] }] : [{ name: 'Images', extensions: images }],
			});
			return (picked ?? []).map(uri => uri.fsPath);
		},
		// A pasted image without a file goes in the window's cache folder; cedia copies it when the run starts.
		saveImage: async (bytes, mime) => {
			const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'video/quicktime' ? 'mov' : mime === 'video/x-matroska' ? 'mkv' : mime === 'video/x-msvideo' ? 'avi' : mime.split('/')[1];
			const file = joinPath(environmentService.cacheHome, 'cedian-paste', `${generateUuid()}.${extension}`);
			await fileService.writeFile(file, VSBuffer.wrap(bytes));
			return file.fsPath;
		},
		openReview: (thread, cwd, review, file, line) => { reviews.open(thread, cwd, review, file, line, place.reviewGroup?.()).catch(reviewFailed); },
		openReviewWindow: (thread, cwd, review) => { reviews.open(thread, cwd, review, undefined, undefined, AUX_WINDOW_GROUP).catch(reviewFailed); },
		popOut: place.popOut,
		openUrl: url => { openerService.open(URI.parse(url)); },
		// The git pane follows the open thread; a folder git can't open just leaves it where it was.
		showRepository: path => { showRepository(commands, scm, scmView, path).catch(() => { }); },
		openSourceControl: path => {
			showRepository(commands, scm, scmView, path)
				.then(() => commands.executeCommand('workbench.view.scm'))
				.catch(e => notifications.warn(`Couldn't open Source Control: ${e instanceof Error ? e.message : e}`));
		},
		// Spec §8.4: "Archive anyway? This worktree has uncommitted changes"; cancel keeps them.
		confirmArchive: async files => {
			const shown = files.slice(0, 5).join('\n') + (files.length > 5 ? `\nand ${files.length - 5} more` : '');
			const { confirmed } = await dialogs.confirm({
				type: 'warning',
				message: 'Archive anyway? This worktree has uncommitted changes',
				detail: `They go when the worktree is removed after archive:\n${shown}`,
				primaryButton: 'Archive Anyway',
			});
			return confirmed;
		},
	};
}
