/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { isHorizontal, IWorkbenchLayoutService, Parts, Position } from '../../../services/layout/browser/layoutService.js';

/** How long a side block takes to open and to close. Closing is quicker: what goes is out of the way. */
const OPEN_MS = 320;
const CLOSE_MS = 240;

/** The side blocks that stretch, each with VS Code's commands that hide it. */
const SIDES: readonly { part: Parts; hide: readonly string[] }[] = [
	{ part: Parts.SIDEBAR_PART, hide: ['workbench.action.toggleSidebarVisibility', 'workbench.action.closeSidebar'] },
	{ part: Parts.AUXILIARYBAR_PART, hide: ['workbench.action.toggleAuxiliaryBar', 'workbench.action.closeAuxiliaryBar'] },
	{ part: Parts.PANEL_PART, hide: ['workbench.action.togglePanel', 'workbench.action.closePanel'] },
];

/** The parts' own sizes and layout: VS Code's layout service keeps the parts to itself. */
interface Sized { minimumWidth: number; minimumHeight: number; layout(width: number, height: number, top: number, left: number): void }
interface PartsOf { getPart?(part: Parts): Sized }

/** The side blocks closing by stretching now; blockExit.ts leaves them be. */
export const stretching = new Set<Parts>();

/** Opening eases out (cubic): it comes at once and lands softly. */
const easeOpen = (t: number) => 1 - Math.pow(1 - t, 3);
/** Closing eases in and out (cubic): no jump on the first frame, gone briskly at the end. */
const easeClose = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

interface Run { stop(): void; size(): number; target: number; closing: boolean }

/**
 * A side block (Threads, the right panel, the bottom panel) stretches open from nothing to its
 * width, and shrinks to nothing before it goes, as a sash drag would move it: its neighbours give
 * up the room as it grows and take it back as it shrinks, and nothing is squeezed or scaled. Every
 * frame sets the block's real size, so the neighbours lay out as they move; the block's own
 * contents stay laid out at its full size, held at the window's edge, and its moving edge uncovers
 * them as a drawer's would. Its minimum size is lifted while it moves and put back after. VS Code's commands that hide a block run once it has
 * shrunk, after its size is set back to its width in the same frame, so the layout remembers that
 * width and the next opening grows back to it. A block hidden any other way fades where it stood
 * (blockExit.ts). Off with the window's reduced motion.
 */
