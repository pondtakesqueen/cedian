/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService, Parts, Position } from '../../../services/layout/browser/layoutService.js';
import { moving } from './blocks/motion.js';
import { play, type Playing } from './blocks/resize.js';

/** The side blocks, each with VS Code's commands that hide it. */
const SIDES: readonly { part: Parts; hide: readonly string[] }[] = [
	{ part: Parts.SIDEBAR_PART, hide: ['workbench.action.toggleSidebarVisibility', 'workbench.action.closeSidebar'] },
	{ part: Parts.AUXILIARYBAR_PART, hide: ['workbench.action.toggleAuxiliaryBar', 'workbench.action.closeAuxiliaryBar'] },
	{ part: Parts.PANEL_PART, hide: ['workbench.action.togglePanel', 'workbench.action.closePanel'] },
];

/** The class on the window while a side block is resized frame by frame (blockMove.ts leaves it be). */
export const RESIZING = 'cedian-block-resizing';
/** Fired on the window once a side block has played its size out. */
export const RESIZED = 'cedian-block-resized';

/** A part's least size, which the grid keeps it at or above. */
interface Least { minimumWidth: number; minimumHeight: number }

/**
 * A side block (Threads, the right panel, the bottom panel) grows out of the window's edge it hangs
 * from and shrinks back into it, laid out at every size it passes through, so the blocks beside it
 * shrink to make room and stretch back, each laid out too: what sits on a block's far edge (a
 * scrollbar, the composer, its send button) moves with that edge (owner, 2026-11-05, the open/close
 * mockup's E, every frame resized). For the length of it the block's least size is let down to
 * nothing, which VS Code's grid would otherwise keep it at or above (170 px, the panel 77 px).
 * Shown any way, it grows; hidden by VS Code's commands, it shrinks first and is hidden at its end,
 * at its own size again so VS Code keeps that for its next showing; hidden any other way, it goes
 * at once. Opening and closing take the same time and curve. Maximizing is VS Code's, at once.
 * Never scaled, never faded; off with the window's reduced motion.
 */
export class CedianBlockStretch extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.blockStretch';

	/** Each block's size being played out. */
	private readonly playing = new Map<Parts, Playing>();

	constructor(
		@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService,
		@IInstantiationService instantiation: IInstantiationService,
	) {
		super();
		this._register(layout.onDidChangePartVisibility(e => {
			const side = SIDES.find(s => s.part === e.partId);
			if (!side || !e.visible || !this.moving() || !this.least(side.part)) {
				return;
			}
			// Told from within the change, before the grid lays the window out; it has by the end of
			// this task, before anything is painted. Marked now, so blockMove leaves the blocks be.
			this.layout.mainContainer.classList.add(RESIZING);
			queueMicrotask(() => this.open(side.part));
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
						// A second press while it still moves: it lands where it was going first.
						this.playing.get(side.part)?.finish();
						if (!this.layout.isVisible(side.part, mainWindow) || !this.moving() || !this.least(side.part)) {
							return hide();
						}
						return this.close(side.part, hide);
					},
				}));
			}
		}
		this._register({ dispose: () => this.playing.forEach(p => p.finish()) });
	}

	private moving(): boolean {
		return moving(this.layout.mainContainer) && !this.layout.isPanelMaximized() && !this.layout.isAuxiliaryBarMaximized();
	}

	/** VS Code's own part, whose least size the grid reads as it lays out. */
	private least(part: Parts): Least | undefined {
		const get = (this.layout as unknown as { getPart?(part: Parts): Least }).getPart;
		const found = typeof get === 'function' ? get.call(this.layout, part) : undefined;
		return found && typeof found.minimumWidth === 'number' ? found : undefined;
	}

	/** Whether the block hangs from a side (its width moves) or the top or bottom (its height). */
	private across(part: Parts): boolean {
		if (part !== Parts.PANEL_PART) {
			return true;
		}
		const panel = this.layout.getPanelPosition();
		return panel === Position.LEFT || panel === Position.RIGHT;
	}

	/** Grows a block VS Code has just shown, from nothing to the size it laid it out at. */
	private open(part: Parts): void {
		const element = this.slot(part);
		if (!element?.offsetParent) {
			this.settled();
			return;
		}
		const size = this.across(part) ? element.offsetWidth : element.offsetHeight;
		void this.resize(part, size, 0, size).then(() => this.settled());
	}

	/** Shrinks a block into its edge, then hides it at its own size again. */
	private async close<T>(part: Parts, hide: () => T): Promise<Awaited<T>> {
		const element = this.slot(part)!;
		const size = this.across(part) ? element.offsetWidth : element.offsetHeight;
		this.layout.mainContainer.classList.add(RESIZING);
		await this.resize(part, size, size, 0, () => {
			// Back at its size, then hidden, in one task: VS Code keeps the size it had for its next
			// showing, and nothing is painted between.
			this.layout.setSize(part, this.sized(part, element, size));
		});
		const result = hide();
		// After the hide's own news of it: blockMove reads that at the end of this task.
		queueMicrotask(() => this.settled());
		return await result;
	}

	/**
	 * Plays a block's size from `from` to `to`, laying the window out at each. `last` runs at its
	 * end in place of laying it out at `to`, before its least size is put back.
	 */
	private resize(part: Parts, size: number, from: number, to: number, last?: () => void): Promise<void> {
		const least = this.least(part)!;
		const was = { minimumWidth: least.minimumWidth, minimumHeight: least.minimumHeight };
		const element = this.slot(part)!;
		if (this.across(part)) {
			least.minimumWidth = 0;
		} else {
			least.minimumHeight = 0;
		}
		const playing = play(from, to, s => {
			if (s === to && last) {
				return;
			}
			this.layout.setSize(part, this.sized(part, element, s));
		}, {
			request: cb => mainWindow.requestAnimationFrame(cb),
			cancel: id => mainWindow.cancelAnimationFrame(id),
			now: () => mainWindow.performance.now(),
		});
		this.playing.set(part, playing);
		return playing.done.then(() => {
			last?.();
			least.minimumWidth = was.minimumWidth;
			least.minimumHeight = was.minimumHeight;
			if (this.playing.get(part) === playing) {
				this.playing.delete(part);
			}
		});
	}

	/** The grid's box for a part: the part's card sits in it with a margin, its size is the box's. */
	private slot(part: Parts): HTMLElement | undefined {
		const element = this.layout.getContainer(mainWindow, part);
		return element?.parentElement ?? element;
	}

	/** A size for VS Code's grid: this much across or down, the block's other side as it is. */
	private sized(part: Parts, element: HTMLElement, size: number): { width: number; height: number } {
		return this.across(part) ? { width: size, height: element.offsetHeight } : { width: element.offsetWidth, height: size };
	}

	private settled(): void {
		if (this.playing.size === 0) {
			this.layout.mainContainer.classList.remove(RESIZING);
			this.layout.mainContainer.dispatchEvent(new CustomEvent(RESIZED));
		}
	}
}
