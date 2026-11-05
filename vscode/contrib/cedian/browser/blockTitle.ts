/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { closing, moving, opening } from './blocks/motion.js';

/** The blocks whose header can carry a terminal's own title (VS Code's single-tab action). */
const PARTS: readonly Parts[] = [Parts.SIDEBAR_PART, Parts.AUXILIARYBAR_PART, Parts.PANEL_PART];

/** VS Code's single-tab action: the terminal's icon and title, in the block's header. */
const LABEL = '.action-label.single-terminal-tab';

/**
 * A terminal's title in a block header cross-fades when it changes (the block header mockup's B,
 * owner 2026-11-05): the old title fades out where it stood as the new one fades in, so "zsh" turning
 * into "python3 -m http.server" reads as one title changing rather than a jump. VS Code rebuilds the
 * label on every status, icon or title change (terminalView.ts), so only a change of its text moves.
 * Opacity alone, on the compositor; off with the window's reduced motion. Where the title is cut,
 * workbench.css fades its end instead of an ellipsis.
 */
export class CedianBlockTitle extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.blockTitle';

	private readonly shown = new WeakMap<HTMLElement, string>();

	constructor(@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService) {
		super();
		const observer = new MutationObserver(() => this.check());
		for (const part of PARTS) {
			// The title area is the part's own and lives as long as it; the labels inside it come and go.
			const title = layout.getContainer(mainWindow, part)?.querySelector(':scope > .title');
			if (title) {
				observer.observe(title, { childList: true, subtree: true, characterData: true });
			}
		}
		this._register(toDisposable(() => observer.disconnect()));
		this.check();
	}

	private check(): void {
		const workbench = this.layout.mainContainer;
		for (const label of workbench.querySelectorAll<HTMLElement>(LABEL)) {
			if (label.classList.contains('cedian-title-leaving')) {
				continue;
			}
			const text = words(label);
			const before = this.shown.get(label);
			this.shown.set(label, text);
			if (before === undefined || before === text || !before || !moving(workbench)) {
				continue;
			}
			this.crossFade(label, before);
		}
	}

	/** The old title, a copy of the label as it was, fades out over the new one fading in. */
	private crossFade(label: HTMLElement, before: string): void {
		const slot = label.parentElement;
		if (!slot) {
			return;
		}
		slot.querySelectorAll('.cedian-title-leaving').forEach(old => old.remove());
		const old = label.cloneNode(false) as HTMLElement;
		old.classList.add('cedian-title-leaving');
		old.setAttribute('aria-hidden', 'true');
		old.removeAttribute('id');
		old.removeAttribute('tabindex');
		// The copy carries the icon too, so the icon holds steady while only the words trade places.
		const icon = label.querySelector(':scope > .codicon');
		if (icon) {
			old.append(icon.cloneNode(true));
		}
		old.append(before);
		old.style.left = `${label.offsetLeft}px`;
		old.style.top = `${label.offsetTop}px`;
		old.style.width = `${label.offsetWidth}px`;
		slot.append(old);
		old.animate([{ opacity: 1 }, { opacity: 0 }], { ...closing, fill: 'forwards' }).finished.then(() => old.remove(), () => old.remove());
		label.animate([{ opacity: 0 }, { opacity: 1 }], opening);
	}
}

/** A label's words: its text without its icons' (a codicon is drawn by CSS, but a label can carry text in one). */
function words(label: HTMLElement): string {
	let text = '';
	for (const node of label.childNodes) {
		if (node.nodeType === Node.TEXT_NODE || (node instanceof HTMLElement && !node.classList.contains('codicon'))) {
			text += node.textContent ?? '';
		}
	}
	return text.trim();
}
