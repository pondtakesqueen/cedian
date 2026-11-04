/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { isHorizontal, IWorkbenchLayoutService, Parts, Position } from '../../../services/layout/browser/layoutService.js';
import { CLOSE_MS, easeClose, easeOpen, moving, OPEN_MS } from './blocks/motion.js';

/** The side blocks that stretch, each with VS Code's commands that hide it. */
const SIDES: readonly { part: Parts; hide: readonly string[] }[] = [
	{ part: Parts.SIDEBAR_PART, hide: ['workbench.action.toggleSidebarVisibility', 'workbench.action.closeSidebar'] },
	{ part: Parts.AUXILIARYBAR_PART, hide: ['workbench.action.toggleAuxiliaryBar', 'workbench.action.closeAuxiliaryBar'] },
	{ part: Parts.PANEL_PART, hide: ['workbench.action.togglePanel', 'workbench.action.closePanel'] },
];

/** The parts' own sizes and layout: VS Code's layout service keeps the parts to itself. */
interface Sized { minimumWidth: number; minimumHeight: number; layout(width: number, height: number, top: number, left: number): void }
interface PartsOf { getPart?(part: Parts): Sized }

/** The side blocks closing by stretching now: hiding them again is theirs. */
const stretching = new Set<Parts>();

interface Run { stop(): void; size(): number; target: number; closing: boolean; held: readonly number[] }

/**
 * A side block (Threads, the right panel, the bottom panel) stretches open from nothing to its
 * width, and shrinks to nothing before it goes, as a sash drag would move it: its neighbours give
 * up the room as it grows and take it back as it shrinks, and nothing is squeezed or scaled. Every
 * frame sets the block's real size, so the neighbours lay out as they move; the block's own
 * contents stay laid out at its full size, held at the window's edge, and its moving edge uncovers
 * them as a drawer's would. Its minimum size is lifted while it moves and put back after. VS Code's commands that hide a block run once it has
 * shrunk, after its size is set back to its width in the same frame, so the layout remembers that
 * width and the next opening grows back to it. It stays fully drawn the whole time: its edge
 * uncovers what is inside, nothing fades. A block hidden any other way goes at once, and the
 * editor's blocks slide over into its room (blockMove.ts). Off with the window's reduced motion.
 */
