/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import type { AgentPane } from './agent-pane/pane.js';

/** The agent pane the keybinding layer acts on: the one drawn in this window. */
export const CedianPanes = new class {
	current: AgentPane | undefined;
};
