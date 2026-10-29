/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/agentPane.css';
import { $, append } from '../../../../base/browser/dom.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js';
import { AgentPane } from './agent-pane/pane.js';
import { ICedianDaemonService } from './daemonService.js';
import { COMPOSER_FOCUS, PANE_FOCUS } from './keybindings/keybindings.js';
import { CedianPanes } from './panes.js';
import { ICedianReviewService } from './review.js';

/** Videos cedia takes on `--image` and shows as frames. */
const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'];
const VIDEO_FILE = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;

export const AGENT_PANE_CONTAINER_ID = 'workbench.view.cedian.agent';
export const AGENT_PANE_VIEW_ID = 'workbench.view.cedian.agent.pane';

export const ComposerFocus = new RawContextKey<boolean>(COMPOSER_FOCUS, false);
export const PaneFocus = new RawContextKey<boolean>(PANE_FOCUS, false);

/**
 * The agent pane: one live thread of the window's project, drawn from the daemon's notices
 * over `daemon.sock` (src/agent-pane/pane.ts holds the logic and the drawing; this view only
 * hands it the workbench's services).
 */
export class AgentPaneView extends ViewPane {

	private pane: AgentPane | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@ICedianDaemonService private readonly daemon: ICedianDaemonService,
		@ICedianReviewService private readonly reviews: ICedianReviewService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@ISearchService private readonly searchService: ISearchService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@INotificationService private readonly notifications: INotificationService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		const folder = this.workspace.getWorkspace().folders[0];
		if (!folder || folder.uri.scheme !== 'file') {
			const empty = append(parent, $('.cedian-agent-pane'));
			append(empty, $('.empty')).textContent = 'Open the project\'s folder first, then give the agent work here';
			return;
		}
		const queryBuilder = this.instantiationService.createInstance(QueryBuilder);
		const pane = new AgentPane(parent.ownerDocument, this.daemon.client, {
			cwd: folder.uri.fsPath,
			files: async query => {
				const source = new CancellationTokenSource();
				try {
					const result = await this.searchService.fileSearch(queryBuilder.file([folder], { filePattern: query, maxResults: 40, sortByScore: true }), source.token);
					return result.results.map(r => relativePath(folder.uri, r.resource) ?? r.resource.fsPath);
				} finally {
					source.dispose();
				}
			},
			pickImages: async video => {
				const images = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
				const picked = await this.fileDialogService.showOpenDialog({
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
				const file = joinPath(this.environmentService.cacheHome, 'cedian-paste', `${generateUuid()}.${extension}`);
				await this.fileService.writeFile(file, VSBuffer.wrap(bytes));
				return file.fsPath;
			},
			// A review that can't open says so in a notification (spec §8.4: transient).
			openReview: (thread, cwd, review, file, line) => { this.reviews.open(thread, cwd, review, file, line).catch(e => this.notifications.warn(`Couldn't open the review: ${e instanceof Error ? e.message : e}`)); },
			openUrl: url => { this.openerService.open(URI.parse(url)); },
		});
		this.pane = pane;
		CedianPanes.current = pane;
		parent.append(pane.root);
		this.connectionState(pane.root);

		const composerFocus = ComposerFocus.bindTo(this.scopedContextKeyService);
		const paneFocus = PaneFocus.bindTo(this.scopedContextKeyService);
		pane.composer.addEventListener('focus', () => composerFocus.set(true));
		pane.composer.addEventListener('blur', () => composerFocus.set(false));
		pane.root.addEventListener('focusin', () => paneFocus.set(true));
		pane.root.addEventListener('focusout', () => paneFocus.set(false));
		// An image dropped in the composer is attached by its file path, and a video once cedia takes one
		// (the pane handles a paste).
		pane.composer.addEventListener('drop', e => {
			const attachable = (p: string) => /\.(png|jpe?g|gif|webp)$/i.test(p) || (pane.takesVideo() && VIDEO_FILE.test(p));
			const files = [...(e.dataTransfer?.files ?? [])].map(f => (f as File & { path?: string }).path).filter((p): p is string => !!p && attachable(p));
			if (files.length) {
				e.preventDefault();
				pane.attach(files);
			}
		});
	}

	/** A line over the pane while the daemon does not answer. */
	private connectionState(root: HTMLElement): void {
		const bar = $('.conn');
		bar.setAttribute('role', 'status');
		root.prepend(bar);
		const show = (state: string) => {
			bar.textContent = state === 'connected' ? '' : state === 'connecting' ? 'Connecting to the cedian daemon…' : 'Can\'t reach the cedian daemon; retrying';
			bar.hidden = state === 'connected';
		};
		show(this.daemon.client.connection);
		this._register({ dispose: this.daemon.client.onConnection(show) });
	}

	override focus(): void {
		super.focus();
		this.pane?.focusComposer();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.pane) {
			this.pane.root.style.height = `${height}px`;
		}
	}

	override dispose(): void {
		if (this.pane && CedianPanes.current === this.pane) {
			CedianPanes.current = undefined;
		}
		this.pane?.dispose();
		super.dispose();
	}
}
