/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { toAction } from '../../../../base/common/actions.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { cacheText, nextAfterClose, projectName, projectsOf, projectTabs, tabsFromCache, withoutProject, withProject, type ProjectTab } from './agent-pane/project-tabs.js';
import { ICedianDaemonService } from './daemonService.js';
import { CedianPanes } from './panes.js';
import type { ThreadInfo } from './protocol/wire.js';
import { addRoot, desktopOf, rootsOf, type Desktop } from './settings/desktop.js';

/**
 * The project tabs at the left of the title bar, as in the prototype: the person's projects
 * (`desktop.projects`, src/agent-pane/project-tabs.ts), each with what needs the person and what is
 * at work there, from the daemon's thread list for that folder. A tab opens its project in this
 * window; its × takes it off the bar (this window's own moves to the next tab first). The + after
 * them opens another project or adds a repo to this one (`desktop.roots`). The folder a window
 * opens joins the bar. VS Code's title bar menus all sit on its right, so the tabs are a row of
 * their own at the start of its left side. A switch loads the window again (behind the curtain,
 * curtain.ts), so the tabs are drawn from the restore phase, from what the last window drew, until
 * the daemon answers, and are left in place as the window shuts down.
 */
/** The tabs as the last window drew them (tabsFromCache). */
const CACHE_KEY = 'cedian.projectTabs';

