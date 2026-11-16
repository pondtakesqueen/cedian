/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import Severity from '../../../../base/common/severity.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ICedianDaemonService } from './daemonService.js';
import { cediaProblem } from './daemon-client/welcome.js';
import type { Notice } from './protocol/wire.js';

/**
 * A blocking problem with the cedia the daemon runs (spec §8.3, §8.4: modal): cedia can't be
 * asked, or it speaks another protocol than the one Cedian was built on. Shown once per problem
 * in a window, at the daemon's welcome, which comes again after each reconnect.
 */
export class CedianWelcomeCheck extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedianWelcomeCheck';
	private readonly shown = new Set<string>();

	constructor(
		@ICedianDaemonService daemon: ICedianDaemonService,
		@IDialogService private readonly dialogs: IDialogService,
	) {
		super();
		this._register(toDisposable(daemon.client.on('welcome', welcome => this.check(welcome))));
		if (daemon.client.welcome) {
			this.check(daemon.client.welcome);
		}
	}

	private check(welcome: Extract<Notice, { kind: 'welcome' }>): void {
		const problem = cediaProblem(welcome);
		if (!problem || this.shown.has(problem.message)) {
			return;
		}
		this.shown.add(problem.message);
		void this.dialogs.prompt({ type: Severity.Error, message: problem.message, detail: problem.detail, buttons: [{ label: 'OK', run: () => { } }] });
	}
}
