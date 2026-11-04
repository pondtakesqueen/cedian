/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { isRecentFolder, IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { projectTabs, type ProjectTab } from './agent-pane/project-tabs.js';
import { ICedianDaemonService } from './daemonService.js';
import { CedianPanes } from './panes.js';
import type { ThreadInfo } from './protocol/wire.js';

/**
 * The project tabs at the left of the title bar, as in the prototype: this window's project and
 * the folders opened lately (src/agent-pane/project-tabs.ts), each with what needs the person and
 * what is at work there, from the daemon's thread list for that folder. A tab opens its project in
 * this window; this window's own tab is marked and does nothing. VS Code's title bar menus all sit
 * on its right, so the tabs are a row of their own at the start of its left side.
 */
export class CedianProjectTabs extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.projectTabs';

	private readonly threads = new Map<string, readonly ThreadInfo[]>();
	private recent: string[] = [];
	private shown = '';
	private row?: HTMLElement;
	private readonly watched = new Set<string>();

	constructor(
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IWorkspacesService private readonly workspaces: IWorkspacesService,
		@IHostService private readonly host: IHostService,
		@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService,
		@ICedianDaemonService daemon: ICedianDaemonService,
	) {
		super();
		const wire = CedianPanes.wire(daemon.client);
		this._register({ dispose: () => wire.dispose() });
		this._register({
			dispose: wire.onAny(n => {
				if (n.kind === 'threads') {
					this.threads.set(n.cwd, n.threads);
					this.show();
				}
			})
		});
		const load = () => this.workspaces.getRecentlyOpened().then(r => {
			this.recent = r.workspaces.filter(isRecentFolder).filter(f => f.folderUri.scheme === 'file').map(f => f.folderUri.fsPath);
			for (const tab of this.tabs()) {
				if (!this.watched.has(tab.root)) {
					this.watched.add(tab.root);
					wire.request({ op: 'threads', cwd: tab.root });
				}
			}
			this.show();
		}, () => { });
		this._register(workspaces.onDidChangeRecentlyOpened(load));
		void load();
		// A working project's dot pulses only while the window has the focus: no work for a window
		// in the background.
		const focus = (on: boolean) => this.layout.mainContainer.classList.toggle('cedian-window-blurred', !on);
		this._register(host.onDidChangeFocus(focus));
		focus(host.hasFocus);
	}

	private current(): string | undefined {
		const folder = this.workspace.getWorkspace().folders[0];
		return folder && folder.uri.scheme === 'file' ? folder.uri.fsPath : undefined;
	}

	private tabs(): ProjectTab[] {
		const current = this.current();
		return current ? projectTabs(current, this.recent, this.threads) : [];
	}

	/** Draws the tabs again when what they say has changed. */
	private show(): void {
		const tabs = this.tabs();
		const key = JSON.stringify(tabs);
		const left = this.layout.getContainer(mainWindow, Parts.TITLEBAR_PART)?.querySelector<HTMLElement>('.titlebar-left');
		if (key === this.shown || !left) {
			return;
		}
		this.shown = key;
		if (!this.row || !this.row.isConnected) {
			this.row = append(left, $('.cedian-project-tabs'));
			this.row.setAttribute('role', 'tablist');
			this.row.setAttribute('aria-label', 'Projects');
			const row = this.row;
			this._register({ dispose: () => row.remove() });
		}
		clearNode(this.row);
		for (const tab of tabs) {
			const button = append(this.row, $<HTMLButtonElement>('button.cedian-project-tab'));
			button.type = 'button';
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-selected', String(tab.on));
			button.title = tab.root;
			button.classList.toggle('on', tab.on);
			append(button, $('span.name')).textContent = tab.name;
			if (tab.needs) {
				append(button, $('span.count.needs', { 'aria-label': `${tab.needs} need you` })).textContent = String(tab.needs);
			}
			if (tab.working) {
				append(button, $('span.count.working', { 'aria-label': `${tab.working} working` })).textContent = String(tab.working);
			}
			button.addEventListener('click', () => {
				if (!tab.on) {
					void this.host.openWindow([{ folderUri: URI.file(tab.root) }], { forceReuseWindow: true });
				}
			});
		}
	}
}
