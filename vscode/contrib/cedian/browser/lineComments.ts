/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/lineComments.css';
import { $ } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { ICodeEditor, IViewZone, MouseTargetType } from '../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { Range } from '../../../../editor/common/core/range.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { ZoneWidget } from '../../../../editor/contrib/zoneWidget/browser/zoneWidget.js';
import { ICedianDaemonService } from './daemonService.js';
import { addComment, lineNotes, sendComments, setComments } from './review/notes.js';
import { ICedianReviewService } from './review.js';

/** Where the person is commenting: the thread, its working tree and the file's path in it. */
type At = { thread: string; cwd: string; path: string };

/** The comment box under one line: Enter adds the comment, Cmd+Enter adds it and sends them all. */
class CommentBox extends ZoneWidget {
	private input?: HTMLTextAreaElement;

	constructor(editor: ICodeEditor, private readonly line: number, private readonly done: (text: string, send: boolean) => void) {
		super(editor, { showFrame: true, showArrow: false, isResizeable: false, keepEditorSelection: true });
		this.create();
	}

	protected _fillContainer(container: HTMLElement): void {
		container.classList.add('cedian-comment-box');
		const input = this.input = $<HTMLTextAreaElement>('textarea');
		input.rows = 2;
		input.placeholder = isMacintosh ? 'Comment on this line · Enter adds · ⌘Enter sends all' : 'Comment on this line · Enter adds · Ctrl+Enter sends all';
		input.addEventListener('keydown', e => {
			// The editor would take these keys as its own.
			e.stopPropagation();
			if (e.key === 'Escape') {
				e.preventDefault();
				this.dispose();
			} else if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.done(input.value, isMacintosh ? e.metaKey : e.ctrlKey);
				this.dispose();
			}
		});
		container.append(input);
	}

	open(): void {
		this.show({ lineNumber: this.line, column: 1 }, 3);
		this.input?.focus();
	}
}

/**
 * Line comments in a thread's review diff (spec §3.7): a `+` beside the line under the pointer
 * opens a comment box. The comments wait in the daemon until Cmd+Enter (or Send all on the pane's
 * card) sends them as the thread's next message. The comments and the review's open findings
 * show under their lines, a finding with Fix this one and Dismiss.
 */
class CedianLineComments extends Disposable implements IEditorContribution {
	static readonly ID = 'cedian.lineComments';

	private readonly plus = this.editor.createDecorationsCollection();
	private readonly zones: string[] = [];
	private readonly modelListeners = this._register(new DisposableStore());
	private at?: At;
	private box?: CommentBox;

	constructor(
		private readonly editor: ICodeEditor,
		@ICedianReviewService private readonly reviews: ICedianReviewService,
		@ICedianDaemonService private readonly daemon: ICedianDaemonService,
	) {
		super();
		this._register(editor.onDidChangeModel(() => this.attach()));
		this._register(reviews.onDidChangeNotes(thread => thread === this.at?.thread && this.drawNotes()));
		this.attach();
	}

	/** Only the right side of a review's diff takes comments. */
	private attach(): void {
		this.modelListeners.clear();
		this.plus.clear();
		this.box?.dispose();
		const model = this.editor.getModel();
		this.at = model && this.editor.getOption(EditorOption.inDiffEditor) ? this.reviews.reviewedAt(model.uri) : undefined;
		this.drawNotes();
		if (!this.at) {
			return;
		}
		this.modelListeners.add(this.editor.onMouseMove(e => {
			const line = e.target.position?.lineNumber;
			this.plus.set(line ? [{ range: new Range(line, 1, line, 1), options: { description: 'cedian-comment-add', linesDecorationsClassName: 'cedian-comment-add codicon codicon-add' } }] : []);
		}));
		this.modelListeners.add(this.editor.onMouseLeave(() => this.plus.clear()));
		this.modelListeners.add(this.editor.onMouseDown(e => {
			if (e.target.type === MouseTargetType.GUTTER_LINE_DECORATIONS && e.target.position && e.target.element?.classList.contains('cedian-comment-add')) {
				this.openBox(e.target.position.lineNumber);
			}
		}));
	}

	private openBox(line: number): void {
		const at = this.at;
		if (!at) {
			return;
		}
		this.box?.dispose();
		const quote = this.editor.getModel()?.getLineContent(line).trim();
		this.box = new CommentBox(this.editor, line, (text, send) => {
			const comments = this.reviews.notes(at.thread)?.comments ?? [];
			const more = addComment(comments, { path: at.path, line, text, ...(quote ? { quote } : {}) });
			if (more !== comments) {
				this.daemon.client.request(setComments(at.thread, more));
			}
			if (send && more.length) {
				this.daemon.client.request(sendComments(at.cwd, at.thread));
			}
		});
		this.box.open();
	}

	/** The comments and open findings under their lines, as view zones. */
	private drawNotes(): void {
		const at = this.at;
		const notes = at ? lineNotes(this.reviews.notes(at.thread), at.path) : [];
		this.editor.changeViewZones(accessor => {
			for (const id of this.zones.splice(0)) {
				accessor.removeZone(id);
			}
			for (const note of notes) {
				const node = $('div');
				node.className = `cedian-line-note ${note.kind}`;
				const text = $('span');
				text.textContent = note.kind === 'comment' ? `Comment: ${note.text}` : `Review: ${note.text}`;
				node.append(text);
				const action = (label: string, run: () => void) => {
					const b = $('button');
					b.textContent = label;
					b.addEventListener('click', run);
					node.append(b);
				};
				if (note.kind === 'comment') {
					action('Delete', () => {
						const comments = this.reviews.notes(at!.thread)?.comments ?? [];
						this.daemon.client.request(setComments(at!.thread, comments.filter(c => c.id !== note.id)));
					});
				} else {
					action('Fix this one', () => this.daemon.client.request({ op: 'fix_findings', cwd: at!.cwd, thread: at!.thread, findings: [note.id] }));
					action('Dismiss', () => this.daemon.client.request({ op: 'dismiss', thread: at!.thread, finding: note.id, dismissed: true }));
				}
				const zone: IViewZone = { afterLineNumber: note.line, heightInLines: 1 + Math.floor(note.text.length / 100), domNode: node };
				this.zones.push(accessor.addZone(zone));
			}
		});
	}

	override dispose(): void {
		this.box?.dispose();
		this.editor.changeViewZones(accessor => this.zones.splice(0).forEach(id => accessor.removeZone(id)));
		super.dispose();
	}
}

registerEditorContribution(CedianLineComments.ID, CedianLineComments, EditorContributionInstantiation.AfterFirstRender);
