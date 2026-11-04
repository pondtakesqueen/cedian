/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/blocks.css';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { EditorsOrder } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { BlockLayer } from './blocks/layer.js';
import { floatingIn, sameFloating, withFloating, type Floating } from './blocks/layout.js';
import { browserServices, CedianBrowserInput, createBrowserPanel, openBrowser } from './browserEditor.js';
import { ICedianDaemonService } from './daemonService.js';
import { connectionBar } from './panes.js';
import { desktopOf, type Desktop } from './settings/desktop.js';

/**
 * The main window's block layer (spec §3.3, §4.4): blocks floating over the workbench as PiPs.
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
	) {
		super();
		this.layer = new BlockLayer(mainWindow.document, {
			dock: kind => {
				if (kind === 'browser') {
					void openBrowser(this.editorService);
				}
			},
			changed: floating => this.keep(floating),
		});
		layoutService.mainContainer.append(this.layer.root);
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

	/** Opens what floated in this project when the last window closed. */
	private restore(): void {
		const folder = this.folder();
		if (!folder) {
			return;
		}
		for (const f of floatingIn(this.desktop, folder.fsPath)) {
			if (f.kind === 'browser' && !this.layer.has('browser')) {
				this.floatBrowserAt(folder, f, true);
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
