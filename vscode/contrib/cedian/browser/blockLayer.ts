/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/blocks.css';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { URI } from '../../../../base/common/uri.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { EditorsOrder } from '../../../common/editor.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { BlockLayer } from './blocks/layer.js';
import { floatingIn, sameFloating, withFloating, type Floating } from './blocks/layout.js';
import { AgentBlock } from './agent-pane/floating.js';
import { AgentPane } from './agent-pane/pane.js';
import { CedianAgentInput } from './agentEditor.js';
import { browserServices, CedianBrowserInput, createBrowserPanel, openBrowser } from './browserEditor.js';
import { ICedianDaemonService } from './daemonService.js';
import { createPaneHost } from './paneHost.js';
import { CedianPanes, connectionBar } from './panes.js';
import { desktopOf, type Desktop } from './settings/desktop.js';

/**
 * The main window's block layer (spec §3.3, §4.4): blocks floating over the editor area as PiPs.
 * A block floats from its editor (the Browser block's Float button, or Float Browser) and docks
 * back into one. Where each rests is `desktop.layout` (spec §5.5), kept by the daemon, so the
 * next window opens it where it was.
 */
export class CedianBlockLayer extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.blockLayer';
	/** The window's layer, for the commands. */
	static current: CedianBlockLayer | undefined;

	private readonly layer: BlockLayer;
	private desktop: Desktop = {};
	private restored = false;

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ICedianDaemonService private readonly daemon: ICedianDaemonService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService private readonly instantiation: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IEditorGroupsService private readonly editorGroups: IEditorGroupsService,
		@INotificationService private readonly notifications: INotificationService,
	) {
		super();
		this.layer = new BlockLayer(mainWindow.document, {
			dock: (kind, id) => {
				if (kind === 'browser') {
					void openBrowser(this.editorService);
				} else if (kind === 'agent') {
					// Into the editor area beside the code, as a popped-out pane is in its own window.
					void this.editorService.openEditor(new CedianAgentInput(id), { pinned: true });
				}
			},
			changed: floating => this.keep(floating),
		});
		// Blocks float over the editor area, the frame Tern's PiPs float in: the side pane and its
		// composer stay clear, as do the activity bar and the title bar. Without an editor part
		// (none yet), over the whole window.
		const frame = layoutService.getContainer(mainWindow, Parts.EDITOR_PART) ?? layoutService.mainContainer;
		frame.classList.add('cedian-block-frame');
		frame.append(this.layer.root);
		this._register({ dispose: () => this.layer.dispose() });
		const off = daemon.client.on('settings', notice => {
			this.desktop = desktopOf(notice.desktop);
			if (!this.restored) {
				this.restored = true;
				this.restore();
			}
		});
		this._register({ dispose: off });
		daemon.client.request({ op: 'settings' });
		CedianBlockLayer.current = this;
		this._register({ dispose: () => { if (CedianBlockLayer.current === this) { CedianBlockLayer.current = undefined; } } });
	}

	/** The project's folder: the primary root, which keys its layout. */
	private folder(): URI | undefined {
		const folder = this.workspace.getWorkspace().folders[0];
		return folder && folder.uri.scheme === 'file' ? folder.uri : undefined;
	}

	/** Floats the Browser block, closing its editor: the block moves, it is not copied. */
	async floatBrowser(): Promise<void> {
		const folder = this.folder();
		if (!folder) {
			return;
		}
		const open = this.editorService.getEditors(EditorsOrder.SEQUENTIAL).filter(id => id.editor instanceof CedianBrowserInput);
		if (open.length) {
			await this.editorService.closeEditors(open);
		}
		if (!this.layer.has('browser')) {
			this.floatBrowserAt(folder, floatingIn(this.desktop, folder.fsPath).find(f => f.kind === 'browser'), false);
		}
	}

	dockBrowser(): void {
		if (this.layer.has('browser')) {
			this.layer.dock('browser');
		} else {
			void openBrowser(this.editorService);
		}
	}

	private floatBrowserAt(folder: URI, at: Floating | undefined, quiet: boolean): void {
		const panel = createBrowserPanel(this.instantiation.invokeFunction(browserServices), folder);
		const offBar = connectionBar(panel.root, this.daemon.client);
		const dispose = panel.dispose.bind(panel);
		panel.dispose = () => { offBar.dispose(); dispose(); };
		this.layer.float(panel, at, quiet);
	}

	/** Floats `thread` (a new thread when none) in an agent pane of its own over the window. */
	floatThread(thread: string | undefined): void {
		const folder = this.workspace.getWorkspace().folders[0];
		if (!folder || folder.uri.scheme !== 'file') {
			return;
		}
		const saved = floatingIn(this.desktop, folder.uri.fsPath).find(f => f.kind === 'agent');
		// Its own corner by default: the Browser block rests bottom right.
		this.floatAgentAt(thread, saved ? { ...saved, id: thread } : { corner: 'tr', width: 400, height: 560 }, false);
	}

	private floatAgentAt(thread: string | undefined, at: Partial<Floating>, quiet: boolean): void {
		const folder = this.workspace.getWorkspace().folders[0];
		if (!folder) {
			return;
		}
		// Reviews from here open in the main window's editors, beside the code.
		const host = this.instantiation.invokeFunction(accessor => createPaneHost(accessor, folder, {
			reviewGroup: () => this.editorGroups.mainPart.activeGroup,
		}));
		const wire = CedianPanes.wire(this.daemon.client);
		const pane = new AgentPane(mainWindow.document, wire, host);
		const scoped = this.contextKeyService.createScoped(pane.root);
		const listed = CedianPanes.add(pane, scoped);
		const bar = connectionBar(pane.root, this.daemon.client);
		const block = new AgentBlock({
			pane,
			onAny: listener => wire.onAny(listener),
			release: () => { bar.dispose(); listed.dispose(); scoped.dispose(); wire.dispose(); },
		});
		if (thread) {
			pane.openThread(thread);
		}
		try {
			this.layer.float(block, at, quiet);
		} catch (e) {
			this.notifications.warn(`Couldn't float the thread: ${e instanceof Error ? e.message : e}`);
		}
	}

	/** Opens what floated in this project when the last window closed. */
	private restore(): void {
		const folder = this.folder();
		if (!folder) {
			return;
		}
		for (const f of floatingIn(this.desktop, folder.fsPath)) {
			if (f.kind === 'browser' && !this.layer.has('browser')) {
				this.floatBrowserAt(folder, f, true);
			} else if (f.kind === 'agent' && !this.layer.has('agent')) {
				this.floatAgentAt(f.id, f, true);
			}
		}
	}

	/** Asks the daemon to keep what floats now, when it differs from what it keeps. */
	private keep(floating: Floating[]): void {
		const folder = this.folder();
		if (!folder || sameFloating(floating, floatingIn(this.desktop, folder.fsPath))) {
			return;
		}
		const layout = withFloating(this.desktop, folder.fsPath, floating);
		// The daemon's notice follows; until then, what was asked is what floats.
		this.desktop = { ...this.desktop, layout };
		this.daemon.client.request({ op: 'set_desktop', key: 'layout', value: layout });
	}
}
