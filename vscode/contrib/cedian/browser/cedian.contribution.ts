/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCodeUtils, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { localize, localize2 } from '../../../../nls.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { Extensions as ConfigurationExtensions, IConfigurationDefaults, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ColorScheme } from '../../../../platform/theme/common/theme.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { EditorExtensions } from '../../../common/editor.js';
import { IViewContainersRegistry, IViewsRegistry, ViewContainerLocation, Extensions as ViewExtensions } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { AgentPaneView, AGENT_PANE_CONTAINER_ID, AGENT_PANE_VIEW_ID } from './agentPaneView.js';
import { ICedianDaemonService } from './daemonService.js';
import { runInlineEdit } from './inlineEdit.js';
import { KEYBINDINGS, parseKey, withKeymap } from './keybindings/keybindings.js';
import { CedianPanes } from './panes.js';
import { CedianSettingsEditor, CedianSettingsInput } from './settingsEditor.js';
import { desktopOf, paneTypography, vscodeSettings, type Desktop } from './settings/desktop.js';
import { cssText } from './theme/theme.js';
import type { AgentPane } from './agent-pane/pane.js';

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

// ---- the settings window ----

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(CedianSettingsEditor, CedianSettingsEditor.ID, localize('cedian.settings', "Cedian Settings")),
	[new SyncDescriptor(CedianSettingsInput)],
);

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
			placeHolder: localize('cedian.searchThreads', "ค้นหาเธรด"),
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

// ---- desktop → VS Code settings, theme and the pane's type ----

/**
 * Keeps VS Code's settings what `desktop` says: they go in as VS Code's defaults, generated from
 * the daemon's copy of `desktop` each time it changes (spec §9: VS Code settings.json is
 * generated, never edited). Also lays the Warm & Lime `--cedian-*` properties over the window.
 */
class CedianDesktopContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.desktop';

	private defaults: IConfigurationDefaults | undefined;
	private desktop: Desktop = desktopOf(cached(DESKTOP_CACHE));
	private keymap = JSON.stringify(cached(KEYMAP_CACHE) ?? {});
	private readonly style: HTMLStyleElement;

	constructor(
		@ICedianDaemonService daemon: ICedianDaemonService,
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

	private apply(): void {
		const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
		const systemDark = mainWindow.matchMedia('(prefers-color-scheme: dark)').matches;
		const next: IConfigurationDefaults = { overrides: vscodeSettings(this.desktop, systemDark), donotCache: true };
		if (this.defaults) {
			registry.deregisterDefaultConfigurations([this.defaults]);
		}
		registry.registerDefaultConfigurations([next]);
		this.defaults = next;
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

	/** The tokens of the theme showing now, and the pane's type from `desktop`. */
	private paint(): void {
		const type = this.themeService.getColorTheme().type;
		const appearance = type === ColorScheme.LIGHT || type === ColorScheme.HIGH_CONTRAST_LIGHT ? 'light' : 'dark';
		const typography = Object.entries(paneTypography(this.desktop)).map(([k, v]) => `  ${k}: ${v};`).join('\n');
		this.style.textContent = `${cssText(appearance, '.monaco-workbench')}.monaco-workbench {\n${typography}\n}\n`;
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
