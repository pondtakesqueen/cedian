/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { TOOL_PICKS, type ToolPick } from './blocks/places.js';
import { closing, moving, opening } from './blocks/motion.js';

/** How long the pointer rests on "+ Tool" before the strip opens, and is away before it shuts:
 * passing over it on the way somewhere else opens nothing. */
const IN_MS = 150;
const OUT_MS = 250;

/** Opens a tool as "+ Tool" does: a part's container shown and focused, or a command. */
export async function openTool(tool: ToolPick, views: IViewsService, commands: ICommandService): Promise<void> {
	if ('container' in tool.open) {
		await views.openViewContainer(tool.open.container, true);
	} else {
		await commands.executeCommand(tool.open.command);
	}
}

/** The title bar's "+ Tool" chip, VS Code's menu entry for cedian.addTool. */
function chipOf(target: EventTarget | null): HTMLElement | null {
	const element = target instanceof HTMLElement ? target : null;
	const chip = element?.closest<HTMLElement>('.part.titlebar .action-item.menu-entry');
	return chip?.querySelector('.action-label')?.getAttribute('aria-label') === localize('cedian.addTool.chip', "+ Tool") ? chip : null;
}

/**
 * "+ Tool" opens a strip of the tools under it: a raised pill with a close button and each tool's
 * icon, named in its tooltip. It opens when the pointer rests on the chip, the chip is clicked, or
 * Enter, Space or ↓ is pressed on it (not on focus alone: VS Code gives the chip the focus back
 * after a palette closes, which would open it with nobody there), and shuts when the pointer has
 * left both a moment, on Escape or on its close button. It stretches open out of the chip, its edge uncovering the icons, and shuts back into it,
 * never scaled or faded; off with the window's reduced motion. The arrow keys move between its
 * buttons. A tool opens as "Open a Tool" opens it, which stays in the command palette.
 */
