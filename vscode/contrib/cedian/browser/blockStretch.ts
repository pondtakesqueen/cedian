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
import { closing, moving, opening } from './blocks/motion.js';
import { ScrollNotes, stillCopy, type StillCopy } from './blocks/copy.js';

/** The side blocks, each with VS Code's commands that hide it. */
const SIDES: readonly { part: Parts; hide: readonly string[] }[] = [
	{ part: Parts.SIDEBAR_PART, hide: ['workbench.action.toggleSidebarVisibility', 'workbench.action.closeSidebar'] },
	{ part: Parts.AUXILIARYBAR_PART, hide: ['workbench.action.toggleAuxiliaryBar', 'workbench.action.closeAuxiliaryBar'] },
	{ part: Parts.PANEL_PART, hide: ['workbench.action.togglePanel', 'workbench.action.closePanel'] },
];

/** The edge a block hangs from: it comes out of it and goes back into it. */
type Edge = 'left' | 'right' | 'top' | 'bottom';

/** All of a block shown, and none of it, folded into `edge`: the clip-paths it moves between. */
const SHOWN = 'inset(0px 0px 0px 0px)';
const folded = (edge: Edge) => ({
	left: 'inset(0px 100% 0px 0px)',
	right: 'inset(0px 0px 0px 100%)',
	top: 'inset(0px 0px 100% 0px)',
	bottom: 'inset(100% 0px 0px 0px)',
})[edge];

/**
 * A side block (Threads, the right panel, the bottom panel) comes out of the window's edge it hangs
 * from and goes back into it, as a drawer: VS Code lays the window out once, at once, and only the
 * block's clip moves (the compositor's work, nothing laid out meanwhile; owner, 2026-11-04: lean
 * before smooth). Shown any way, it is uncovered from that edge. Hidden by VS Code's commands, a
 * copy of it where it stood folds into the edge over the blocks that took its room; hidden any
 * other way, it goes at once. Maximizing is VS Code's, at once. Never scaled, never faded; off with
 * the window's reduced motion.
 */
export class CedianBlockStretch extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.blockStretch';

	/** What has scrolled, so a copy shows each list where it was (copy.ts). */
	private readonly scrolls = new ScrollNotes(mainWindow.document);
	/** Each block's copy still folding away: shown again before it is gone, the block comes out over it. */
	private readonly leaving = new Map<Parts, HTMLElement>();

	constructor(
		@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService,
		@IInstantiationService instantiation: IInstantiationService,
	) {
		super();
		this._register({ dispose: () => this.scrolls.dispose() });
		this._register(layout.onDidChangePartVisibility(e => {
			const side = SIDES.find(s => s.part === e.partId);
			if (side && e.visible) {
				this.open(side.part);
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
						const leaving = this.layout.isVisible(side.part, mainWindow) ? this.copy(side.part) : undefined;
						const result = instantiation.invokeFunction(own.handler, ...args);
						if (leaving && !this.layout.isVisible(side.part, mainWindow)) {
							this.fold(side.part, leaving, this.edge(side.part));
						}
						return result;
					},
				}));
			}
		}
	}

	private moving(): boolean {
		return moving(this.layout.mainContainer) && !this.layout.isPanelMaximized() && !this.layout.isAuxiliaryBarMaximized();
	}

	private edge(part: Parts): Edge {
		const left = this.layout.getSideBarPosition() === Position.LEFT;
		switch (part) {
			case Parts.SIDEBAR_PART: return left ? 'left' : 'right';
			case Parts.AUXILIARYBAR_PART: return left ? 'right' : 'left';
			default: {
				const panel = this.layout.getPanelPosition();
				return panel === Position.TOP ? 'top' : panel === Position.LEFT ? 'left' : panel === Position.RIGHT ? 'right' : 'bottom';
			}
		}
	}

	/** Uncovers a block VS Code has just laid out, from its edge. */
	private open(part: Parts): void {
		// Shown again while its copy still folds away (a quick double toggle): the copy goes, or it
		// would cover the block coming out under it.
		this.leaving.get(part)?.remove();
		this.leaving.delete(part);
		const element = this.layout.getContainer(mainWindow, part);
		if (!element || !this.moving()) {
			return;
		}
		element.animate([{ clipPath: folded(this.edge(part)) }, { clipPath: SHOWN }], opening);
	}

	/** A copy of a block where it stands, to fold away over the window once VS Code has hidden it. */
	private copy(part: Parts): (StillCopy & { from: string }) | undefined {
		const element = this.layout.getContainer(mainWindow, part);
		if (!element || !this.moving()) {
			return undefined;
		}
		const rect = element.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) {
			return undefined;
		}
		// Hidden while still coming out, it folds from as far as it had come, not from all of it.
		const from = element.getAnimations().length ? mainWindow.getComputedStyle(element).clipPath : SHOWN;
		const still = stillCopy(element, this.scrolls);
		const copy = still.copy;
		copy.classList.add('cedian-block-leaving');
		copy.setAttribute('aria-hidden', 'true');
		copy.removeAttribute('id');
		copy.style.left = `${rect.left}px`;
		copy.style.top = `${rect.top}px`;
		copy.style.width = `${rect.width}px`;
		copy.style.height = `${rect.height}px`;
		// It keeps the part's classes, so VS Code's rules for the part apply to it too: it is hidden
		// with !important once the part is, and the card's margin would shift it off its place by
		// the margin. Only inline declarations are stronger.
		copy.style.setProperty('display', 'block', 'important');
		copy.style.setProperty('visibility', 'visible', 'important');
		copy.style.setProperty('margin', '0', 'important');
		return { ...still, from: from && from !== 'none' ? from : SHOWN };
	}

	private fold(part: Parts, leaving: StillCopy & { from: string }, edge: Edge): void {
		const copy = leaving.copy;
		this.leaving.get(part)?.remove();
		this.leaving.set(part, copy);
		this.layout.mainContainer.appendChild(copy);
		leaving.settle();
		const run = copy.animate([{ clipPath: leaving.from }, { clipPath: folded(edge) }], { ...closing, fill: 'forwards' });
		const gone = () => {
			copy.remove();
			if (this.leaving.get(part) === copy) {
				this.leaving.delete(part);
			}
		};
		run.onfinish = gone;
		run.oncancel = gone;
	}
}
