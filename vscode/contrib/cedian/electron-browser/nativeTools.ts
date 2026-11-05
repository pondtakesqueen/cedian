/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/nativeTools.css';
import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { Action } from '../../../../base/common/actions.js';
import type { URI } from '../../../../base/common/uri.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import type { CDPRequest } from '../../../../platform/browserView/common/cdp/types.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IBrowserViewCDPService, type IBrowserViewModel } from '../../browserView/common/browserView.js';
import { BrowserEditor, BrowserEditorContribution, BrowserWidgetLocation, type IBrowserEditorWidget, type IContainerLayoutOverride } from '../../browserView/electron-browser/browserEditor.js';
import { attach, browserServices, devServersIn, runDevServer, type BrowserServices } from '../browser/browserEditor.js';
import type { DevServer } from '../browser/browser-panel/launch.js';
import { Cdp } from '../browser/browser-panel/cdp.js';
import { PageRelay, type BrowserChannel, type CdpMessage } from '../browser/browser-panel/relay.js';
import { elementContext, imageName, PageSession, type ConsoleLine, type PageView } from '../browser/browser-panel/session.js';

/** The console strip's height folded, and its list's most when open (browserPanel.css: `.cl`). */
const STRIP = 30;
const LIST = 180;
/** How long a dev server just started has to answer before the view stops asking (as the block). */
const DEV_SERVER_WAIT_MS = 30_000;

/**
 * The Browser block's own tools on the native view (spec §6.3): a page session over a CDP group
 * of the view (`IBrowserViewCDPService`, read through a `PageRelay`), the same `PageSession` the
 * screencast block reads, without its screencast or size. Here: the console strip under the
 * page, the page's console messages and exceptions, which the agent reads too (cedia's browser
 * tool keeps its own); errors and warnings can be attached to the composer. And element select
 * beside the address: Chromium's inspect mode highlights under the pointer, and the element a
 * click picks goes to the composer with its picture, as the screencast block's picker did. And
 * the Dev servers menu: the project's `.cedia/launch.json` (else `.claude/launch.json`) servers,
 * each started in a terminal of its own and opened in the view once it answers.
 */
class CedianNativeTools extends BrowserEditorContribution {
	private readonly strip = $('.cedian-browser.cedian-native-console');
	private readonly head = $('button.ch', { type: 'button', 'aria-expanded': 'false' });
	private readonly list = $('.cl');
	private readonly picker = $('button.cedian-native-pick', { type: 'button', 'aria-label': 'Select an element', 'aria-pressed': 'false', title: 'Select an element for the agent' }, '⌖');
	private readonly pickWidget: IBrowserEditorWidget = { location: BrowserWidgetLocation.PostUrl, element: this.picker, order: 50 };
	private readonly servers = $('button.cedian-native-servers', { type: 'button', 'aria-haspopup': 'menu', title: 'Start one of the project\'s dev servers and open it here' }, 'Dev servers ▾');
	private readonly serversWidget: IBrowserEditorWidget = { location: BrowserWidgetLocation.PostUrl, element: this.servers, order: 40 };
	private serverList: DevServer[] = [];
	/** A dev server just started, and how long the view keeps asking it. */
	private waiting: { url: string; until: number } | undefined;
	private session: PageSession | undefined;
	private open = false;
	private readonly services: BrowserServices;

	constructor(
		editor: BrowserEditor,
		@IBrowserViewCDPService private readonly cdp: IBrowserViewCDPService,
		@IInstantiationService instantiation: IInstantiationService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IContextMenuService private readonly menus: IContextMenuService,
	) {
		super(editor);
		this.services = instantiation.invokeFunction(browserServices);
		this.list.hidden = true;
		append(this.strip, this.head, this.list);
		this.head.addEventListener('click', () => this.toggle());
		this.picker.addEventListener('click', () => this.togglePick());
		this.servers.hidden = true;
		this.servers.addEventListener('click', () => { void this.showServers(); });
		void this.readServers();
		this.drawHead();
		this.drawPicker(undefined);
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [this.serversWidget, this.pickWidget];
	}

	override onContainerCreated(container: HTMLElement): void {
		// Under the page, in the room beforeContainerLayout keeps there: the native view is laid
		// out above it, so nothing of the page is drawn over the strip.
		container.parentElement?.appendChild(this.strip);
	}

	override beforeContainerLayout(): IContainerLayoutOverride | undefined {
		return { padding: { bottom: this.strip.offsetHeight || STRIP } };
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		void this.watch(model, store);
	}

	override onModelDetached(): void {
		this.session = undefined;
		this.drawHead();
		this.fill();
		this.drawPicker(undefined);
	}

	private async watch(model: IBrowserViewModel, store: DisposableStore): Promise<void> {
		let group: string;
		try {
			group = await this.cdp.createSessionGroup(model.id);
		} catch {
			return;
		}
		if (store.isDisposed) {
			void this.cdp.destroySessionGroup(group).catch(() => { });
			return;
		}
		const channel: BrowserChannel = {
			send: message => { void this.cdp.sendCDPMessage(group, message as CDPRequest).catch(() => { }); },
			onMessage: listener => {
				const listening = this.cdp.onCDPMessage(group)(message => listener(message as CdpMessage));
				return () => listening.dispose();
			},
			close: () => { void this.cdp.destroySessionGroup(group).catch(() => { }); },
		};
		const relay = new PageRelay(channel);
		const session = new PageSession(new Cdp(relay));
		store.add(toDisposable(() => {
			if (this.session === session) {
				this.session = undefined;
			}
			relay.close();
		}));
		this.session = session;
		session.onConsole(line => {
			this.drawHead();
			if (this.open) {
				if (line) {
					this.list.appendChild(this.row(line));
					this.list.scrollTop = this.list.scrollHeight;
				} else {
					this.fill();
				}
			}
		});
		session.onChange(view => {
			this.drawPicker(view);
			this.retry(session, view);
		});
		session.onPicked(picked => {
			attach(this.services, elementContext(picked), picked.image ? bytes(picked.image) : undefined, imageName(picked))
				.catch(e => this.services.notifications.warn(`Couldn't add the element to the composer: ${e instanceof Error ? e.message : e}`));
		});
		store.add(toDisposable(() => { void session.stopInspect(); }));
		await session.watch().catch(() => { });
		this.drawHead();
		this.fill();
		this.drawPicker(session.view);
	}

