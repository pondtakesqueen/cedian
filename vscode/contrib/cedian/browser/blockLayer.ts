/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/blocks.css';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { URI } from '../../../../base/common/uri.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { EditorGroupLayout, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { AUX_WINDOW_GROUP, IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { moving } from './blocks/motion.js';
import { BlockLayer } from './blocks/layer.js';
import { floatingIn, sameFloating, withFloating, type Floating } from './blocks/layout.js';
import { layoutName, layoutsIn, withCurrent, withLayout, withoutLayout, type NamedLayout } from './blocks/layouts.js';
import { AgentBlock } from './agent-pane/floating.js';
import { AgentPane, type SideSource } from './agent-pane/pane.js';
import { CedianAgentInput } from './agentEditor.js';
import { CedianBrowserInput, openBrowser } from './browserEditor.js';
import { NativeBrowserBlock } from './nativeFloat.js';
import { BrowserEditorInput } from '../../browserView/common/browserEditorInput.js';
import type { IBrowserViewModel } from '../../browserView/common/browserView.js';
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
	/** The native page floating now, when it is: docking or tearing it off gives its input back. */
	private native: NativeBrowserBlock | undefined;
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
		@ICommandService private readonly commands: ICommandService,
	) {
		super();
		this.layer = new BlockLayer(mainWindow.document, {
			dock: (kind, id) => {
				if (kind === 'browser') {
					const native = this.native;
					this.native = undefined;
					if (native) {
						void this.editorService.openEditor(native.dock(), { pinned: true });
					} else {
						void openBrowser(this.editorService, this.commands);
					}
				} else if (kind === 'agent') {
					// Into the editor area beside the code, as a popped-out pane is in its own window.
					void this.editorService.openEditor(new CedianAgentInput(id), { pinned: true });
				}
			},
			// It slides to the block it docks into: the active one, where the editor opens.
			landing: () => {
				const element = (this.editorGroups.mainPart.activeGroup as { element?: HTMLElement }).element;
				return element?.offsetParent ? element.getBoundingClientRect() : undefined;
			},
			moving: () => moving(layoutService.mainContainer),
			changed: floating => this.keep(floating),
			closed: kind => {
				if (kind === 'browser') {
					this.native = undefined;
				}
			},
			// Torn off (↗, or let go outside the window): an editor of its own in a new window there.
			tearOff: (kind, id, bounds) => { void this.tearOff(kind, id, bounds); },
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
			this.showLayoutName();
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

	/** Floats the Browser block, closing its editor: the page moves, it is not copied. */
	async floatBrowser(): Promise<void> {
		const folder = this.folder();
		if (!folder || this.layer.has('browser')) {
			return;
		}
		await this.floatBrowserAt(floatingIn(this.desktop, folder.fsPath).find(f => f.kind === 'browser'), false);
	}

	dockBrowser(): void {
		if (this.layer.has('browser')) {
			this.layer.dock('browser');
		} else {
			void openBrowser(this.editorService, this.commands);
		}
	}

	/** The window's native browser page, open in an editor: there is one per window. */
	private nativeInput(): BrowserEditorInput | undefined {
		return this.editorService.editors.find((editor): editor is BrowserEditorInput => editor instanceof BrowserEditorInput);
	}

	/**
	 * Floats the native page at `at`: its tab closes with the page kept (the input's disposal is
	 * vetoed), and a block over the window lays the same page out where it rests. With none open
	 * yet, a blank one opens first.
	 */
	private async floatBrowserAt(at: Floating | undefined, quiet: boolean): Promise<void> {
		let input = this.nativeInput();
		if (!input) {
			await this.commands.executeCommand('workbench.action.browser.open', 'about:blank');
			input = this.nativeInput();
		}
		if (!input || this.layer.has('browser')) {
			return;
		}
		const model = await modelOf(input);
		if (!model || this.layer.has('browser')) {
			return;
		}
		const keep = input.onBeforeDispose(e => e.veto());
		try {
			await this.editorService.closeEditors(this.editorService.findEditors(input));
		} finally {
			keep.dispose();
		}
		this.native = new NativeBrowserBlock(input, model);
		this.layer.float(this.native, at, quiet);
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

	/**
	 * A side chat on `from` (⌘;, `/btw`): the daemon copies the thread as it stands, and the copy
	 * floats beside it, read-only, asked `text` first when given. Closing it throws it away; the
	 * daemon does too when the window goes. One at a time: a new one replaces the last.
	 */
	sideChat(from: SideSource, text?: string): void {
		const folder = this.folder();
		if (!folder) {
			return;
		}
		const client = this.daemon.client;
		const offs: (() => void)[] = [];
		const done = () => { for (const off of offs.splice(0)) { off(); } };
		offs.push(client.on('side_chat', notice => {
			if (notice.from === from.thread) {
				done();
				this.floatSide(folder, notice.thread, from, text);
			}
		}));
		// A cedia that cannot, or a fork that failed, says so on the thread; the pane shows it there.
		offs.push(client.on('error', notice => {
			if (notice.thread === from.thread) {
				done();
				this.notifications.warn(`Couldn't open a side chat: ${notice.message}`);
			}
		}));
		client.request({ op: 'side', cwd: folder.fsPath, thread: from.thread });
	}

	/** Fans the floating blocks out to see them all, or folds them back. */
	toggleFan(): void {
		this.layer.toggleFan();
	}

	/** Closes the side chat, throwing it away; false when none floats. */
	closeSide(): boolean {
		if (!this.layer.has('side')) {
			return false;
		}
		this.layer.close('side');
		return true;
	}

	private floatSide(folder: URI, thread: string, from: SideSource, text: string | undefined): void {
		const host = this.instantiation.invokeFunction(accessor => createPaneHost(accessor, this.workspace.getWorkspace().folders[0], {
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
			side: true,
			release: () => {
				bar.dispose();
				listed.dispose();
				scoped.dispose();
				wire.dispose();
				// Thrown away: the daemon stops it if it works and deletes it.
				this.daemon.client.request({ op: 'delete', cwd: folder.fsPath, thread });
			},
		});
		pane.side(thread, from, text);
		// Bottom left: the Browser block rests bottom right and a floating thread top right.
		this.layer.float(block, { corner: 'bl', width: 400, height: 480 });
		block.focus();
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

	/** A block torn off: its editor in a window of its own at `bounds` (screen pixels). */
	private async tearOff(kind: string, id: string | undefined, bounds: { x: number; y: number; width: number; height: number }): Promise<void> {
		const options = { pinned: true, auxiliary: { bounds, compact: true } };
		try {
			if (kind === 'browser') {
				const native = this.native;
				this.native = undefined;
				await this.editorService.openEditor(native ? native.dock() : new CedianBrowserInput(), options, AUX_WINDOW_GROUP);
			} else if (kind === 'agent') {
				await this.editorService.openEditor(new CedianAgentInput(id), options, AUX_WINDOW_GROUP);
			}
		} catch (e) {
			this.notifications.warn(`Couldn't open a new window: ${e instanceof Error ? e.message : e}`);
		}
	}

	// ---- named layouts ----

	private readonly layoutMenu = this._register(new MutableDisposable());
	private shownLayout: string | undefined;

	/** The title bar's layout picker, named for the layout the window is in (the prototype's chip). */
	private showLayoutName(): void {
		const { layouts, current } = this.layouts();
		const name = current ?? layouts[0]?.name ?? 'Layout';
		if (name === this.shownLayout) {
			return;
		}
		this.shownLayout = name;
		this.layoutMenu.value = MenuRegistry.appendMenuItem(MenuId.TitleBar, {
			command: { id: 'cedian.switchLayout', title: `${name} ▾` },
			group: 'navigation',
			order: 2,
		});
	}

	/** The project's layouts and the current one's name (the starters until it saves its own). */
	layouts(): { layouts: NamedLayout[]; current?: string } {
		const folder = this.folder();
		return folder ? layoutsIn(this.desktop, folder.fsPath) : { layouts: [] };
	}

	/** Saves what is open where now (the editor area's split and what floats) as `name`, current. */
	saveLayout(name: string): void {
		const folder = this.folder();
		const kept = layoutName(name);
		if (!folder || !kept) {
			return;
		}
		this.write(withLayout(this.desktop, folder.fsPath, { name: kept, pip: this.layer.floating(), groups: this.editorGroups.getLayout() }));
	}

	deleteLayout(name: string): void {
		const folder = this.folder();
		if (folder) {
			this.write(withoutLayout(this.desktop, folder.fsPath, name));
		}
	}

	/** Switches to the layout `name`: the editor area splits as it did, and its blocks float. */
	switchLayout(name: string): void {
		const folder = this.folder();
		const layout = this.layouts().layouts.find(l => l.name === name);
		if (!folder || !layout) {
			return;
		}
		if (layout.groups) {
			try {
				this.editorGroups.applyLayout(layout.groups as EditorGroupLayout);
			} catch (e) {
				this.notifications.warn(`Couldn't arrange the editors as ${name}: ${e instanceof Error ? e.message : e}`);
			}
		}
		this.applyFloating(folder, layout.pip);
		this.write(withCurrent(this.desktop, folder.fsPath, name));
	}

	/** The `n`th layout (from 0), for ⌘⌥1–9. */
	switchLayoutAt(n: number): void {
		const layout = this.layouts().layouts[n];
		if (layout) {
			this.switchLayout(layout.name);
		}
	}

	/** Floats what `pip` lists where it lists it, and closes what floats that it does not list. */
	private applyFloating(folder: URI, pip: Floating[]): void {
		for (const now of this.layer.floating()) {
			const want = pip.find(f => f.kind === now.kind);
			if (!want || want.id !== now.id) {
				this.layer.close(now.kind);
			}
		}
		for (const f of pip) {
			if (this.layer.has(f.kind)) {
				// The size first: a size takes a block out of its stash, and the rest puts it back.
				this.layer.resizeTo(f.kind, { width: f.width, height: f.height });
				this.layer.moveTo(f.kind, f);
			} else if (f.kind === 'browser') {
				void this.floatBrowserAt(f, false);
			} else if (f.kind === 'agent') {
				this.floatAgentAt(f.id, f, false);
			}
		}
	}

	/** Asks the daemon to keep `layout` as `desktop.layout`; until its notice, it is what is kept. */
	private write(layout: Record<string, unknown>): void {
		this.desktop = { ...this.desktop, layout };
		this.showLayoutName();
		this.daemon.client.request({ op: 'set_desktop', key: 'layout', value: layout });
	}

	/** Opens what floated in this project when the last window closed. */
	private restore(): void {
		const folder = this.folder();
		if (!folder) {
			return;
		}
		for (const f of floatingIn(this.desktop, folder.fsPath)) {
			if (f.kind === 'browser' && !this.layer.has('browser')) {
				void this.floatBrowserAt(f, true);
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
		// The daemon's notice follows; until then, what was asked is what floats.
		this.write(withFloating(this.desktop, folder.fsPath, floating));
	}
}

/** The page of a native browser input, once it has one (it does once its editor showed it). */
function modelOf(input: BrowserEditorInput): Promise<IBrowserViewModel | undefined> {
	return new Promise(resolve => {
		const timer = setTimeout(() => { listening.dispose(); resolve(undefined); }, 5_000);
		const listening = input.onceModelResolves(model => { clearTimeout(timer); resolve(model); });
	});
}
