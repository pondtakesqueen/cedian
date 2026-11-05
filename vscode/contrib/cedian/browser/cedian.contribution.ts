/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/workbench.css';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCodeUtils, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { Extensions as ConfigurationExtensions, IConfigurationDefaults, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ColorScheme } from '../../../../platform/theme/common/theme.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { EditorExtensions, IEditorFactoryRegistry } from '../../../common/editor.js';
import { IViewContainersRegistry, IViewsRegistry, ViewContainerLocation, Extensions as ViewExtensions } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { CedianAgentEditor, CedianAgentInput, CedianAgentInputSerializer } from './agentEditor.js';
import { CedianBrowserEditor, CedianBrowserInput, CedianBrowserInputSerializer, openBrowser } from './browserEditor.js';
import { AgentPaneView, AGENT_PANE_CONTAINER_ID, AGENT_PANE_VIEW_ID } from './agentPaneView.js';
import { CedianBlockLayer } from './blockLayer.js';
import { CedianWindowPlaces } from './windowPlaces.js';
import { CedianBlockMove } from './blockMove.js';
import { MOTION_PROPERTIES } from './blocks/motion.js';
import { CedianTabMove } from './tabMove.js';
import { CedianToolStrip, openTool } from './toolStrip.js';
import { CedianDropTarget } from './dropTarget.js';
import { CedianBlockStretch } from './blockStretch.js';
import { CedianProjectTabs } from './projectTabs.js';
import { TOOL_PICKS } from './blocks/places.js';
import { CheckForUpdatesAction } from './checkForUpdates.js';
import { ICedianDaemonService } from './daemonService.js';
import { runInlineEdit } from './inlineEdit.js';
import './lineComments.js';
import { KEYBINDINGS, parseKey, withKeymap } from './keybindings/keybindings.js';
import { CedianPanes } from './panes.js';
import { CedianSettingsEditor, CedianSettingsInput } from './settingsEditor.js';
import { CedianTabCompletion } from './tabCompletion.js';
import { CedianWelcomeCheck } from './welcomeCheck.js';
import { CedianNativeBrowser } from './nativeBrowser.js';
import { THREADS_CONTAINER_ID, THREADS_VIEW_ID, ThreadsView } from './threadsView.js';
import { appIconOf, desktopOf, paneTypography, vscodeSettings, type Desktop } from './settings/desktop.js';
import { cssText } from './theme/theme.js';
import type { AgentPane, SideSource } from './agent-pane/pane.js';

// ---- the agent pane ----

const agentIcon = registerIcon('cedian-agent-view-icon', Codicon.commentDiscussion, localize('cedianAgentIcon', 'View icon of the Cedian agent pane.'));

const container = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: AGENT_PANE_CONTAINER_ID,
	title: localize2('cedian.agent.container', "Agent"),
	icon: agentIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [AGENT_PANE_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: AGENT_PANE_CONTAINER_ID,
	order: 0,
}, ViewContainerLocation.AuxiliaryBar, { isDefault: true });

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: AGENT_PANE_VIEW_ID,
	name: localize2('cedian.agent.view', "Agent"),
	containerIcon: agentIcon,
	ctorDescriptor: new SyncDescriptor(AgentPaneView),
	canToggleVisibility: false,
	canMoveView: true,
}], container);

// ---- the Threads list: the prototype's left column ----

const threadsIcon = registerIcon('cedian-threads-view-icon', Codicon.listUnordered, localize('cedianThreadsIcon', 'View icon of the Cedian threads list.'));

const threadsContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: THREADS_CONTAINER_ID,
	title: localize2('cedian.threads.container', "Threads"),
	icon: threadsIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [THREADS_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: THREADS_CONTAINER_ID,
	order: -1,
	// Threads is a block of its own: no view can be dropped or moved into it.
	rejectAddedViews: true,
}, ViewContainerLocation.Sidebar, { isDefault: true });

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: THREADS_VIEW_ID,
	name: localize2('cedian.threads.view', "Threads"),
	containerIcon: threadsIcon,
	ctorDescriptor: new SyncDescriptor(ThreadsView),
	canToggleVisibility: false,
	// Threads stays on the left (windowPlaces.ts locks the side blocks).
	canMoveView: false,
}], threadsContainer);

