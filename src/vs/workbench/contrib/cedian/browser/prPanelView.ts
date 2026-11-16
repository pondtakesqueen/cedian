/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/prPanel.css';
import { $, append } from '../../../../base/browser/dom.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { PrPanel } from './agent-pane/pr-panel.js';
import { ICedianDaemonService } from './daemonService.js';
import { CedianPanes, connectionBar } from './panes.js';
import { projectFolder } from './projectFolder.js';
import { PR_CONTAINER } from './blocks/places.js';
import { centerPane } from './threadsView.js';

export const PR_PANEL_CONTAINER_ID = PR_CONTAINER;
export const PR_PANEL_VIEW_ID = 'workbench.view.cedian.pr.panel';

/** The thread's pull request in the right panel, following the agent in the middle (pr-panel.ts). */
export class PrPanelView extends ViewPane {

	private panel: PrPanel | undefined;

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
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		const folder = projectFolder(this.workspace);
		if (!folder) {
			append(parent, $('.cedian-pr-panel')).textContent = 'Open the project\'s folder first';
			return;
		}
		const wire = CedianPanes.wire(this.daemon.client);
		const panel = new PrPanel(parent.ownerDocument, wire, {
			cwd: folder.uri.fsPath,
			thread: () => centerPane()?.thread,
			openUrl: url => { this.openerService.open(URI.parse(url), { openExternal: true }); },
			openDiff: (thread, view) => centerPane()?.openPrDiff(thread, view),
		});
		this.panel = panel;
		this._register({ dispose: () => { panel.dispose(); wire.dispose(); } });
		parent.append(panel.root);
		this._register(connectionBar(panel.root, this.daemon.client));
		this._register(this.editorService.onDidActiveEditorChange(() => panel.refresh()));
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.panel) {
			this.panel.root.style.height = `${height}px`;
		}
	}
}
