/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { getMarks, mark } from '../../../../base/common/performance.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { curtainDown } from './blocks/curtain.js';
import { ICedianDaemonService } from './daemonService.js';
import { formatPhases, launchMarks, PhaseLog, phaseReport, type PhaseReport } from './timing/phases.js';

/** The window's reports, newest last, for the smoke tests and the developer tools' console. */
const reports: PhaseReport[] = [];
(mainWindow as unknown as { cedianTiming?: PhaseReport[] }).cedianTiming = reports;

/** Logs a report (the window's log: Developer: Open Logs Folder, or the developer tools). */
export function logPhases(log: ILogService, report: PhaseReport): void {
	reports.push(report);
	log.info(`[cedian timing] ${formatPhases(report)}`);
}

/** The launch report is written once these are all reached, or after this long whatever is missing. */
const LAUNCH_DONE = ['daemon connected', 'cedia answered', 'threads listed', 'curtain up'];
const LAUNCH_MAX_MS = 45_000;

/**
 * Where a window's launch goes (the app's own start, or a project tab that had no window):
 * VS Code's startup marks, then Cedian's: the workbench restored, the daemon connected, cedia's
 * answer to the welcome (the protocol check), the first thread list, and the curtain lifted.
 * One line in the log when the last of them is reached. Marks only; nothing waits on it.
 */
export class CedianLaunchTiming extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.launchTiming';
	private readonly phases = new PhaseLog('launch');
	private done = false;

	constructor(
		@IWorkbenchLayoutService layout: IWorkbenchLayoutService,
		@ILifecycleService lifecycle: ILifecycleService,
		@ICedianDaemonService daemon: ICedianDaemonService,
		@ILogService private readonly log: ILogService,
	) {
		super();
		this.reached('cedian loaded');
		lifecycle.when(LifecyclePhase.Restored).then(() => this.reached('workbench restored'));

		const client = daemon.client;
		if (client.connection === 'connected') {
			this.reached('daemon connected');
		}
		this._register(toDisposable(client.onConnection(state => {
			if (state === 'connected') {
				this.reached('daemon connected');
			}
		})));
		if (client.welcome) {
			this.reached('cedia answered');
		}
		this._register(toDisposable(client.on('welcome', () => this.reached('cedia answered'))));
		this._register(toDisposable(client.on('threads', () => this.reached('threads listed'))));

		// The curtain is a class on the workbench (curtain.ts); it is up when the class is gone.
		const workbench = layout.mainContainer;
		const observer = new MutationObserver(() => {
			if (!curtainDown(workbench)) {
				this.reached('curtain up');
				observer.disconnect();
			}
		});
		observer.observe(workbench, { attributes: true, attributeFilter: ['class'] });
		this._register(toDisposable(() => observer.disconnect()));

		const timer = setTimeout(() => this.finish(), LAUNCH_MAX_MS);
		this._register(toDisposable(() => clearTimeout(timer)));
	}

	private reached(name: string): void {
		if (this.done) {
			return;
		}
		this.phases.mark(name);
		// In VS Code's own marks too, so Developer: Startup Performance shows them beside its own.
		mark(`cedian/${name.replace(/ /g, '-')}`);
		if (LAUNCH_DONE.every(n => this.phases.has(n))) {
			this.finish();
		}
	}

	private finish(): void {
		if (this.done) {
			return;
		}
		this.done = true;
		// Both clocks count from the epoch: VS Code's marks, and Date.now() for Cedian's.
		const marks = [...launchMarks(getMarks()), ...this.phases.all()];
		const missing = LAUNCH_DONE.filter(n => !this.phases.has(n));
		logPhases(this.log, phaseReport(missing.length ? `launch (never reached: ${missing.join(', ')})` : 'launch', marks));
	}
}