export class CedianToolStrip extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.toolStrip';

	private strip: HTMLElement | undefined;
	private chip: HTMLElement | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private pending: 'open' | 'close' | undefined;
	private run: Animation | undefined;
	/** Escape, listened for anywhere only while the strip is up: it may have opened under the pointer alone. */
	private readonly escape = this._register(new MutableDisposable());
	/** The strip's clip at the chip: where it opens from and shuts into. */
	private shut = '';

	constructor(
		@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService,
		@IViewsService private readonly views: IViewsService,
		@ICommandService private readonly commands: ICommandService,
	) {
		super();
		// Listened for on the title bar alone, and the strip while it is up: the rest of the window's
		// pointer and keys are none of its business.
		const bar = layout.getContainer(mainWindow, Parts.TITLEBAR_PART);
		if (!bar) {
			return;
		}
		this._register(addDisposableListener(bar, 'mouseover', e => {
			const chip = chipOf(e.target);
			if (chip) {
				this.hover();
				if (!this.strip && this.pending !== 'open') {
					this.later(() => this.open(chip, false), IN_MS, 'open');
				}
			} else {
				this.away();
			}
		}));
		this._register(addDisposableListener(bar, 'mouseleave', () => this.away()));
		// The chip's own click would run the Quick Pick: it opens the strip instead.
		this._register(addDisposableListener(bar, 'click', e => {
			const chip = chipOf(e.target);
			if (chip) {
				e.preventDefault();
				e.stopPropagation();
				this.later(() => this.open(chip, e.detail === 0), 0);
			}
		}, true));
		this._register(addDisposableListener(bar, 'keydown', e => {
			const chip = chipOf(e.target);
			if (chip && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
				e.preventDefault();
				e.stopPropagation();
				this.later(() => this.open(chip, true), 0);
			}
		}, true));
		this._register(toDisposable(() => { this.later(undefined, 0); this.strip?.remove(); }));
	}

	/** The pointer is on the chip or the strip: a shutting waits no longer. */
	private hover(): void {
		if (this.pending === 'close') {
			this.later(undefined, 0);
		}
	}

	/** The pointer left the chip and the strip: an opening waits no longer, and an open strip shuts in a moment. */
	private away(): void {
		if (this.pending === 'open') {
			this.later(undefined, 0);
		} else if (this.strip && this.pending !== 'close') {
			this.later(() => this.close(false), OUT_MS, 'close');
		}
	}

	private later(then: (() => void) | undefined, ms: number, kind?: 'open' | 'close'): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		this.pending = then ? kind : undefined;
		if (then) {
			this.timer = setTimeout(() => { this.timer = undefined; this.pending = undefined; then(); }, ms);
		}
	}

	private moving(): boolean {
		return moving(this.layout.mainContainer);
	}

	private open(chip: HTMLElement | undefined, focus: boolean): void {
		if (!chip) {
			return;
		}
		if (this.strip) {
			if (focus) {
				this.buttons()[1]?.focus();
			}
			return;
		}
		this.chip = chip;
		const strip = this.strip = mainWindow.document.createElement('div');
		strip.className = 'cedian-tool-strip';
		strip.setAttribute('role', 'toolbar');
		strip.setAttribute('aria-label', localize('cedian.toolStrip', "Tools"));
		const close = this.button('close', localize('cedian.toolStrip.close', "Close"), () => this.close(true));
		close.classList.add('close');
		strip.append(close);
		for (const tool of TOOL_PICKS) {
			strip.append(this.button(tool.icon, tool.label, () => {
				this.close(false);
				void openTool(tool, this.views, this.commands);
			}));
		}
		strip.addEventListener('keydown', e => this.key(e));
		strip.addEventListener('mouseenter', () => this.hover());
		strip.addEventListener('mouseleave', () => this.away());
		this.escape.value = addDisposableListener(mainWindow.document, 'keydown', e => {
			if (e.key === 'Escape' && !strip.contains(e.target as Node)) {
				e.preventDefault();
				e.stopPropagation();
				this.close(false);
			}
		}, true);
		// Tabbing out of it shuts it.
		strip.addEventListener('focusout', e => {
			const to = e.relatedTarget as Node | null;
			if (to && !strip.contains(to) && !chip.contains(to)) {
				this.close(false);
			}
		});
		this.layout.mainContainer.append(strip);
		// Under the chip, its right edge on the chip's, inside the window.
		const at = chip.getBoundingClientRect();
		const width = strip.offsetWidth;
		const left = Math.max(8, Math.min(at.right - width, mainWindow.innerWidth - width - 8));
		strip.style.left = `${left}px`;
		strip.style.top = `${at.bottom + 6}px`;
		if (this.moving()) {
			// Out of the chip: from the chip's width, at the chip's place in the strip, to its own.
			const from = `inset(0px ${Math.max(0, left + width - at.right)}px 0px ${Math.max(0, at.left - left)}px round 999px)`;
			this.shut = from;
			this.run = strip.animate([{ clipPath: from }, { clipPath: 'inset(0px 0px 0px 0px round 999px)' }], { ...opening, fill: 'both' });
		}
		if (focus) {
			this.buttons()[1]?.focus();
		}
	}

	private close(refocus: boolean): void {
		const strip = this.strip;
		const chip = this.chip;
		if (!strip) {
			return;
		}
		// The chip takes the focus back while the strip is still there, so taking it opens nothing.
		if (refocus) {
			chip?.querySelector<HTMLElement>('.action-label')?.focus();
		}
		this.strip = undefined;
		this.escape.clear();
		this.chip = undefined;
		this.later(undefined, 0);
		const gone = () => strip.remove();
		if (!this.moving() || !this.run) {
			gone();
			return;
		}
		// Back into the chip, on the closing timing, from wherever its opening has got to.
		const now = mainWindow.getComputedStyle(strip).clipPath;
		this.run.cancel();
		this.run = undefined;
		strip.style.pointerEvents = 'none';
		const run = strip.animate([{ clipPath: now }, { clipPath: this.shut }], { ...closing, fill: 'forwards' });
		run.onfinish = gone;
		run.oncancel = gone;
	}

	private buttons(): HTMLElement[] {
		return [...this.strip?.querySelectorAll<HTMLElement>('button') ?? []];
	}

	private button(icon: string, label: string, act: () => void): HTMLButtonElement {
		const button = mainWindow.document.createElement('button');
		button.type = 'button';
		button.className = `cedian-tool-strip-item codicon codicon-${icon}`;
		button.title = label;
		button.setAttribute('aria-label', label);
		button.addEventListener('click', e => { e.stopPropagation(); act(); });
		return button;
	}

	private key(e: KeyboardEvent): void {
		const buttons = this.buttons();
		const at = buttons.indexOf(mainWindow.document.activeElement as HTMLElement);
		const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
		if (step) {
			e.preventDefault();
			buttons[(at + step + buttons.length) % buttons.length]?.focus();
		} else if (e.key === 'Home' || e.key === 'End') {
			e.preventDefault();
			buttons[e.key === 'Home' ? 0 : buttons.length - 1]?.focus();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			this.close(true);
		}
	}
}
