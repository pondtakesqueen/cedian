/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/nativeFloat.css';
import { getZoomFactor } from '../../../../base/browser/browser.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Emitter } from '../../../../base/common/event.js';
import type { IBrowserViewModel } from '../../browserView/common/browserView.js';
import type { BrowserEditorInput } from '../../browserView/common/browserEditorInput.js';
import { BrowserOverlayManager } from '../../browserView/electron-browser/overlayManager.js';
import type { Block } from './blocks/block.js';
import { nativePageShown } from './blocks/pip.js';

/** The native page floating over the window, when one does: the bridge counts it as held. */
export const NativeFloat = new class {
	private current: BrowserEditorInput | undefined;
	private readonly changed = new Emitter<void>();
	readonly onDidChange = this.changed.event;
	get input(): BrowserEditorInput | undefined {
		return this.current;
	}
	set(input: BrowserEditorInput | undefined): void {
		this.current = input;
		this.changed.fire();
	}
};

/** How many still frames a block's place must hold before the live page goes back there. */
const STILL_FRAMES = 3;

/**
 * The native browser view as a floating block (spec §3.3 PiP). Electron draws the page above
 * the window's DOM at bounds it is given, so the block cannot carry it: while the block moves
 * (dragged, flung to a corner, resized, zoomed, fanned) the block shows a still picture of the
 * page and the page is hidden; once the block's place holds still, the page is laid out there
 * and shown again. Between moves nothing runs: a few frames are watched only after a resize, a
 * transition, a press or the window's resize. A menu, the palette or a notification over the block
 * (VS Code's overlay manager, as the browser editor uses) also leaves the picture in its place.
 *
 * The block holds the page's editor input after its tab closed (its disposal was vetoed): closing
 * the block closes the page; docking it gives the input back to the editor area.
 */
export class NativeBrowserBlock implements Block {
	readonly kind = 'browser';
	readonly root: HTMLElement;
	private readonly shot: HTMLImageElement;
	private shotUrl: string | undefined;
	private docking = false;
	/** Its card is folding away: the page is not laid out in it again. */
	private left = false;
	private live = false;
	private capturing = false;
	private frame: number | undefined;
	private last = '';
	private still = 0;
	private readonly offs: (() => void)[] = [];
	private readonly overlays = new BrowserOverlayManager(mainWindow);

	constructor(private readonly input: BrowserEditorInput, private readonly model: IBrowserViewModel) {
		const d = mainWindow.document;
		this.root = d.createElement('div');
		this.root.className = 'cedian-native-float';
		this.shot = d.createElement('img');
		this.shot.className = 'shot';
		this.shot.alt = '';
		this.shot.hidden = true;
		this.root.append(this.shot);
		const resize = new ResizeObserver(() => this.watch());
		resize.observe(this.root);
		this.offs.push(() => resize.disconnect());
		const on = (target: EventTarget, type: string) => {
			// A pointer that moves with no button held moves nothing.
			const listener = (e: Event) => {
				if (e.type !== 'pointermove' || (e as PointerEvent).buttons !== 0) {
					this.watch();
				}
			};
			target.addEventListener(type, listener, true);
			this.offs.push(() => target.removeEventListener(type, listener, true));
		};
		for (const type of ['pointerdown', 'pointermove', 'transitionrun', 'transitionend', 'animationstart', 'animationend']) {
			on(d, type);
		}
		on(mainWindow, 'resize');
		const overlaid = this.overlays.onDidChangeOverlayState(() => this.watch());
		this.offs.push(() => { overlaid.dispose(); this.overlays.dispose(); });
		NativeFloat.set(input);
	}

	title(): string {
		return this.input.getName() || 'Browser';
	}

	onTitle(listener: (title: string) => void): () => void {
		const listening = this.input.onDidChangeLabel(() => listener(this.title()));
		return () => listening.dispose();
	}

	layout(): void {
		this.watch();
	}

	focus(): void {
		void this.model.focus();
	}

