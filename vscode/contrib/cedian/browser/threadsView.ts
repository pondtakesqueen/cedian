/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/threadList.css';
import { $, append } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
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
import { EditorsOrder } from '../../../common/editor.js';
import { GroupDirection, GroupsOrder, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import type { AgentPane } from './agent-pane/pane.js';
import { ThreadList } from './agent-pane/thread-list.js';
import { CedianAgentInput } from './agentEditor.js';
import { ICedianDaemonService } from './daemonService.js';
import { CedianPanes, connectionBar } from './panes.js';

export const THREADS_CONTAINER_ID = 'workbench.view.cedian.threads';
export const THREADS_VIEW_ID = 'workbench.view.cedian.threads.list';

/** The agent in the middle (the prototype's): the agent editor in the main window's editor area. */
export function centerPane(): AgentPane | undefined {
	const editors = mainWindow.document.querySelector('.part.editor');
	return [...CedianPanes.all].reverse().find(p => editors?.contains(p.root));
}

/**
 * The agent in the middle, opened where the prototype has it when there is none: an agent editor
 * in a group of its own at the left of the editor area, locked so files open beside it.
 */
export async function ensureCenter(editorService: IEditorService, editorGroups: IEditorGroupsService, thread?: string): Promise<AgentPane | undefined> {
	const shown = centerPane();
	if (shown) {
		const open = editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).find(e => e.editor instanceof CedianAgentInput && editorGroups.mainPart.getGroup(e.groupId));
		if (open) {
			await editorService.openEditor(open.editor, { pinned: true, preserveFocus: false }, open.groupId);
		}
		return shown;
	}
	const main = editorGroups.mainPart;
	const first = main.getGroups(GroupsOrder.GRID_APPEARANCE)[0];
	const group = !first || first.isEmpty ? first ?? main.activeGroup : main.addGroup(first, GroupDirection.LEFT);
	await editorService.openEditor(new CedianAgentInput(thread), { pinned: true }, group);
	group.lock(true);
	return centerPane();
}

/** The Threads list (the prototype's left column), opening what is picked in the agent in the middle. */
export class ThreadsView extends ViewPane {

	private list: ThreadList | undefined;

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
		@IEditorGroupsService private readonly editorGroups: IEditorGroupsService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		const folder = this.workspace.getWorkspace().folders[0];
		if (!folder || folder.uri.scheme !== 'file') {
			append(parent, $('.cedian-thread-list')).textContent = 'Open the project\'s folder first';
			return;
		}
		const center = (act: (pane: AgentPane) => void, thread?: string) => {
			ensureCenter(this.editorService, this.editorGroups, thread).then(pane => {
				if (pane) {
					act(pane);
					pane.focusComposer();
				}
				this.list?.refresh();
			}, () => { });
		};
		const wire = CedianPanes.wire(this.daemon.client);
		const list = new ThreadList(parent.ownerDocument, wire, {
			cwd: folder.uri.fsPath,
			open: thread => center(p => p.openThread(thread), thread),
			newThread: () => center(p => p.newThread()),
			projectChat: () => center(p => p.projectChat()),
			current: () => centerPane()?.thread,
		});
		this.list = list;
		this._register({ dispose: () => { list.dispose(); wire.dispose(); } });
		parent.append(list.root);
		this._register(connectionBar(list.root, this.daemon.client));
		// The thread the agent shows changes as the person picks one there too.
		this._register(this.editorService.onDidActiveEditorChange(() => list.refresh()));
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.list) {
			this.list.root.style.height = `${height}px`;
		}
	}
}
