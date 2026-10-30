/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/agentPane.css';
import { $, append } from '../../../../base/browser/dom.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { AgentPane } from './agent-pane/pane.js';
import { popOutThread } from './agentEditor.js';
import { ICedianDaemonService } from './daemonService.js';
import { createPaneHost } from './paneHost.js';
import { CedianPanes, connectionBar } from './panes.js';

export const AGENT_PANE_CONTAINER_ID = 'workbench.view.cedian.agent';
export const AGENT_PANE_VIEW_ID = 'workbench.view.cedian.agent.pane';

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
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService,
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
		const host = this.instantiationService.invokeFunction(accessor => createPaneHost(accessor, folder, {
			popOut: thread => { popOutThread(this.editorService, thread).catch(e => this.notifications.warn(`Couldn't open a new window: ${e instanceof Error ? e.message : e}`)); },
		}));
		const wire = CedianPanes.wire(this.daemon.client);
		const pane = new AgentPane(parent.ownerDocument, wire, host);
		this.pane = pane;
		this._register({ dispose: () => { pane.dispose(); wire.dispose(); } });
		this._register(CedianPanes.add(pane, this.scopedContextKeyService));
		parent.append(pane.root);
		this._register(connectionBar(pane.root, this.daemon.client));
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
}