// ---- the settings window ----

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(CedianSettingsEditor, CedianSettingsEditor.ID, localize('cedian.settings', "Cedian Settings")),
	[new SyncDescriptor(CedianSettingsInput)],
);

// ---- pop-out panes: the agent pane in a window of its own, as an editor there ----

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(CedianAgentEditor, CedianAgentEditor.ID, localize('cedian.agent.editor', "Agent")),
	[new SyncDescriptor(CedianAgentInput)],
);
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(CedianAgentInput.ID, CedianAgentInputSerializer);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'cedian.popOut',
			title: localize2('cedian.popOut', "Open Thread in New Window"),
			category: localize2('cedian.category', "Cedian"),
			icon: Codicon.openInWindow,
			f1: true,
			menu: [{ id: MenuId.ViewTitle, when: ContextKeyExpr.equals('view', AGENT_PANE_VIEW_ID), group: 'navigation', order: 10 }],
		});
	}
	run(accessor: ServicesAccessor): Promise<void> {
		return withPane(accessor, p => p.popOut());
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'cedian.popOutReview',
			title: localize2('cedian.popOutReview', "Open Review in New Window"),
			category: localize2('cedian.category', "Cedian"),
			f1: true,
		});
	}
	run(accessor: ServicesAccessor): Promise<void> {
		return withPane(accessor, p => p.popOutReview());
	}
});

// ---- the Browser block: the project's tabs in the daemon's Chromium (spec §3.3, §6.3) ----

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(CedianBrowserEditor, CedianBrowserEditor.ID, localize('cedian.browser', "Browser")),
	[new SyncDescriptor(CedianBrowserInput)],
);
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(CedianBrowserInput.ID, CedianBrowserInputSerializer);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'cedian.openBrowser',
			title: localize2('cedian.openBrowser', "Open Browser"),
			category: localize2('cedian.category', "Cedian"),
			icon: Codicon.globe,
			f1: true,
			menu: [{ id: MenuId.ViewTitle, when: ContextKeyExpr.equals('view', AGENT_PANE_VIEW_ID), group: 'navigation', order: 5 }],
		});
	}
	run(accessor: ServicesAccessor): Promise<void> {
		return openBrowser(accessor.get(IEditorService), accessor.get(ICommandService));
	}
});

/** The palette name the native view was tried under; it opens the Browser block now. */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'cedian.openNativeBrowser',
			title: localize2('cedian.openNativeBrowser', "Open Native Browser (Preview)"),
			category: localize2('cedian.category', "Cedian"),
			f1: true,
		});
	}
	run(accessor: ServicesAccessor): Promise<void> {
		return openBrowser(accessor.get(IEditorService), accessor.get(ICommandService));
	}
});

// ---- the block layer: blocks floating over the window as PiPs (spec §3.3, §4.4) ----

registerWorkbenchContribution2(CedianBlockLayer.ID, CedianBlockLayer, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(CedianWindowPlaces.ID, CedianWindowPlaces, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(CedianBlockStretch.ID, CedianBlockStretch, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(CedianBlockMove.ID, CedianBlockMove, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(CedianTabMove.ID, CedianTabMove, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(CedianToolStrip.ID, CedianToolStrip, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(CedianDropTarget.ID, CedianDropTarget, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(CedianProjectTabs.ID, CedianProjectTabs, WorkbenchPhase.AfterRestored);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'cedian.floatBrowser',
			title: localize2('cedian.floatBrowser', "Float Browser"),
			category: localize2('cedian.category', "Cedian"),
			f1: true,
		});
	}
	run(): Promise<void> {
		return CedianBlockLayer.current?.floatBrowser() ?? Promise.resolve();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'cedian.dockBrowser',
			title: localize2('cedian.dockBrowser', "Dock Browser"),
			category: localize2('cedian.category', "Cedian"),
			f1: true,
		});
	}
	run(): void {
		CedianBlockLayer.current?.dockBrowser();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'cedian.floatThread',
			title: localize2('cedian.floatThread', "Float Thread"),
			category: localize2('cedian.category', "Cedian"),
			f1: true,
		});
	}
	run(accessor: ServicesAccessor, thread?: unknown): Promise<void> {
		// From the palette: the side pane's thread floats, and the pane goes on to a new one.
		if (typeof thread === 'string' || thread === null) {
			CedianBlockLayer.current?.floatThread(thread ?? undefined);
			return Promise.resolve();
		}
		return withPane(accessor, p => p.float());
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'cedian.sideChat',
			title: localize2('cedian.sideChat', "Side Chat"),
			category: localize2('cedian.category', "Cedian"),
			f1: true,
		});
	}
	run(accessor: ServicesAccessor, from?: unknown, text?: unknown): void {
		const layer = CedianBlockLayer.current;
		if (!layer) {
			return;
		}
		// From `/btw`: the pane names its thread and the question.
		if (isSideSource(from)) {
			layer.sideChat(from, typeof text === 'string' ? text : undefined);
			return;
		}
		// ⌘;: a side chat on the thread the last focused pane shows; from inside one, it closes.
		const source = CedianPanes.current?.sideSource();
		if (source) {
			layer.sideChat(source);
		} else if (!layer.closeSide()) {
			accessor.get(INotificationService).info(localize('cedian.sideChat.none', "Open a thread first, then press ⌘; to ask beside it."));
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'cedian.fanBlocks',
			title: localize2('cedian.fanBlocks', "Fan Floating Blocks"),
			category: localize2('cedian.category', "Cedian"),
			f1: true,
		});
	}
	run(): void {
		CedianBlockLayer.current?.toggleFan();
	}
});