	/**
	 * Its card folds away (closed, docked, torn off): the page is drawn over the window, not in the
	 * card, so it would stay whole over the folding card and vanish at the end. Closed, it hides
	 * now and the card folds away empty; docked or torn off, the editor that takes it lays it out.
	 */
	leaving(): void {
		this.left = true;
		this.live = false;
		if (this.frame !== undefined) {
			mainWindow.cancelAnimationFrame(this.frame);
			this.frame = undefined;
		}
		if (!this.docking) {
			void this.model.setVisible(false);
		}
	}

	/** The block docks into the editor area: the editor takes the page from here. */
	dock(): BrowserEditorInput {
		this.docking = true;
		return this.input;
	}

	dispose(): void {
		for (const off of this.offs.splice(0)) {
			off();
		}
		if (this.frame !== undefined) {
			mainWindow.cancelAnimationFrame(this.frame);
		}
		if (this.shotUrl) {
			URL.revokeObjectURL(this.shotUrl);
		}
		if (NativeFloat.input === this.input) {
			NativeFloat.set(undefined);
		}
		if (!this.docking) {
			// Closed, not docked: the page goes with it.
			this.input.dispose(true);
		}
	}

	/** Watches the block's place for a few frames, until it holds still. */
	private watch(): void {
		this.still = 0;
		this.frame ??= mainWindow.requestAnimationFrame(() => this.tick());
	}

	private tick(): void {
		this.frame = undefined;
		if (this.docking || this.left) {
			return;
		}
		const r = this.root.getBoundingClientRect();
		const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
		// The card coming out (its clip uncovering it) holds its box still while it moves: the page
		// waits for it, or it would show whole before the card is.
		const card = this.root.closest<HTMLElement>('.cedian-pip');
		const animating = !!card?.getAnimations().some(a => a.playState === 'running');
		if (key !== this.last || animating) {
			this.last = key;
			this.still = 0;
			if (this.live) {
				void this.toStill();
			}
		} else {
			this.still++;
		}
		if (this.still >= STILL_FRAMES) {
			this.toLive(r);
			return;
		}
		this.frame = mainWindow.requestAnimationFrame(() => this.tick());
	}

	/** The page hidden behind a still picture of itself, for as long as the block moves. */
	private async toStill(): Promise<void> {
		this.live = false;
		if (this.capturing) {
			return;
		}
		this.capturing = true;
		try {
			const picture = await this.model.captureScreenshot({ format: 'jpeg', quality: 70 });
			const url = URL.createObjectURL(new Blob([picture.buffer.slice()], { type: 'image/jpeg' }));
			if (this.shotUrl) {
				URL.revokeObjectURL(this.shotUrl);
			}
			this.shotUrl = url;
			this.shot.src = url;
		} catch {
			// No picture: the block shows its plain background while it moves.
		} finally {
			this.capturing = false;
		}
		if (!this.live && !this.docking) {
			this.shot.hidden = false;
			await this.model.setVisible(false);
		}
	}

	/** The page laid out where the block came to rest, and shown. */
	private toLive(r: DOMRect): void {
		// Stashed, the card's body is hidden past the frame's side, but the page is not clipped: it
		// would cover the Explorer there.
		const stashed = !!this.root.closest('.cedian-pip.stashed');
		const shown = this.root.isConnected && nativePageShown(r, { width: mainWindow.innerWidth, height: mainWindow.innerHeight }, stashed);
		if (!shown) {
			this.live = false;
			void this.model.setVisible(false);
			return;
		}
		if (this.overlays.getOverlappingOverlays(this.root).length) {
			// Under a menu or the palette: the picture stays until it closes.
			if (this.live || this.shot.hidden) {
				void this.toStill();
			}
			return;
		}
		this.live = true;
		void this.model.layout({
			windowId: mainWindow.vscodeWindowId,
			x: r.left,
			y: r.top,
			width: r.width,
			height: r.height,
			zoomFactor: getZoomFactor(mainWindow),
			cornerRadius: 0,
		}).then(() => this.left ? undefined : this.model.setVisible(true)).then(() => {
			if (this.live) {
				this.shot.hidden = true;
			}
		});
	}
}
