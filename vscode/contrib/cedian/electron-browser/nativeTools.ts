/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/nativeTools.css';
import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import type { CDPRequest } from '../../../../platform/browserView/common/cdp/types.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IBrowserViewCDPService, type IBrowserViewModel } from '../../browserView/common/browserView.js';
import { BrowserEditor, BrowserEditorContribution, type IContainerLayoutOverride } from '../../browserView/electron-browser/browserEditor.js';
import { attach, browserServices, type BrowserServices } from '../browser/browserEditor.js';
import { Cdp } from '../browser/browser-panel/cdp.js';
import { PageRelay, type BrowserChannel, type CdpMessage } from '../browser/browser-panel/relay.js';
import { PageSession, type ConsoleLine } from '../browser/browser-panel/session.js';

/** The console strip's height folded, and its list's most when open (browserPanel.css: `.cl`). */
const STRIP = 30;
const LIST = 180;

/**
 * The Browser block's own tools on the native view (spec §6.3): a page session over a CDP group
 * of the view (`IBrowserViewCDPService`, read through a `PageRelay`), the same `PageSession` the
 * screencast block reads, without its screencast or size. Here: the console strip under the
 * page, the page's console messages and exceptions, which the agent reads too (cedia's browser
 * tool keeps its own); errors and warnings can be attached to the composer.
 */
class CedianNativeTools extends BrowserEditorContribution {
	private readonly strip = $('.cedian-browser.cedian-native-console');
	private readonly head = $('button.ch', { type: 'button', 'aria-expanded': 'false' });
	private readonly list = $('.cl');
	private session: PageSession | undefined;
	private open = false;
	private readonly services: BrowserServices;

	constructor(
		editor: BrowserEditor,
		@IBrowserViewCDPService private readonly cdp: IBrowserViewCDPService,
		@IInstantiationService instantiation: IInstantiationService,
	) {
		super(editor);
		this.services = instantiation.invokeFunction(browserServices);
		this.list.hidden = true;
		append(this.strip, this.head, this.list);
		this.head.addEventListener('click', () => this.toggle());
		this.drawHead();
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
		await session.watch().catch(() => { });
		this.drawHead();
		this.fill();
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

BrowserEditor.registerContribution(CedianNativeTools);
