/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import type { CDPRequest } from '../../../../platform/browserView/common/cdp/types.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorsOrder } from '../../../common/editor.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { BrowserEditorInput } from '../../browserView/common/browserEditorInput.js';
import { IBrowserViewCDPService } from '../../browserView/common/browserView.js';
import { ICedianDaemonService } from './daemonService.js';
import { NativeFloat } from './nativeFloat.js';
import { agentMay, PageRelay, type BrowserChannel, type CdpMessage } from './browser-panel/relay.js';

/** One run's connection to the native page: the relay once its group exists, what came before it. */
interface Conn {
	relay?: PageRelay;
	pending: string[];
	/** The daemon closed it: the relay's own close is not sent back. */
	ended: boolean;
}

/**
 * The bridge's window side (spec §6.3, native view): while this window holds a native browser
 * view (VS Code's browser editor), the daemon hands the project's runs a DevTools socket of its
 * own and relays each one here. Each relayed connection gets a CDP group on the page through
 * `IBrowserViewCDPService`, and a `PageRelay` turns that browser-level group into the page-level
 * socket cedia's browser tool speaks, so the agent drives the page the person sees.
 */
export class CedianNativeBrowser extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedianNativeBrowser';
	private readonly conns = new Map<number, Conn>();
	private held = false;

	constructor(
		@ICedianDaemonService private readonly daemon: ICedianDaemonService,
		@IEditorService private readonly editors: IEditorService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IBrowserViewCDPService private readonly cdp: IBrowserViewCDPService,
	) {
		super();
		const client = daemon.client;
		this._register(editors.onDidEditorsChange(() => this.hold()));
		this._register(NativeFloat.onDidChange(() => this.hold()));
		this._register(toDisposable(client.onConnection(state => {
			// A daemon that restarted knows no page: say it again, and its old connections are gone.
			if (state === 'connected' && this.held) {
				this.say(true);
			}
			if (state !== 'connected') {
				for (const conn of this.conns.values()) {
					conn.ended = true;
					conn.relay?.close();
				}
				this.conns.clear();
			}
		})));
		this._register(toDisposable(client.on('browser_cdp_open', notice => { void this.open(notice.conn); })));
		this._register(toDisposable(client.on('browser_cdp', notice => this.deliver(notice.conn, notice.data))));
		this._register(toDisposable(client.on('browser_cdp_close', notice => this.end(notice.conn))));
		this._register(toDisposable(() => {
			for (const conn of this.conns.values()) {
				conn.ended = true;
				conn.relay?.close();
			}
			if (this.held) {
				this.say(false);
			}
		}));
		this.hold();
	}

	private get cwd(): string | undefined {
		return this.workspace.getWorkspace().folders[0]?.uri.fsPath;
	}

	/** Tells the daemon when the first native page opens here and when the last one closes. */
	private hold(): void {
		const holds = this.page() !== undefined;
		if (holds !== this.held) {
			this.held = holds;
			this.say(holds);
		}
	}

	private say(open: boolean): void {
		const cwd = this.cwd;
		if (cwd) {
			this.daemon.client.request({ op: 'browser_native', cwd, open });
		}
	}

	/** The page a run drives: the one floating, else the native view in front, else the one used last. */
	private page(): BrowserEditorInput | undefined {
		if (NativeFloat.input) {
			return NativeFloat.input;
		}
		const active = this.editors.activeEditor;
		if (active instanceof BrowserEditorInput) {
			return active;
		}
		for (const { editor } of this.editors.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)) {
			if (editor instanceof BrowserEditorInput) {
				return editor;
			}
		}
		return undefined;
	}

	private async open(id: number): Promise<void> {
		const conn: Conn = { pending: [], ended: false };
		this.conns.set(id, conn);
		const page = this.page();
		let group: string | undefined;
		try {
			if (!page) {
				throw new Error('no native browser view is open');
			}
			group = await this.cdp.createSessionGroup(page.id);
		} catch {
			this.conns.delete(id);
			if (!conn.ended) {
				this.daemon.client.request({ op: 'browser_cdp', conn: id, data: null });
			}
			return;
		}
		if (conn.ended) {
			void this.cdp.destroySessionGroup(group);
			return;
		}
		const groupId = group;
		const gone = this.cdp.onDidDestroy(groupId)(() => conn.relay?.close());
		const channel: BrowserChannel = {
			send: message => { void this.cdp.sendCDPMessage(groupId, message as CDPRequest).catch(() => { }); },
			onMessage: listener => {
				const listening = this.cdp.onCDPMessage(groupId)(message => listener(message as CdpMessage));
				return () => listening.dispose();
			},
			close: () => {
				gone.dispose();
				void this.cdp.destroySessionGroup(groupId).catch(() => { });
			},
		};
		// A run reaches this page and nothing past it (relay.ts, AGENT_DOMAINS).
		const relay = new PageRelay(channel, agentMay);
		conn.relay = relay;
		relay.addEventListener('message', e => {
			if (typeof e.data === 'string') {
				this.daemon.client.request({ op: 'browser_cdp', conn: id, data: e.data });
			}
		});
		relay.addEventListener('close', () => {
			this.conns.delete(id);
			if (!conn.ended) {
				this.daemon.client.request({ op: 'browser_cdp', conn: id, data: null });
			}
		});
		for (const data of conn.pending.splice(0)) {
			relay.send(data);
		}
	}

	private deliver(id: number, data: string): void {
		const conn = this.conns.get(id);
		if (!conn) {
			return;
		}
		if (conn.relay) {
			conn.relay.send(data);
		} else {
			conn.pending.push(data);
		}
	}

	private end(id: number): void {
		const conn = this.conns.get(id);
		if (!conn) {
			return;
		}
		conn.ended = true;
		this.conns.delete(id);
		conn.relay?.close();
	}
}