export class CedianProjectTabs extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.projectTabs';

	private readonly threads = new Map<string, readonly ThreadInfo[]>();
	/** `desktop` as the daemon last sent it; undefined until its first notice. */
	private desktop?: Desktop;
	private shown = '';
	private row?: HTMLElement;
	private readonly watched = new Set<string>();
	private readonly wire: ReturnType<typeof CedianPanes.wire>;
	/** What the last window drew, until the daemon has said what this one draws. */
	private readonly cached: ProjectTab[] | undefined;

	constructor(
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IHostService private readonly host: IHostService,
		@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService,
		@IFileDialogService private readonly dialogs: IFileDialogService,
		@IFileService private readonly files: IFileService,
		@IContextMenuService private readonly menus: IContextMenuService,
		@INotificationService private readonly notifications: INotificationService,
		@ICedianDaemonService private readonly daemon: ICedianDaemonService,
		@IStorageService private readonly storage: IStorageService,
	) {
		super();
		const current = this.current();
		this.cached = current ? tabsFromCache(storage.get(CACHE_KEY, StorageScope.APPLICATION), current) : undefined;
		const wire = this.wire = CedianPanes.wire(daemon.client);
		this._register({ dispose: () => wire.dispose() });
		this._register({
			dispose: wire.onAny(n => {
				if (n.kind === 'threads') {
					this.threads.set(n.cwd, n.threads);
					this.show();
				}
			})
		});
		this._register(toDisposable(daemon.client.on('settings', notice => {
			const first = !this.desktop;
			this.desktop = desktopOf(notice.desktop);
			// The folder this window opened is one of the person's projects from now on.
			const current = this.current();
			const joined = first && current ? withProject(projectsOf(this.desktop), current) : undefined;
			if (joined) {
				this.writeProjects(joined);
			}
			this.show();
		})));
		daemon.client.request({ op: 'settings' });
		// A working project's dot pulses only while the window has the focus: no work for a window
		// in the background.
		const focus = (on: boolean) => this.layout.mainContainer.classList.toggle('cedian-window-blurred', !on);
		this._register(host.onDidChangeFocus(focus));
		focus(host.hasFocus);
		this.show();
	}

	private current(): string | undefined {
		const folder = this.workspace.getWorkspace().folders[0];
		return folder && folder.uri.scheme === 'file' ? folder.uri.fsPath : undefined;
	}

	private projects(): string[] {
		return this.desktop ? projectsOf(this.desktop) : [];
	}

	private tabs(): ProjectTab[] {
		const current = this.current();
		if (!current) {
			return [];
		}
		if (!this.desktop) {
			return this.cached ?? projectTabs(current, [], this.threads);
		}
		// A project whose threads the daemon hasn't sent yet keeps the counts the last window drew.
		return projectTabs(current, this.projects(), this.threads).map(tab => {
			const last = this.threads.has(tab.root) ? undefined : this.cached?.find(c => c.root === tab.root);
			return last ? { ...tab, needs: last.needs, working: last.working } : tab;
		});
	}

	/** Asks the daemon to keep `projects` as `desktop.projects`; until its notice, it is what is kept. */
	private writeProjects(projects: string[]): void {
		this.desktop = { ...this.desktop, projects };
		this.daemon.client.request({ op: 'set_desktop', key: 'projects', value: projects });
		this.show();
	}

	private open(root: string): void {
		void this.host.openWindow([{ folderUri: URI.file(root) }], { forceReuseWindow: true });
	}

	/** Takes a tab off the bar; this window's own first moves the window to the next tab. */
	private close(tab: ProjectTab, tabs: readonly ProjectTab[]): void {
		const next = tab.on ? nextAfterClose(tabs, tab.root) : undefined;
		if (tab.on && !next) {
			return;
		}
		this.writeProjects(withoutProject(this.projects(), tab.root));
		if (next) {
			this.open(next);
		}
	}

	/** A folder picked in the system's dialog, or undefined when the person cancels. */
	private async pickFolder(title: string): Promise<string | undefined> {
		const picked = await this.dialogs.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, title, openLabel: 'Choose' });
		const uri = picked?.[0];
		return uri && uri.scheme === 'file' ? uri.fsPath : undefined;
	}

	/** Opens a project in this window, adding its tab. */
	private async openProject(): Promise<void> {
		const root = await this.pickFolder('Open project');
		if (!root) {
			return;
		}
		const joined = withProject(this.projects(), root);
		if (joined) {
			this.writeProjects(joined);
		}
		if (root !== this.current()) {
			this.open(root);
		}
	}

	/** Adds a git repository to this window's project as one more root (Settings → Roots does the same). */
	private async addRepo(): Promise<void> {
		const primary = this.current();
		if (!primary || !this.desktop) {
			return;
		}
		const path = await this.pickFolder(`Add a repo to ${projectName(primary)}`);
		if (!path) {
			return;
		}
		const isRepo = await this.files.exists(joinPath(URI.file(path), '.git')).catch(() => false);
		const result = addRoot(this.desktop, primary, path, isRepo);
		if ('error' in result) {
			this.notifications.warn(result.error);
			return;
		}
		this.desktop = { ...this.desktop, roots: result.roots };
		this.daemon.client.request({ op: 'set_desktop', key: 'roots', value: result.roots });
		this.notifications.info(`Added ${path} to this project's repos`);
		this.show();
	}

	private addMenu(anchor: HTMLElement): void {
		this.menus.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => [
				toAction({ id: 'cedian.projectTabs.open', label: 'Open Project…', run: () => this.openProject() }),
				toAction({ id: 'cedian.projectTabs.addRepo', label: 'Add Repo to This Project…', enabled: !!this.current() && !!this.desktop, run: () => this.addRepo() }),
			],
		});
	}

	/** Draws the tabs again when what they say has changed. */
	private show(): void {
		const tabs = this.tabs();
		const current = this.current();
		const roots = current && this.desktop ? rootsOf(this.desktop, current) : [];
		const key = JSON.stringify([tabs, roots]);
		const left = this.layout.getContainer(mainWindow, Parts.TITLEBAR_PART)?.querySelector<HTMLElement>('.titlebar-left');
		if (key === this.shown || !left) {
			return;
		}
		this.shown = key;
		if (this.desktop) {
			this.storage.store(CACHE_KEY, cacheText(tabs), StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
		for (const tab of tabs) {
			if (!this.watched.has(tab.root)) {
				this.watched.add(tab.root);
				this.wire.request({ op: 'threads', cwd: tab.root });
			}
		}
		if (!this.row || !this.row.isConnected) {
			this.row = append(left, $('.cedian-project-tabs'));
			this.row.setAttribute('role', 'tablist');
			this.row.setAttribute('aria-label', 'Projects');
			// Never taken out: it goes with the window, and a window shutting down for a tab switch
			// keeps its tabs on show until the next one draws them.
		}
		clearNode(this.row);
		const closable = tabs.length > 1;
		for (const tab of tabs) {
			const button = append(this.row, $<HTMLButtonElement>('button.cedian-project-tab'));
			button.type = 'button';
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-selected', String(tab.on));
			// This window's tab names every repo the project works in.
			button.title = tab.on && roots.length > 1 ? roots.join('\n') : tab.root;
			button.classList.toggle('on', tab.on);
			append(button, $('span.name')).textContent = tab.name;
			if (tab.needs) {
				append(button, $('span.count.needs', { 'aria-label': `${tab.needs} need you` })).textContent = String(tab.needs);
			}
			if (tab.working) {
				append(button, $('span.count.working', { 'aria-label': `${tab.working} working` })).textContent = String(tab.working);
			}
			if (closable) {
				const x = append(button, $('span.close', { role: 'button', 'aria-label': `Close ${tab.name}`, title: 'Close project tab' }));
				x.textContent = '×';
				x.addEventListener('click', e => {
					e.stopPropagation();
					this.close(tab, tabs);
				});
			}
			button.addEventListener('click', () => {
				if (!tab.on) {
					// Marked at once: the window takes a moment to start loading the project.
					for (const other of this.row?.querySelectorAll<HTMLElement>('.cedian-project-tab') ?? []) {
						other.classList.toggle('on', other === button);
						other.setAttribute('aria-selected', String(other === button));
					}
					this.open(tab.root);
				}
			});
			// A middle click closes, as on a browser tab; Delete does from the keyboard.
			button.addEventListener('auxclick', e => {
				if (e.button === 1 && closable) {
					e.preventDefault();
					this.close(tab, tabs);
				}
			});
			button.addEventListener('keydown', e => {
				if ((e.key === 'Delete' || e.key === 'Backspace') && closable) {
					e.preventDefault();
					this.close(tab, tabs);
				}
			});
		}
		const add = append(this.row, $<HTMLButtonElement>('button.cedian-project-add'));
		add.type = 'button';
		add.textContent = '+';
		add.title = 'Open a project or add a repo';
		add.setAttribute('aria-label', 'Open a project or add a repo');
		add.addEventListener('click', () => this.addMenu(add));
	}
}