export class CedianBlockStretch extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.blockStretch';

	private readonly runs = new Map<Parts, Run>();

	constructor(
		@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService,
		@IInstantiationService instantiation: IInstantiationService,
	) {
		super();
		this._register(layout.onDidChangePartVisibility(e => {
			const side = SIDES.find(s => s.part === e.partId);
			if (side && e.visible && !stretching.has(side.part)) {
				// The event comes from inside the layout's own showing: measured once it has laid out,
				// before the frame is painted.
				queueMicrotask(() => this.open(side.part));
			}
		}));
		for (const side of SIDES) {
			for (const id of side.hide) {
				const own = CommandsRegistry.getCommand(id);
				if (!own) {
					continue;
				}
				this._register(CommandsRegistry.registerCommand({
					id,
					metadata: own.metadata,
					handler: (accessor, ...args) => {
						const hide = () => instantiation.invokeFunction(own.handler, ...args);
						// A toggle while the block shrinks turns it round.
						if (id.includes('toggle') && this.runs.get(side.part)?.closing) {
							this.open(side.part);
							return undefined;
						}
						if (!this.layout.isVisible(side.part, mainWindow) || !this.close(side.part, hide)) {
							return hide();
						}
						return undefined;
					},
				}));
			}
		}
		this._register(toDisposable(() => { for (const run of this.runs.values()) { run.stop(); } }));
	}

	private moving(): boolean {
		return this.layout.mainContainer.classList.contains('monaco-enable-motion');
	}

	/** Whether the block moves in height (a bottom or top panel) rather than width. */
	private tall(part: Parts): boolean {
		return part === Parts.PANEL_PART && isHorizontal(this.layout.getPanelPosition());
	}

	private still(part: Parts): boolean {
		return (part === Parts.PANEL_PART && this.layout.isPanelMaximized())
			|| (part === Parts.AUXILIARYBAR_PART && this.layout.isAuxiliaryBarMaximized());
	}

	/** Whether the block hangs from the window's far edge (right or bottom), its contents held there. */
	private far(part: Parts): boolean {
		const side = this.layout.getSideBarPosition();
		switch (part) {
			case Parts.SIDEBAR_PART: return side === Position.RIGHT;
			case Parts.AUXILIARYBAR_PART: return side === Position.LEFT;
			default: {
				const panel = this.layout.getPanelPosition();
				return panel === Position.BOTTOM || panel === Position.RIGHT;
			}
		}
	}

	private size(part: Parts): number {
		const size = this.layout.getSize(part);
		return this.tall(part) ? size.height : size.width;
	}

	private setSize(part: Parts, value: number): void {
		const size = this.layout.getSize(part);
		this.layout.setSize(part, this.tall(part) ? { width: size.width, height: value } : { width: value, height: size.height });
	}

	private open(part: Parts): void {
		const running = this.runs.get(part);
		const target = running?.target ?? this.size(part);
		running?.stop();
		if (!this.moving() || this.still(part) || target <= 0) {
			return;
		}
		this.animate(part, running?.size() ?? 0, target, OPEN_MS, target);
	}

	/** Shrinks the block, then hides it; false when it is not to move, so it hides at once. */
	private close(part: Parts, hide: () => unknown): boolean {
		if (!this.moving() || this.still(part)) {
			return false;
		}
		const running = this.runs.get(part);
		const target = running?.target ?? this.size(part);
		const from = running?.size() ?? this.size(part);
		running?.stop();
		stretching.add(part);
		this.animate(part, from, 0, CLOSE_MS, target, () => {
			// Its width back and hidden in one frame: the layout keeps the width for the next opening.
			// Giving it its width back takes room from the other side blocks, so theirs are put back.
			const others = SIDES.filter(s => s.part !== part && this.layout.isVisible(s.part, mainWindow)).map(s => ({ part: s.part, size: this.size(s.part) }));
			this.setSize(part, target);
			try {
				void hide();
				for (const other of others) {
					if (this.size(other.part) !== other.size) {
						this.setSize(other.part, other.size);
					}
				}
			} finally {
				stretching.delete(part);
			}
		});
		return true;
	}

	private animate(part: Parts, from: number, to: number, ms: number, target: number, done?: () => void): void {
		const element = this.layout.getContainer(mainWindow, part);
		const sized = (this.layout as unknown as PartsOf).getPart?.(part);
		if (!element || !sized) {
			done?.();
			return;
		}
		const key = this.tall(part) ? 'minimumHeight' : 'minimumWidth';
		const minimum = sized[key];
		sized[key] = 0;
		// Its own fade stands in for the pop-in it would play on showing (workbench.css).
		element.style.animation = 'none';
		// Its contents keep their full size, held at the window's edge, so the moving edge uncovers
		// them as a drawer's would; laid out narrow they would wrap and jump on every frame.
		const tall = this.tall(part);
		const far = this.far(part);
		const inner = [...element.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
		element.style.overflow = 'hidden';
		// What is inside lays out at the full size the whole time: only the block's box moves.
		const own = sized.layout;
		let last: [number, number, number, number] | undefined;
		sized.layout = (width, height, top, left) => {
			last = [width, height, top, left];
			own.call(sized, tall ? width : Math.max(width, target), tall ? Math.max(height, target) : height, top, left);
		};
		const hold = (size: number) => {
			element.style.opacity = String(Math.min(1, size / Math.max(1, target) * 1.6));
			for (const c of inner) {
				c.style[tall ? 'minHeight' : 'minWidth'] = `${target}px`;
				c.style.transform = far ? `translate${tall ? 'Y' : 'X'}(${size - target}px)` : '';
			}
		};
		hold(from);
		const start = mainWindow.performance.now();
		let current = from;
		let frame = 0;
		let stopped = false;
		const finish = () => {
			mainWindow.cancelAnimationFrame(frame);
			sized[key] = minimum;
			delete (sized as Partial<Sized>).layout;
			if (last && this.layout.isVisible(part, mainWindow)) {
				own.call(sized, ...last);
			}
			element.style.opacity = '';
			element.style.overflow = '';
			for (const c of inner) {
				c.style.minHeight = c.style.minWidth = c.style.transform = '';
			}
			if (this.runs.get(part) === run) {
				this.runs.delete(part);
			}
		};
		const step = () => {
			if (stopped) {
				return;
			}
			const t = Math.min(1, (mainWindow.performance.now() - start) / ms);
			current = from + (to - from) * (done ? easeClose(t) : easeOpen(t));
			this.setSize(part, Math.round(current));
			// Faint while it is narrow, so a sliver of a block never shows its insides.
			hold(Math.round(current));
			if (t < 1) {
				frame = mainWindow.requestAnimationFrame(step);
				return;
			}
			stopped = true;
			finish();
			done?.();
		};
		const run: Run = {
			target,
			closing: !!done,
			size: () => current,
			stop: () => {
				if (!stopped) {
					stopped = true;
					finish();
					stretching.delete(part);
				}
			},
		};
		this.runs.set(part, run);
		this.setSize(part, Math.round(from));
		frame = mainWindow.requestAnimationFrame(step);
	}
}
