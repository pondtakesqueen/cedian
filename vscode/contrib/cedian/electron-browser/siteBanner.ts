/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/siteBanner.css';
import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import type { IBrowserViewModel } from '../../browserView/common/browserView.js';
import { BrowserEditor, BrowserEditorContribution, BrowserWidgetLocation, type IBrowserEditorWidget } from '../../browserView/electron-browser/browserEditor.js';
import { ICedianDaemonService } from '../browser/daemonService.js';
import { allowSite, bannerOf, revokeSite, sitesOf, TOOLS_OFF } from '../browser/browser-panel/sites.js';
import { desktopOf, type Desktop } from '../browser/settings/desktop.js';

/**
 * The safety banner over the native view's page (spec §8.3, §13), as the Browser block had it:
 * the person goes anywhere; the banner says whether the agent may use this page, from the
 * project's allowlist (`desktop.browser_sites`, localhost always), with Allow, Remove and Edit
 * sites. The agent keeps to the same list through cedia's `--browser-sites`.
 */
class CedianSiteBanner extends BrowserEditorContribution {
	private readonly element = $('.cedian-site-banner');
	private readonly widget: IBrowserEditorWidget = { location: BrowserWidgetLocation.Toolbar, element: this.element, order: 100 };
	private desktop: Desktop = {};
	private url = '';
	private shown = false;

	constructor(
		editor: BrowserEditor,
		@ICedianDaemonService private readonly daemon: ICedianDaemonService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@ICommandService private readonly commands: ICommandService,
	) {
		super(editor);
		this.element.setAttribute('role', 'status');
		this.element.hidden = true;
		const client = daemon.client;
		this._register(toDisposable(client.on('settings', notice => {
			this.desktop = desktopOf(notice.desktop);
			this.draw();
		})));
		client.request({ op: 'settings' });
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [this.widget];
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this.url = model.url;
		store.add(model.onDidNavigate(e => {
			this.url = e.url;
			this.draw();
		}));
		this.draw();
	}

	override onModelDetached(): void {
		this.url = '';
		this.draw();
	}

	private get root(): string | undefined {
		return this.workspace.getWorkspace().folders[0]?.uri.fsPath;
	}

	private draw(): void {
		const root = this.root;
		const banner = root ? bannerOf(this.url, sitesOf(this.desktop, root)) : { kind: 'none' as const };
		clearNode(this.element);
		this.element.classList.toggle('off', banner.kind === 'off');
		if (root && banner.kind !== 'none') {
			const { host } = banner;
			const set = (value: Record<string, string[]>) => this.daemon.client.request({ op: 'set_desktop', key: 'browser_sites', value });
			if (banner.kind === 'off') {
				append(this.element, $('span.ell', undefined, `${TOOLS_OFF}: ${host}`), $('span.fill'));
				this.button(`Allow ${host}`, '', () => set(allowSite(this.desktop, root, host)));
			} else {
				append(this.element, $('span.ell.small', undefined, `The agent can use this page · it may open ${banner.open}`), $('span.fill'));
				if (banner.removable) {
					this.button(`Remove ${host}`, 'flat', () => set(revokeSite(this.desktop, root, host)));
				}
				this.button('Edit sites', 'flat', () => { void this.commands.executeCommand('cedian.settings'); });
			}
		}
		const shown = root !== undefined && banner.kind !== 'none';
		this.element.hidden = !shown;
		if (shown !== this.shown) {
			this.shown = shown;
			// The toolbar's height changed: the native view moves to the room left under it.
			this.editor.layoutBrowserContainer();
		}
	}

	private button(label: string, kind: string, run: () => void): void {
		const button = append(this.element, $(kind ? `button.btn.${kind}` : 'button.btn', { type: 'button' }, label));
		button.addEventListener('click', run);
	}
}

BrowserEditor.registerContribution(CedianSiteBanner);