	private togglePick(): void {
		const session = this.session;
		if (!session) {
			return;
		}
		if (session.view.pick === 'inspecting') {
			void session.stopInspect();
		} else {
			void session.inspect().catch(e => this.services.notifications.warn(`Couldn't select an element: ${e instanceof Error ? e.message : e}`));
		}
	}

	private get folder(): URI | undefined {
		return this.workspace.getWorkspace().folders[0]?.uri;
	}

	private async readServers(): Promise<DevServer[]> {
		const folder = this.folder;
		this.serverList = folder ? await devServersIn(this.services, folder).catch(() => []) : [];
		this.servers.hidden = this.serverList.length === 0;
		return this.serverList;
	}

	private async showServers(): Promise<void> {
		const list = await this.readServers();
		const folder = this.folder;
		if (!folder || !list.length) {
			return;
		}
		this.menus.showContextMenu({
			getAnchor: () => this.servers,
			getActions: () => list.map((server, i) => new Action(`cedian.devServer.${i}`, server.url ? `${server.name} · ${server.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : server.name, undefined, true, () => this.startServer(folder, server))),
		});
	}

	private async startServer(folder: URI, server: DevServer): Promise<void> {
		await runDevServer(this.services, folder, server).catch(e => this.services.notifications.warn(`Couldn't start ${server.name}: ${e instanceof Error ? e.message : e}`));
		if (!server.url || !this.session) {
			return;
		}
		this.waiting = { url: server.url, until: Date.now() + DEV_SERVER_WAIT_MS };
		void this.session.navigate(server.url);
	}

	/** A dev server just started: ask again each second until it answers, as the block did. */
	private retry(session: PageSession, view: PageView): void {
		const waiting = this.waiting;
		if (view.load === 'loaded') {
			this.waiting = undefined;
		} else if (view.load === 'error' && waiting && /Nothing answers there/.test(view.error ?? '') && Date.now() < waiting.until) {
			setTimeout(() => {
				if (this.waiting === waiting && this.session === session) {
					void session.navigate(waiting.url);
				}
			}, 1_000);
		}
	}

	private drawPicker(view: PageView | undefined): void {
		this.picker.setAttribute('aria-pressed', String(view?.pick === 'inspecting'));
		this.picker.classList.toggle('on', view?.pick === 'inspecting');
		// A blank tab has nothing to pick but its empty body.
		(this.picker as HTMLButtonElement).disabled = !view || !view.url || view.url === 'about:blank';
	}

	private toggle(): void {
		this.open = !this.open;
		this.head.setAttribute('aria-expanded', String(this.open));
		this.list.hidden = !this.open;
		this.list.style.maxHeight = `${LIST}px`;
		this.drawHead();
		this.fill();
		// The strip grew or shrank: the native view gives it the room.
		this.editor.layoutBrowserContainer();
	}

	private drawHead(): void {
		const lines = this.session?.console ?? [];
		const errors = lines.filter(l => l.level === 'error').length;
		const warnings = lines.filter(l => l.level === 'warn').length;
		clearNode(this.head);
		append(this.head, $('span.name', undefined, 'Console'));
		if (errors) {
			append(this.head, $('span.bad.num', undefined, `● ${errors}`));
		}
		if (warnings) {
			append(this.head, $('span.warn.num', undefined, `▲ ${warnings}`));
		}
		append(this.head, $('span.small.ell.fill', undefined, this.open ? '' : 'The agent reads this console too'), $('span', undefined, this.open ? '▾' : '▴'));
	}

	private fill(): void {
		clearNode(this.list);
		if (!this.open) {
			return;
		}
		const clear = append(this.list, $('button.btn.flat.clear', { type: 'button' }, 'Clear'));
		clear.addEventListener('click', () => this.session?.clearConsole());
		for (const line of this.session?.console ?? []) {
			this.list.appendChild(this.row(line));
		}
		this.list.scrollTop = this.list.scrollHeight;
	}

	private row(line: ConsoleLine): HTMLElement {
		const row = $(`.cr.${line.level}`);
		const text = append(row, $('span.tx.m', undefined, line.text));
		if (line.source) {
			append(text, $('span.src', undefined, ` ${line.source}`));
		}
		if (line.level === 'error' || line.level === 'warn') {
			const button = append(row, $('button.btn.flat', { type: 'button' }, 'Attach'));
			const url = this.session?.view.url ?? '';
			button.addEventListener('click', () => {
				attach(this.services, `Console ${line.level} on ${url}:\n${line.text}${line.source ? `\nat ${line.source}` : ''}`, undefined, undefined)
					.catch(e => this.services.notifications.warn(`Couldn't add the line to the composer: ${e instanceof Error ? e.message : e}`));
			});
		}
		return row;
	}
}

/** A base64 picture as bytes, for the composer's chip. */
function bytes(base64: string): Uint8Array {
	const text = atob(base64);
	const out = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) {
		out[i] = text.charCodeAt(i);
	}
	return out;
}

BrowserEditor.registerContribution(CedianNativeTools);
