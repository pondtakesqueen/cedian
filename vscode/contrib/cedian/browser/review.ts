/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModelContentProvider, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import type { FileReview, Review } from './protocol/wire.js';
import { hunkLine, originalText } from './review/original.js';

export const ICedianReviewService = createDecorator<ICedianReviewService>('cedianReviewService');

/** Opens a thread's review in VS Code's diff editor (spec §11 Phase B: review via the diff editor + cedian_review). */
export interface ICedianReviewService {
	readonly _serviceBrand: undefined;
	open(thread: string, cwd: string, review: Review, file?: string): Promise<void>;
}

/** The left side of a reviewed file: the file with the thread's hunks undone. */
const ORIGINAL_SCHEME = 'cedian-original';

class CedianReviewService extends Disposable implements ICedianReviewService, ITextModelContentProvider {
	declare readonly _serviceBrand: undefined;

	/** The latest review per thread; the left sides are rebuilt from it. */
	private readonly reviews = new Map<string, { cwd: string; review: Review }>();

	constructor(
		@ITextModelService textModelService: ITextModelService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IFileService private readonly fileService: IFileService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super();
		this._register(textModelService.registerTextModelContentProvider(ORIGINAL_SCHEME, this));
	}

	async open(thread: string, cwd: string, review: Review, file?: string): Promise<void> {
		this.reviews.set(thread, { cwd, review });
		// A left side already open follows the review as it is now.
		for (const model of this.modelService.getModels()) {
			if (model.uri.scheme === ORIGINAL_SCHEME && model.uri.query === thread) {
				const text = await this.original(model.uri);
				if (text !== undefined && text !== model.getValue()) {
					model.setValue(text);
				}
			}
		}
		const files = review.files.filter(f => !f.binary && (!file || f.path === file));
		if (files.length === 0) {
			return;
		}
		const sides = (f: FileReview) => {
			const modified = joinPath(URI.file(cwd), f.path);
			return { original: { resource: this.originalUri(thread, cwd, f.path) }, modified: { resource: modified } };
		};
		if (file) {
			const f = files[0];
			const first = f.hunks[0];
			await this.editorService.openEditor({
				...sides(f),
				label: `${f.path} (รีวิว)`,
				options: first ? { selection: { startLineNumber: hunkLine(first), startColumn: 1 }, pinned: true } : { pinned: true },
			});
			return;
		}
		await this.editorService.openEditor({
			multiDiffSource: URI.from({ scheme: 'cedian-review', path: `/${thread}` }),
			resources: files.map(sides),
			label: `รีวิว ${files.length} ไฟล์`,
			isTransient: true,
		});
	}

	private originalUri(thread: string, cwd: string, path: string): URI {
		return URI.from({ scheme: ORIGINAL_SCHEME, path: joinPath(URI.file(cwd), path).path, query: thread });
	}

	private async original(resource: URI): Promise<string | undefined> {
		const held = this.reviews.get(resource.query);
		if (!held) {
			return undefined;
		}
		const file = held.review.files.find(f => joinPath(URI.file(held.cwd), f.path).path === resource.path);
		if (!file) {
			return undefined;
		}
		let modified = '';
		try {
			modified = (await this.fileService.readFile(URI.file(resource.path))).value.toString();
		} catch {
			// The thread deleted the file: the left side is the hunks' old lines alone.
		}
		return originalText(modified, file).text;
	}

	async provideTextContent(resource: URI): Promise<ITextModel | null> {
		const text = await this.original(resource);
		if (text === undefined) {
			return null;
		}
		const existing = this.modelService.getModel(resource);
		if (existing) {
			existing.setValue(text);
			return existing;
		}
		const language = this.languageService.createByFilepathOrFirstLine(URI.file(resource.path));
		return this.modelService.createModel(text, language, resource);
	}
}

registerSingleton(ICedianReviewService, CedianReviewService, InstantiationType.Delayed);
