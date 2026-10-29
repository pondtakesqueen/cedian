/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { InlineCompletionContext, InlineCompletions, InlineCompletionsProvider } from '../../../../editor/common/languages.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ICedianDaemonService } from './daemonService.js';
import { completionRequest, DEBOUNCE_MS, inlineItem, shouldAsk } from './completion/completion.js';
import type { Completion } from './protocol/wire.js';

/**
 * Tab completion (spec G4): ghost text after the cursor in a project file, from `cedia complete`
 * through the daemon. VS Code waits `DEBOUNCE_MS` after typing stops, shows the item, and Tab
 * takes it. A newer ask stops the one before in the daemon, so a cancelled ask simply gets no
 * answer. `editor.inlineSuggest.enabled` (Settings → Editor → Tab completion) turns it off.
 */
export class CedianTabCompletion extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedianTabCompletion';

	constructor(
		@ILanguageFeaturesService languageFeatures: ILanguageFeaturesService,
		@ICedianDaemonService private readonly daemon: ICedianDaemonService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@ILogService private readonly log: ILogService,
	) {
		super();
		const provider: InlineCompletionsProvider = {
			displayName: 'cedia',
			debounceDelayMs: DEBOUNCE_MS,
			provideInlineCompletions: (model, position, context, token) => this.provide(model, position, context, token),
			disposeInlineCompletions: () => { },
		};
		this._register(languageFeatures.inlineCompletionsProvider.register({ scheme: 'file' }, provider));
	}

	private async provide(model: ITextModel, position: Position, _context: InlineCompletionContext, token: CancellationToken): Promise<InlineCompletions | undefined> {
		const lineText = model.getLineContent(position.lineNumber);
		const folder = this.workspace.getWorkspaceFolder(model.uri);
		if (!folder || !shouldAsk(lineText, position.column) || this.daemon.client.connection !== 'connected') {
			return undefined;
		}
		const id = generateUuid();
		const request = completionRequest({ id, cwd: folder.uri.fsPath, file: model.uri.fsPath, line: position.lineNumber, column: position.column, text: model.getValue() });
		if (!request) {
			return undefined;
		}
		const version = model.getVersionId();
		const completion = await new Promise<Completion | undefined>(resolve => {
			const off = this.daemon.client.on('completion', notice => {
				if (notice.id === id) {
					done(notice.completion);
				}
			});
			const cancel = token.onCancellationRequested(() => done(undefined));
			const done = (c: Completion | undefined) => {
				off();
				cancel.dispose();
				resolve(c);
			};
			this.daemon.client.request(request);
		});
		if (!completion || token.isCancellationRequested || model.isDisposed() || model.getVersionId() !== version) {
			return undefined;
		}
		if ('error' in completion) {
			this.log.info(`[cedian] tab completion: ${completion.error}`);
			return undefined;
		}
		this.log.trace(`[cedian] tab completion from ${completion.model} in ${completion.ms} ms`);
		const item = inlineItem(lineText, position.column, completion);
		if (!item) {
			return undefined;
		}
		return { items: [{ insertText: item.insertText, range: new Range(position.lineNumber, item.startColumn, position.lineNumber, item.endColumn) }] };
	}
}
