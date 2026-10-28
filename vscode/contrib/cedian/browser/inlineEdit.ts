/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import { URI } from '../../../../base/common/uri.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { Range } from '../../../../editor/common/core/range.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ICedianDaemonService } from './daemonService.js';
import { inlineEditRequest, outcome, proposedText } from './inline-edit/inline-edit.js';
import type { InlineEdit } from './protocol/wire.js';

/**
 * Cmd+K in a text editor: asks what to change, sends the selection to cedia through the daemon,
 * and shows the answer as a diff of the buffer against the proposal, with รับ (accept, which
 * edits the buffer) and ไม่เอา (discard). Nothing is written to disk here.
 */
export async function runInlineEdit(accessor: ServicesAccessor): Promise<void> {
	const editorService = accessor.get(IEditorService);
	const quickInput = accessor.get(IQuickInputService);
	const notifications = accessor.get(INotificationService);
	const progress = accessor.get(IProgressService);
	const modelService = accessor.get(IModelService);
	const workspace = accessor.get(IWorkspaceContextService);
	const daemon = accessor.get(ICedianDaemonService);

	const editor = editorService.activeTextEditorControl;
	if (!isCodeEditor(editor) || !editor.hasModel()) {
		return;
	}
	const model = editor.getModel();
	const selection = editor.getSelection();
	const folder = workspace.getWorkspaceFolder(model.uri) ?? workspace.getWorkspace().folders[0];
	if (!folder || model.uri.scheme !== 'file') {
		notifications.info('Inline edit ใช้ได้กับไฟล์ใน project ที่เปิดอยู่');
		return;
	}
	const instruction = await quickInput.input({
		placeHolder: selection.isEmpty() ? 'จะให้เขียนอะไรตรงนี้' : 'จะให้แก้ส่วนที่เลือกอย่างไร',
		prompt: 'cedia จะเสนอการแก้เป็น diff ให้รับหรือไม่เอา',
	});
	if (!instruction?.trim()) {
		return;
	}
	const text = model.getValue();
	const version = model.getAlternativeVersionId();
	const id = generateUuid();
	const request = inlineEditRequest({ id, cwd: folder.uri.fsPath, file: model.uri.fsPath, selection, instruction, text });
	if ('error' in request) {
		notifications.warn(request.error);
		return;
	}
	const answer = new Promise<InlineEdit>(resolve => {
		const off = daemon.client.on('inline_edit', notice => {
			if (notice.id === id) {
				off();
				resolve(notice.edit);
			}
		});
	});
	daemon.client.request(request);
	const edit = await progress.withProgress({ location: ProgressLocation.Notification, title: 'cedia กำลังเขียนการแก้…' }, () => answer);
	const result = outcome(edit);
	if ('error' in result) {
		notifications.warn(`Inline edit: ${result.error}`);
		return;
	}

	const proposal = modelService.createModel(
		proposedText(text, selection, result.replacement),
		{ languageId: model.getLanguageId(), onDidChange: () => ({ dispose() { } }) },
		URI.from({ scheme: 'cedian-proposed', path: model.uri.path, query: id }),
	);
	await editorService.openEditor({
		original: { resource: model.uri },
		modified: { resource: proposal.uri },
		label: `${model.uri.path.split('/').pop()} (inline edit)`,
		options: { pinned: false, selection: { startLineNumber: selection.startLineNumber, startColumn: 1 } },
	});
	const close = async () => {
		for (const opened of editorService.findEditors(proposal.uri)) {
			await editorService.closeEditor(opened);
		}
		proposal.dispose();
	};
	notifications.prompt(Severity.Info, `inline edit จาก ${result.model} ($${result.costUsd.toFixed(3)})`, [
		{
			label: 'รับ',
			run: async () => {
				if (model.isDisposed() || model.getAlternativeVersionId() !== version) {
					notifications.warn('ไฟล์เปลี่ยนไประหว่างรอ: ไม่ได้แก้ ลอง Cmd+K อีกครั้ง');
				} else {
					model.pushEditOperations([selection], [{ range: Range.lift(selection), text: result.replacement }], () => null);
					model.pushStackElement();
				}
				await close();
				editor.focus();
			},
		},
		{ label: 'ไม่เอา', run: close },
	], { sticky: true, onCancel: () => { void close(); } });
}
