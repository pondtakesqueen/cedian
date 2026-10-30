/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/browserPanel.css';
import { Dimension } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { EditorInputCapabilities, IEditorOpenContext, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { AGENT_PANE_VIEW_ID } from './agentPaneView.js';
import { devServers, LAUNCH_FILES, type DevServer } from './browser-panel/launch.js';
import { BrowserPanel } from './browser-panel/panel.js';
import type { Socket } from './browser-panel/cdp.js';
import { ICedianDaemonService } from './daemonService.js';
import { CedianPanes, connectionBar } from './panes.js';

/** The Browser block as an editor: one per window, so it splits, drags and pops out like any editor. */
export class CedianBrowserInput extends EditorInput {
	static readonly ID = 'workbench.input.cedian.browser';

	private title = 'Browser';

	/** The tab's label: the page's title while the block shows one. */
	setTitle(title: string): void {
		if (title !== this.title) {
			this.title = title;
			this._onDidChangeLabel.fire();
		}
	}

	override get typeId(): string {
		return CedianBrowserInput.ID;
	}

	override get editorId(): string | undefined {
		return CedianBrowserEditor.ID;
	}

	override get resource(): URI | undefined {
		return undefined;
	}

	override getName(): string {
		return this.title;
	}

	override matches(other: EditorInput | unknown): boolean {
		return other instanceof CedianBrowserInput;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}
}

/** Reopens the Browser block after a restart; its tabs are the daemon's, so nothing else is kept. */
export class CedianBrowserInputSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return true;
	}

	serialize(): string {
		return '{}';
	}

	deserialize(): CedianBrowserInput {
		return new CedianBrowserInput();
	}
}

/** Shows the Browser block, opening it beside the editor when it is not open. */
export async function openBrowser(editorService: IEditorService): Promise<void> {
	await editorService.openEditor(new CedianBrowserInput(), { pinned: true });
}

/** A command line a shell reads back as `command` and `args`. */
function shellLine(command: string, args: string[]): string {
	const quote = (word: string) => /^[A-Za-z0-9_./:=@%+-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
	return [command, ...args].map(quote).join(' ');
}

export class CedianBrowserEditor extends EditorPane {
	static readonly ID = 'workbench.editor.cedian.browser';

	private container: HTMLElement | undefined;
	private panel: BrowserPanel | undefined;
	private readonly drawn = this._register(new DisposableStore());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICedianDaemonService private readonly daemon: ICedianDaemonService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@INotificationService private readonly notifications: INotificationService,
		@IFileService private readonly fileService: IFileService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IViewsService private readonly viewsService: IViewsService,
		@ICommandService private readonly commands: ICommandService,
	) {
		super(CedianBrowserEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = parent;
	}

	override async setInput(input: CedianBrowserInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!token.isCancellationRequested && this.container && !this.panel) {
			this.draw(this.container);
		}
	}

	private draw(container: HTMLElement): void {
		const folder = this.workspace.getWorkspace().folders[0];
		if (!folder || folder.uri.scheme !== 'file') {
			const empty = mainWindow.document.createElement('div');
			empty.className = 'cedian-browser';
			empty.textContent = 'Open the project\'s folder first; its dev servers and sites belong to it';
			container.append(empty);
			this.drawn.add({ dispose: () => empty.remove() });
			return;
		}
		const folderUri = folder.uri;
		const panel = new BrowserPanel(mainWindow.document, this.daemon.client, {
			cwd: folderUri.fsPath,
			mac: isMacintosh,
			// The page's DevTools socket on 127.0.0.1 (the workbench's CSP allows ws:).
			connect: url => new mainWindow.WebSocket(url) as unknown as Socket,
			// Spec §8.4: the browser's transient errors are notifications.
			notify: message => this.notifications.warn(message),
			attach: (text, png) => { this.attach(text, png).catch(e => this.notifications.warn(`Couldn't add the element to the composer: ${e instanceof Error ? e.message : e}`)); },
			devServers: () => this.devServers(folderUri),
			runDevServer: server => { this.runDevServer(folderUri, server).catch(e => this.notifications.warn(`Couldn't start ${server.name}: ${e instanceof Error ? e.message : e}`)); },
			openSettings: () => { this.commands.executeCommand('cedian.settings'); },
		});
		this.panel = panel;
		this.drawn.add({ dispose: () => { panel.dispose(); this.panel = undefined; } });
		this.drawn.add({ dispose: panel.onTitle(title => (this.input as CedianBrowserInput | undefined)?.setTitle(title)) });
		container.append(panel.root);
		this.drawn.add(connectionBar(panel.root, this.daemon.client));
	}

	/** Into the agent pane's composer, showing the pane first. */
	private async attach(text: string, png: Uint8Array | undefined): Promise<void> {
		if (!CedianPanes.current) {
			await this.viewsService.openView(AGENT_PANE_VIEW_ID, true);
		}
		const pane = CedianPanes.current;
		if (!pane) {
			throw new Error('the agent pane did not open');
		}
		await pane.addContext(text, png);
	}

	private async devServers(folder: URI): Promise<DevServer[]> {
		for (const name of LAUNCH_FILES) {
			const file = joinPath(folder, name);
			if (await this.fileService.exists(file)) {
				return devServers((await this.fileService.readFile(file)).value.toString());
			}
		}
		return [];
	}

	/** In a terminal of its own, named after the server, so its output and Ctrl+C are the person's. */
	private async runDevServer(folder: URI, server: DevServer): Promise<void> {
		const terminal = await this.terminalService.createTerminal({
			config: { name: server.name, env: server.env },
			cwd: server.cwd ? joinPath(folder, server.cwd) : folder,
		});
		await terminal.sendText(shellLine(server.command, server.args), true);
		await this.terminalService.revealTerminal(terminal, true);
	}

	override clearInput(): void {
		this.drawn.clear();
		this.container?.replaceChildren();
		super.clearInput();
	}

	override focus(): void {
		super.focus();
		this.panel?.focus();
	}

	layout(dimension: Dimension): void {
		this.panel?.layout(dimension.width, dimension.height);
	}
}