// ---- named layouts ----

const SAVE_LAYOUT = '\u0000save';
const DELETE_LAYOUT = '\u0000delete';

/** Asks for a name and saves what is open where now under it. */
async function saveLayout(accessor: ServicesAccessor): Promise<void> {
	const layer = CedianBlockLayer.current;
	if (!layer) {
		return;
	}
	const quick = accessor.get(IQuickInputService);
	const { current } = layer.layouts();
	const name = await quick.input({
		prompt: localize('cedian.saveLayout.prompt', "Save the editors' split and what floats as a layout. A name in use saves over it."),
		placeHolder: localize('cedian.saveLayout.name', "Layout name"),
		value: current ?? '',
		validateInput: async v => v.trim() ? undefined : localize('cedian.saveLayout.empty', "Give it a name"),
	});
	if (name) {
		layer.saveLayout(name);
	}
}

async function deleteLayout(accessor: ServicesAccessor): Promise<void> {
	const layer = CedianBlockLayer.current;
	if (!layer) {
		return;
	}
	const picked = await accessor.get(IQuickInputService).pick(layer.layouts().layouts.map(l => ({ label: l.name, id: l.name })), {
		placeHolder: localize('cedian.deleteLayout', "Delete a layout"),
	});
	if (picked) {
		layer.deleteLayout(picked.id);
	}
}

/** The project's layouts by name, with their keys and the current one marked; Enter switches. */
async function switchLayout(accessor: ServicesAccessor): Promise<void> {
	const layer = CedianBlockLayer.current;
	if (!layer) {
		return;
	}
	const quick = accessor.get(IQuickInputService);
	const instantiation = accessor.get(IInstantiationService);
	const { layouts, current } = layer.layouts();
	const items = [
		...layouts.map((l, i) => ({ label: l.name, id: l.name, description: [i < 9 ? `⌘⌥${i + 1}` : '', l.name === current ? localize('cedian.layout.current', "current") : ''].filter(Boolean).join(' · ') })),
		{ label: localize('cedian.saveLayout.item', "Save the current layout as…"), id: SAVE_LAYOUT },
		...(layouts.length ? [{ label: localize('cedian.deleteLayout.item', "Delete a layout…"), id: DELETE_LAYOUT }] : []),
	];
	const picked = await quick.pick(items, { placeHolder: localize('cedian.switchLayout', "Switch layout") });
	if (picked?.id === SAVE_LAYOUT) {
		await instantiation.invokeFunction(saveLayout);
	} else if (picked?.id === DELETE_LAYOUT) {
		await instantiation.invokeFunction(deleteLayout);
	} else if (picked) {
		layer.switchLayout(picked.id);
	}
}