export class CedianBlockStretch extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.blockStretch';

	private readonly runs = new Map<Parts, Run>();
	/** Side blocks a maximize or its undoing shows and moves itself: they don't stretch open on their own. */
	private readonly quiet = new Set<Parts>();
	private maximizing = false;

	constructor(
		@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService,
		@IInstantiationService instantiation: IInstantiationService,
	) {
		super();
		this._register(layout.onDidChangePartVisibility(e => {
			const side = SIDES.find(s => s.part === e.partId);
			if (side && e.visible && !stretching.has(side.part) && !this.quiet.has(side.part)) {
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
		this.maximizes();
	}

	/**
	 * Maximizing the bottom panel or the right panel, and putting it back, stretches it as opening
	 * and closing one does: its real size moves frame by frame and the blocks it covers give way to
	 * nothing (their minimum sizes lifted meanwhile), then VS Code maximizes it with nothing left to
	 * jump; putting it back, VS Code restores the layout and the block shrinks from the whole window
	 * to its size while the others come back. VS Code's own toggles are followed, so its commands,
	 * its buttons and its keys all do it. A maximize VS Code makes for itself stays as it is.
	 */
	private maximizes(): void {
		type Toggles = { toggleMaximizedPanel(): void; toggleMaximizedAuxiliaryBar(): void };
		const layout = this.layout as unknown as Toggles;
		const panel = layout.toggleMaximizedPanel;
		const aux = layout.toggleMaximizedAuxiliaryBar;
		if (typeof panel !== 'function' || typeof aux !== 'function') {
			return;
		}
		layout.toggleMaximizedPanel = () => this.maximizePanel(() => panel.call(layout));
		layout.toggleMaximizedAuxiliaryBar = () => this.maximizeAux(() => aux.call(layout));
		this._register(toDisposable(() => {
			delete (layout as Partial<Toggles>).toggleMaximizedPanel;
			delete (layout as Partial<Toggles>).toggleMaximizedAuxiliaryBar;
		}));
	}

	private visible(part: Parts): boolean {
		return this.layout.isVisible(part, mainWindow);
	}

	/** The editor area's size the way `part` moves. */
	private editorSize(part: Parts): number {
		const size = this.layout.getSize(Parts.EDITOR_PART);
		return this.tall(part) ? size.height : size.width;
	}

	private maximizePanel(own: () => void): void {
		const part = Parts.PANEL_PART;
		const tall = this.tall(part);
		// VS Code maximizes a bottom panel only when it spans the editor's column.
		if (!this.moving() || this.maximizing || this.runs.size || (tall && this.layout.getPanelAlignment() !== 'center')) {
			return own();
		}
		if (this.layout.isPanelMaximized()) {
			own();
			const to = this.size(part);
			this.tween([{ part, from: to + this.editorSize(part), to }], CLOSE_MS, easeClose);
			return;
		}
		if (!this.visible(part) || !this.visible(Parts.EDITOR_PART)) {
			return own();
		}
		const from = this.size(part);
		// VS Code keeps the size it had to go back to: it is given back before VS Code takes it.
		this.tween([{ part, from, to: from + this.editorSize(part) }], OPEN_MS, easeOpen, () => { this.setSize(part, from); own(); });
	}

	private maximizeAux(own: () => void): void {
		const part = Parts.AUXILIARYBAR_PART;
		// A panel beside the editor, not under it, would need a third block to give way: VS Code's as is.
		const sidePanel = this.visible(Parts.PANEL_PART) && !this.tall(Parts.PANEL_PART);
		if (!this.moving() || this.maximizing || this.runs.size || sidePanel) {
			return own();
		}
		const sidebar = Parts.SIDEBAR_PART;
		if (this.layout.isAuxiliaryBarMaximized()) {
			// What VS Code shows again moves with it, not on its own.
			this.quiet.add(sidebar);
			this.quiet.add(Parts.PANEL_PART);
			try {
				own();
			} finally {
				this.quiet.clear();
			}
			const to = this.size(part);
			const side = this.visible(sidebar) ? this.size(sidebar) : 0;
			const steps = [{ part, from: to + this.editorSize(part) + side, to }];
			if (side) {
				steps.unshift({ part: sidebar, from: 0, to: side });
			}
			this.tween(steps, CLOSE_MS, easeClose);
			return;
		}
		if (!this.visible(part) || !this.visible(Parts.EDITOR_PART)) {
			return own();
		}
		const from = this.size(part);
		const side = this.visible(sidebar) ? this.size(sidebar) : 0;
		const steps = [{ part, from, to: from + this.editorSize(part) + side }];
		if (side) {
			steps.unshift({ part: sidebar, from: side, to: 0 });
		}
		this.tween(steps, OPEN_MS, easeOpen, () => {
			if (side) {
				this.setSize(sidebar, side);
			}
			this.setSize(part, from);
			own();
		});
	}

	/**
	 * Moves blocks' real sizes from `from` to `to` together, frame by frame, the editor area and the
	 * side blocks free to go down to nothing meanwhile; `done` runs in the last frame, before it is drawn.
	 */
	private tween(steps: readonly { part: Parts; from: number; to: number }[], ms: number, ease: (t: number) => number, done?: () => void): void {
		this.maximizing = true;
		const parts = (this.layout as unknown as PartsOf);
		const lifted: (() => void)[] = [];
		for (const part of [Parts.EDITOR_PART, Parts.SIDEBAR_PART, Parts.AUXILIARYBAR_PART, Parts.PANEL_PART]) {
			const view = parts.getPart?.(part);
			for (const key of ['minimumWidth', 'minimumHeight'] as const) {
				if (!view) {
					continue;
				}
				const own = Object.getOwnPropertyDescriptor(view, key);
				Object.defineProperty(view, key, { configurable: true, get: () => 0, set: () => { } });
				lifted.push(() => {
					if (own) {
						Object.defineProperty(view, key, own);
					} else {
						delete (view as Partial<Sized>)[key];
					}
				});
			}
		}
		const set = (t: number) => {
			for (const step of steps) {
				this.setSize(step.part, Math.round(step.from + (step.to - step.from) * ease(t)));
			}
		};
		const start = mainWindow.performance.now();
		const end = () => {
			for (const undo of lifted.reverse()) {
				undo();
			}
			this.maximizing = false;
		};
		const frame = () => {
			const t = Math.min(1, (mainWindow.performance.now() - start) / ms);
			try {
				set(t);
			} catch (error) {
				// A block gone meanwhile: the rest stays where it is, and VS Code's layout stands.
				end();
				onUnexpectedError(error);
				return;
			}
			if (t < 1) {
				mainWindow.requestAnimationFrame(frame);
				return;
			}
			end();
			done?.();
		};
		set(0);
		mainWindow.requestAnimationFrame(frame);
	}

	private moving(): boolean {
		return moving(this.layout.mainContainer);
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
		this.animate(part, running?.size() ?? 0, target, OPEN_MS, target, running?.held);
	}

	/** Shrinks the block, then hides it; false when it is not to move, so it hides at once. */
	private close(part: Parts, hide: () => unknown): boolean {
		if (!this.moving() || this.still(part)) {
			return false;
		}
		const running = this.runs.get(part);
		const target = running?.target ?? this.size(part);
		const from = running?.size() ?? this.size(part);
		const held = running?.held;
		running?.stop();
		stretching.add(part);
		this.animate(part, from, 0, CLOSE_MS, target, held, () => {
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

	private animate(part: Parts, from: number, to: number, ms: number, target: number, measured: readonly number[] | undefined, done?: () => void): void {
		const element = this.layout.getContainer(mainWindow, part);
		const sized = (this.layout as unknown as PartsOf).getPart?.(part);
		if (!element || !sized) {
			done?.();
			return;
		}
		const key = this.tall(part) ? 'minimumHeight' : 'minimumWidth';
		const minimum = sized[key];
		sized[key] = 0;
		// Its contents keep their full size, held at the window's edge, so the moving edge uncovers
		// them as a drawer's would; laid out narrow they would wrap and jump on every frame.
		const tall = this.tall(part);
		const far = this.far(part);
		const inner = [...element.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
		// Each child held at the size it has at the block's full size, as measured there: the block's
		// size is not its children's (its card margins, its border), and holding them at the block's
		// size would have them jump by the difference when the run ends.
		const held = measured?.length === inner.length ? measured
			: inner.map(c => this.size(part) === target ? (tall ? c.offsetHeight : c.offsetWidth) : target);
		element.style.overflow = 'hidden';
		// What is inside lays out at the full size the whole time: only the block's box moves.
		const own = sized.layout;
		let last: [number, number, number, number] | undefined;
		sized.layout = (width, height, top, left) => {
			last = [width, height, top, left];
			own.call(sized, tall ? width : Math.max(width, target), tall ? Math.max(height, target) : height, top, left);
		};
		const hold = (size: number) => {
			inner.forEach((c, i) => {
				c.style[tall ? 'minHeight' : 'minWidth'] = `${held[i]}px`;
				c.style.transform = far ? `translate${tall ? 'Y' : 'X'}(${size - target}px)` : '';
			});
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
			held,
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
