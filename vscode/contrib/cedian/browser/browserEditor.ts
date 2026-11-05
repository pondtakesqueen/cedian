/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

// The Browser block (spec §6.3) is VS Code's native browser view; what it needs of Cedian lives
// here: opening it, the services its tools draw with, attaching to the composer, dev servers.
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { AGENT_PANE_VIEW_ID } from './agentPaneView.js';
import { devServers, LAUNCH_FILES, type DevServer } from './browser-panel/launch.js';
import { ICedianDaemonService } from './daemonService.js';
import type { AgentPane } from './agent-pane/pane.js';
import { NativeFloat } from './nativeFloat.js';
import { CedianPanes } from './panes.js';

/** VS Code's own browser editor (workbench/contrib/browserView): its input type and open command. */
export const NATIVE_BROWSER_INPUT = 'workbench.editorinputs.browser';
const NATIVE_BROWSER_OPEN = 'workbench.action.browser.open';

/**
 * Shows the Browser block: VS Code's native browser view (a WebContentsView, laid out in the same
 * frame as a resize), one per window, revealed when it is open, docked back when it floats.
 */
export async function openBrowser(editorService: IEditorService, commands: ICommandService): Promise<void> {
	if (NativeFloat.input) {
		// It floats: it docks back, as the one native page of the window.
		await commands.executeCommand('cedian.dockBrowser');
		return;
	}
	const open = editorService.editors.find(editor => editor.typeId === NATIVE_BROWSER_INPUT);
	if (open) {
		await editorService.openEditor(open);
	} else {
		await commands.executeCommand(NATIVE_BROWSER_OPEN);
	}
}

/** A command line a shell reads back as `command` and `args`. */
function shellLine(command: string, args: string[]): string {
	const quote = (word: string) => /^[A-Za-z0-9_./:=@%+-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
	return [command, ...args].map(quote).join(' ');
}

/** The services the Browser block's tools draw with. */
export interface BrowserServices {
	readonly daemon: ICedianDaemonService;
	readonly notifications: INotificationService;
	readonly fileService: IFileService;
	readonly terminalService: ITerminalService;
	readonly viewsService: IViewsService;
	readonly commands: ICommandService;
}

/** The services the Browser block's tools draw with, read from `accessor` while it is valid. */
export function browserServices(accessor: ServicesAccessor): BrowserServices {
	return {
		daemon: accessor.get(ICedianDaemonService),
		notifications: accessor.get(INotificationService),
		fileService: accessor.get(IFileService),
		terminalService: accessor.get(ITerminalService),
		viewsService: accessor.get(IViewsService),
		commands: accessor.get(ICommandService),
	};
}

/** The agent pane on screen that had focus last: an Agent tab behind another one is out of the page. */
function shownPane(): AgentPane | undefined {
	return [...CedianPanes.all].reverse().find(pane => pane.root.isConnected && pane.root.offsetParent !== null);
}

/** Into the composer of the agent pane the person can see, showing the side pane when none is. */
export async function attach(services: BrowserServices, text: string, png: Uint8Array | undefined, name: string | undefined): Promise<void> {
	if (!shownPane()) {
		await services.viewsService.openView(AGENT_PANE_VIEW_ID, true);
	}
	const pane = shownPane() ?? CedianPanes.current;
	if (!pane) {
		throw new Error('the agent pane did not open');
	}
	await pane.addContext(text, png, name);
}

export async function devServersIn(services: BrowserServices, folder: URI): Promise<DevServer[]> {
	for (const name of LAUNCH_FILES) {
		const file = joinPath(folder, name);
		if (await services.fileService.exists(file)) {
			return devServers((await services.fileService.readFile(file)).value.toString());
		}
	}
	return [];
}

/** In a terminal of its own, named after the server, so its output and Ctrl+C are the person's. */
export async function runDevServer(services: BrowserServices, folder: URI, server: DevServer): Promise<void> {
	const terminal = await services.terminalService.createTerminal({
		config: { name: server.name, env: server.env },
		cwd: server.cwd ? joinPath(folder, server.cwd) : folder,
	});
	await terminal.sendText(shellLine(server.command, server.args), true);
	await services.terminalService.revealTerminal(terminal, true);
}