for (const [id, title, run] of [
	['cedian.switchLayout', localize2('cedian.switchLayout.title', "Switch Layout"), switchLayout],
	['cedian.saveLayout', localize2('cedian.saveLayout.title', "Save Layout As…"), saveLayout],
	['cedian.deleteLayout', localize2('cedian.deleteLayout.title', "Delete Layout…"), deleteLayout],
] as const) {
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id, title, category: localize2('cedian.category', "Cedian"), f1: true,
				// The title bar's layout picker is named for the current layout (CedianBlockLayer).
			});
		}
		run(accessor: ServicesAccessor): Promise<void> {
			return run(accessor);
		}
	});
}
// ---- the title bar, as in the prototype: Threads' toggle, the project's name, + Tool, layouts ----

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'cedian.addTool',
			title: localize2('cedian.addTool', "Open a Tool"),
			category: localize2('cedian.category', "Cedian"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const quick = accessor.get(IQuickInputService);
		const views = accessor.get(IViewsService);
		const commands = accessor.get(ICommandService);
		const heading = { tools: localize('cedian.addTool.tools', "Tools"), project: localize('cedian.addTool.project', "Project") };
		const items: (IQuickPickItem | IQuickPickSeparator)[] = [];
		for (const [i, t] of TOOL_PICKS.entries()) {
			if (TOOL_PICKS[i - 1]?.group !== t.group) {
				items.push({ type: 'separator', label: heading[t.group] });
			}
			items.push({ label: t.label, id: String(i) });
		}
		const picked = await quick.pick(items, { placeHolder: localize('cedian.addTool.pick', "Open a tool") });
		const tool = picked?.id === undefined ? undefined : TOOL_PICKS[Number(picked.id)];
		if (tool) {
			await openTool(tool, views, commands);
		}
	}
});

// The prototype's "+ Tool" chip: text, not an icon, so the menu item names it apart from the
// command's palette title. Resting on it or clicking it opens the tool strip (toolStrip.ts); the
// palette's "Open a Tool" keeps the picker.
MenuRegistry.appendMenuItem(MenuId.TitleBar, { command: { id: 'cedian.addTool', title: localize('cedian.addTool.chip', "+ Tool") }, group: 'navigation', order: 1 });

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'cedian.toggleThreads',
			title: localize2('cedian.toggleThreads', "Show or Hide Threads"),
			category: localize2('cedian.category', "Cedian"),
			icon: Codicon.listUnordered,
			f1: true,
			// VS Code's TitleBarLeadingActionsGroup: before the rest, at the title bar's left.
			menu: [{ id: MenuId.TitleBar, group: '0_leading', order: 0 }],
		});
	}
	run(accessor: ServicesAccessor): Promise<unknown> {
		return accessor.get(ICommandService).executeCommand('workbench.action.toggleSidebarVisibility');
	}
});

for (let n = 1; n <= 9; n++) {
	CommandsRegistry.registerCommand({ id: `cedian.layout${n}`, handler: () => CedianBlockLayer.current?.switchLayoutAt(n - 1), metadata: { description: `Layout ${n}` } });
}

function isSideSource(value: unknown): value is SideSource {
	const v = value as SideSource | undefined;
	return typeof v === 'object' && v !== null && typeof v.thread === 'string' && typeof v.title === 'string' && typeof v.cwd === 'string';
}

registerAction2(CheckForUpdatesAction);

// ---- commands and the keybinding layer (spec §7.2) ----

/** Runs `act` on the agent pane, showing the pane first. */
async function withPane(accessor: ServicesAccessor, act: (pane: AgentPane) => void): Promise<void> {
	const views = accessor.get(IViewsService);
	if (!CedianPanes.current) {
		await views.openView(AGENT_PANE_VIEW_ID, true);
	}
	if (CedianPanes.current) {
		act(CedianPanes.current);
	}
}

/** The thread search: a quick pick over the project chat and the threads, by title, state and task. */
async function searchThreads(accessor: ServicesAccessor): Promise<void> {
	const quick = accessor.get(IQuickInputService);
	await withPane(accessor, async pane => {
		const picked = await quick.pick(pane.searchItems(), {
			placeHolder: localize('cedian.searchThreads', "Search threads"),
			matchOnDescription: true,
			matchOnDetail: true,
		});
		if (picked) {
			pane.pick(picked.id);
		}
	});
}

