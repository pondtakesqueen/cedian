/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { Parts } from '../../../services/layout/browser/layoutService.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';

/** The side blocks (Threads, the right panel, the bottom panel), which make room for each other and for the editor's blocks. */
export const SIDE_PARTS: readonly Parts[] = [Parts.SIDEBAR_PART, Parts.AUXILIARYBAR_PART, Parts.PANEL_PART];

/** A group's element, which IEditorGroup does not say it has. */
export function groupElement(group: IEditorGroup): HTMLElement | undefined {
	const element = (group as IEditorGroup & { element?: unknown }).element;
	return element instanceof HTMLElement ? element : undefined;
}
