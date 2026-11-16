/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { moving } from './blocks/motion.js';
import { ScrollNotes, stillCopy, type StillCopy } from './blocks/copy.js';
import { pop } from './blocks/popin.js';
import { holdScroll, type Box } from './blocks/stretch.js';

/** The side blocks, each with VS Code's commands that hide it. */
const SIDES: readonly { part: Parts; hide: readonly string[] }[] = [
	{ part: Parts.SIDEBAR_PART, hide: ['workbench.action.toggleSidebarVisibility', 'workbench.action.closeSidebar'] },
	{ part: Parts.AUXILIARYBAR_PART, hide: ['workbench.action.toggleAuxiliaryBar', 'workbench.action.closeAuxiliaryBar'] },
	{ part: Parts.PANEL_PART, hide: ['workbench.action.togglePanel', 'workbench.action.closePanel'] },
];

/**
 * A side block (Threads, the right panel, the bottom panel) comes and goes the way Hyprland's
 * windows do (owner, 2026-11-05, the open/close mockup's H): shown, VS Code lays the window out once
 * and the block grows in from 87% of its size at its own centre as it fades in (popin.ts), while
 * the blocks beside it move aside (blockMove.ts); hidden by VS Code's commands, a copy of it where
 * it stood shrinks to 87% as it fades out, over the blocks that take its room. Hidden any other
 * way, it goes at once. Maximizing is VS Code's, at once. Off with the window's reduced motion.
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
			// Told from within the change, before the grid lays the window out; it has by the end of
			// this task, before anything is painted.
			if (side && e.visible) {
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
						const leaving = this.layout.isVisible(side.part, mainWindow) ? this.copy(side.part) : undefined;
						const result = instantiation.invokeFunction(own.handler, ...args);
						if (leaving && !this.layout.isVisible(side.part, mainWindow)) {
							this.fold(side.part, leaving);
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

	/** Pops in a block VS Code has just laid out. */
	private open(part: Parts): void {
		// Shown again while its copy still folds away (a quick double toggle): the copy goes, or it
		// would cover the block coming out under it.
		this.leaving.get(part)?.remove();
		this.leaving.delete(part);
		const element = this.layout.getContainer(mainWindow, part);
		if (!element || !this.moving()) {
			return;
		}
		// A focus landing in it as it comes (the panel's input) would scroll the window to it.
		holdScroll(element, this.layout.mainContainer, pop(element, 'in'));
	}

	/** A copy of a block where it stands, to fold away over the window once VS Code has hidden it. */
	private copy(part: Parts): (StillCopy & { box: Box }) | undefined {
		const element = this.layout.getContainer(mainWindow, part);
		if (!element || !this.moving()) {
			return undefined;
		}
		const rect = element.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) {
			return undefined;
		}
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
		return { ...still, box: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
	}

	private fold(part: Parts, leaving: StillCopy & { box: Box }): void {
		const copy = leaving.copy;
		this.leaving.get(part)?.remove();
		this.leaving.set(part, copy);
		this.layout.mainContainer.appendChild(copy);
		leaving.settle();
		// Shrinking and fading where it stood, as the blocks beside it move back into the room.
		const run = pop(copy, 'out');
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
