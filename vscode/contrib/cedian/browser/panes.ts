/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../base/browser/dom.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import type { AgentPane } from './agent-pane/pane.js';
import type { DaemonClient } from './daemon-client/client.js';
import { ThreadShare, type PaneWire } from './daemon-client/thread-share.js';
import { COMPOSER_FOCUS, PANE_FOCUS } from './keybindings/keybindings.js';

export const ComposerFocus = new RawContextKey<boolean>(COMPOSER_FOCUS, false);
export const PaneFocus = new RawContextKey<boolean>(PANE_FOCUS, false);

const VIDEO_FILE = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;

/**
 * The window's agent panes: the side pane and any popped out into windows of their own. They
 * share the window's one daemon connection, each through a view that leaves a thread open while
 * another pane still shows it.
 */
export const CedianPanes = new class {
	private readonly panes: AgentPane[] = [];
	private share: ThreadShare | undefined;

	private drop(pane: AgentPane): void {
		const at = this.panes.indexOf(pane);
		if (at >= 0) {
			this.panes.splice(at, 1);
		}
	}

	/** The pane the keybinding layer acts on: the one that had focus last. */
	get current(): AgentPane | undefined {
		return this.panes.at(-1);
	}

	/** A new pane's wire to the daemon. */
	wire(client: DaemonClient): PaneWire {
		this.share ??= new ThreadShare(client);
		return this.share.view();
	}

	/**
	 * Keeps `pane` in the list while drawn, its focus in the context keys the keybinding layer reads,
	 * and attaches an image or video dropped in its composer.
	 */
	add(pane: AgentPane, contextKeyService: IContextKeyService): IDisposable {
		const store = new DisposableStore();
		this.panes.push(pane);
		store.add(toDisposable(() => this.drop(pane)));
		const composerFocus = ComposerFocus.bindTo(contextKeyService);
		const paneFocus = PaneFocus.bindTo(contextKeyService);
		const on = (target: EventTarget, type: string, listener: (e: Event) => void) => {
			target.addEventListener(type, listener);
			store.add(toDisposable(() => target.removeEventListener(type, listener)));
		};
		on(pane.composer, 'focus', () => composerFocus.set(true));
		on(pane.composer, 'blur', () => composerFocus.set(false));
		on(pane.root, 'focusin', () => {
			paneFocus.set(true);
			this.drop(pane);
			this.panes.push(pane);
		});
		on(pane.root, 'focusout', () => paneFocus.set(false));
		// An image dropped in the composer is attached by its file path, and a video once cedia takes one
		// (the pane handles a paste).
		on(pane.composer, 'drop', event => {
			const e = event as DragEvent;
			const attachable = (p: string) => /\.(png|jpe?g|gif|webp)$/i.test(p) || (pane.takesVideo() && VIDEO_FILE.test(p));
			const files = [...(e.dataTransfer?.files ?? [])].map(f => (f as File & { path?: string }).path).filter((p): p is string => !!p && attachable(p));
			if (files.length) {
				e.preventDefault();
				pane.attach(files);
			}
		});
		return store;
	}
};

/** A line over a pane while the daemon does not answer. */
export function connectionBar(root: HTMLElement, client: DaemonClient): IDisposable {
	const bar = $('.conn');
	bar.setAttribute('role', 'status');
	root.prepend(bar);
	const show = (state: string) => {
		bar.textContent = state === 'connected' ? '' : state === 'connecting' ? 'Connecting to the cedian daemon…' : 'Can\'t reach the cedian daemon; retrying';
		bar.hidden = state === 'connected';
	};
	show(client.connection);
	return toDisposable(client.onConnection(show));
}