const COMMANDS: Record<string, (accessor: ServicesAccessor) => unknown> = {
	'cedian.projectChat': a => withPane(a, p => p.projectChat()),
	'cedian.newThread': a => withPane(a, p => p.newThread()),
	'cedian.searchThreads': a => searchThreads(a),
	'cedian.closeThread': a => withPane(a, p => p.newThread()),
	'cedian.nextThread': a => withPane(a, p => p.stepThread(1)),
	'cedian.previousThread': a => withPane(a, p => p.stepThread(-1)),
	'cedian.toggleReview': a => withPane(a, p => p.toggleReview()),
	'cedian.cycleViewMode': a => withPane(a, p => p.cycleViewMode()),
	'cedian.permissionMenu': a => withPane(a, p => p.menu('permission')),
	'cedian.modelMenu': a => withPane(a, p => p.menu('model')),
	'cedian.effortMenu': a => withPane(a, p => p.menu('effort')),
	'cedian.stop': a => withPane(a, p => p.stop()),
	'cedian.focusComposer': a => withPane(a, p => p.focusComposer()),
	'cedian.settings': a => a.get(IEditorService).openEditor(new CedianSettingsInput(), { pinned: true }),
	'cedian.inlineEdit': a => runInlineEdit(a),
};
for (const [id, handler] of Object.entries(COMMANDS)) {
	CommandsRegistry.registerCommand({ id, handler, metadata: { description: KEYBINDINGS.find(k => k.command === id)?.label ?? id } });
}

/** `cmd+shift+e` as VS Code's packed keybinding; `cmd` is Cmd on macOS and Ctrl elsewhere. */
function packKey(text: string): number | undefined {
	const key = parseKey(text);
	if (!key) {
		return undefined;
	}
	const code = KeyCodeUtils.fromUserSettings(key.key);
	if (!code) {
		return undefined;
	}
	let packed: number = code;
	if (key.cmd) { packed |= KeyMod.CtrlCmd; }
	if (key.ctrl) { packed |= isMacintosh ? KeyMod.WinCtrl : KeyMod.CtrlCmd; }
	if (key.shift) { packed |= KeyMod.Shift; }
	if (key.alt) { packed |= KeyMod.Alt; }
	return packed;
}

const KEYMAP_CACHE = 'cedian.desktop.keymap';
const DESKTOP_CACHE = 'cedian.desktop';

function cached(key: string): unknown {
	try {
		const text = mainWindow.localStorage.getItem(key);
		return text ? JSON.parse(text) : undefined;
	} catch {
		return undefined;
	}
}

const keymapRules = new DisposableStore();

/** Cedian's layer with the person's `desktop.keymap` over it, in place of the one before. */
function registerKeymap(keymap: unknown): void {
	keymapRules.clear();
	for (const binding of withKeymap(KEYBINDINGS, keymap)) {
		const primary = packKey(binding.mac);
		if (primary === undefined) {
			continue;
		}
		keymapRules.add(KeybindingsRegistry.registerKeybindingRule({
			id: binding.command,
			primary,
			weight: KeybindingWeight.ExternalExtension + 100,
			when: binding.when ? ContextKeyExpr.deserialize(binding.when) : undefined,
		}));
	}
}

// Registered before any keybinding is resolved, so Cedian's layer is in from the first key, from
// the copy of `desktop.keymap` the last window kept. A change the daemon sends later replaces it.
registerKeymap(cached(KEYMAP_CACHE));

/**
 * VS Code's defaults from the copy of `desktop` the last window kept, put in while the module
 * loads, before the configuration service reads the registry. Registered from the contribution's
 * constructor instead, the change would reach the layout's listener before the workbench grid
 * exists (the contribution starts before the workbench renders), and turning Modern UI on there
 * relayouts it: `TypeError: Cannot read properties of undefined (reading 'layout')`.
 */
function defaultsOf(desktop: Desktop): IConfigurationDefaults {
	const systemDark = mainWindow.matchMedia('(prefers-color-scheme: dark)').matches;
	return { overrides: vscodeSettings(desktop, systemDark), donotCache: true };
}
const startupDefaults = defaultsOf(desktopOf(cached(DESKTOP_CACHE)));
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerDefaultConfigurations([startupDefaults]);

// ---- desktop → VS Code settings, theme and the pane's type ----

/**
 * Keeps VS Code's settings what `desktop` says: they go in as VS Code's defaults, generated from
 * the daemon's copy of `desktop` each time it changes (spec §9: VS Code settings.json is
 * generated, never edited). Also lays the Warm & Lime `--cedian-*` properties over the window.
 */
class CedianDesktopContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.desktop';

	private defaults: IConfigurationDefaults = startupDefaults;
	private desktop: Desktop = desktopOf(cached(DESKTOP_CACHE));
	private keymap = JSON.stringify(cached(KEYMAP_CACHE) ?? {});
	private readonly style: HTMLStyleElement;
	private appIcon: 'light' | 'dark' | undefined;

	constructor(
		@ICedianDaemonService private readonly daemon: ICedianDaemonService,
		@IThemeService private readonly themeService: IThemeService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
	) {
		super();
		this.style = mainWindow.document.createElement('style');
		this.style.id = 'cedian-tokens';
		mainWindow.document.head.append(this.style);
		this._register({ dispose: () => this.style.remove() });
		this.apply();
		this._register(themeService.onDidColorThemeChange(() => this.paint()));
		const off = daemon.client.on('settings', notice => {
			this.desktop = desktopOf(notice.desktop);
			const keymap = JSON.stringify(this.desktop.keymap ?? {});
			try {
				mainWindow.localStorage.setItem(DESKTOP_CACHE, JSON.stringify(this.desktop));
				mainWindow.localStorage.setItem(KEYMAP_CACHE, keymap);
			} catch {
				// A window without storage applies `desktop` when the daemon sends it.
			}
			if (keymap !== this.keymap) {
				this.keymap = keymap;
				registerKeymap(this.desktop.keymap ?? {});
				this.refreshKeybindings();
			}
			this.apply();
		});
		this._register({ dispose: off });
		daemon.client.request({ op: 'settings' });
	}

	/** Swaps VS Code's defaults for the ones `desktop` makes now, only when they differ. */
	private apply(): void {
		const next = defaultsOf(this.desktop);
		if (JSON.stringify(next.overrides) !== JSON.stringify(this.defaults.overrides)) {
			const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
			registry.deregisterDefaultConfigurations([this.defaults]);
			registry.registerDefaultConfigurations([next]);
			this.defaults = next;
		}
		this.paint();
	}

	/**
	 * Has the keybinding service read the registry again. It has no public way to: it rereads on its
	 * own only for keybindings.json, extensions and the keyboard layout, so this calls the private
	 * method those use (VS Code 1.143.1), and a window without it takes the change when it next opens.
	 */
	private refreshKeybindings(): void {
		const service = this.keybindingService as IKeybindingService & { updateResolver?: () => void };
		service.updateResolver?.();
	}

	/** The tokens of the theme showing now, the pane's type and the Dock icon from `desktop`. */
	private paint(): void {
		const type = this.themeService.getColorTheme().type;
		const appearance = type === ColorScheme.LIGHT || type === ColorScheme.HIGH_CONTRAST_LIGHT ? 'light' : 'dark';
		const typography = Object.entries({ ...paneTypography(this.desktop), ...MOTION_PROPERTIES }).map(([k, v]) => `  ${k}: ${v};`).join('\n');
		this.style.textContent = `${cssText(appearance, '.monaco-workbench')}.monaco-workbench {\n${typography}\n}\n`;
		const icon = appIconOf(this.desktop, appearance);
		if (icon !== this.appIcon) {
			this.appIcon = icon;
			this.daemon.setAppIcon(icon);
		}
	}
}

registerWorkbenchContribution2(CedianDesktopContribution.ID, CedianDesktopContribution, WorkbenchPhase.BlockRestore);

// Cmd+, and VS Code's own settings commands open Cedian's settings window (spec §7.1: VS Code's
// settings UI is off).
class CedianSettingsRedirect implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.settingsRedirect';
	private readonly redirects: IDisposable[] = [];

	constructor(@ICommandService commandService: ICommandService) {
		for (const id of ['workbench.action.openSettings', 'workbench.action.openSettings2', 'workbench.action.openGlobalSettings']) {
			this.redirects.push(CommandsRegistry.registerCommand(id, () => commandService.executeCommand('cedian.settings')));
		}
	}
}

registerWorkbenchContribution2(CedianSettingsRedirect.ID, CedianSettingsRedirect, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(CedianTabCompletion.ID, CedianTabCompletion, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(CedianWelcomeCheck.ID, CedianWelcomeCheck, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(CedianNativeBrowser.ID, CedianNativeBrowser, WorkbenchPhase.AfterRestored);
