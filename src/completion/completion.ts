// Tab completion, ghost text in a text editor (spec G4, Phase D): after a pause in typing, the
// buffer and the cursor go to cedia (`cedia complete`, through the daemon's `complete`), and the
// text that comes back shows after the cursor; Tab takes it. A newer ask stops the one before, in
// the daemon, so only the latest answer arrives.
import type { Completion, Request } from "../protocol/wire.js";
import { relativeTo } from "../inline-edit/inline-edit.js";

/** How long the editor waits after the last keystroke before it asks. */
export const DEBOUNCE_MS = 250;

/** Whether to ask at this cursor: not in the middle of a word, where the person is still typing it. */
export function shouldAsk(lineText: string, column: number): boolean {
  return !/^[\p{L}\p{N}_$]/u.test(lineText.slice(column - 1));
}

/** The request for the cursor; the buffer's text goes with it, unsaved changes included. */
export function completionRequest(opts: { id: string; cwd: string; file: string; line: number; column: number; text: string; model?: string }): Request | undefined {
  const file = relativeTo(opts.cwd, opts.file);
  if (!file) return undefined;
  return { op: "complete", id: opts.id, cwd: opts.cwd, file, at: { line: opts.line, column: opts.column }, text: opts.text, ...(opts.model ? { model: opts.model } : {}) };
}

/**
 * The editor's item for cedia's answer on the cursor's line: the line up to the cursor with the
 * text after it, replacing the line from its start to the cursor (VS Code shows what the item
 * adds as ghost text). A multi-line answer needs the rest of the line empty, since an item that
 * breaks the line must reach its end; otherwise only its first line is offered.
 */
export function inlineItem(lineText: string, column: number, completion: Completion): { insertText: string; startColumn: number; endColumn: number } | undefined {
  if ("error" in completion) return undefined;
  const before = lineText.slice(0, column - 1);
  const after = lineText.slice(column - 1);
  let text = completion.text;
  if (text.includes("\n") && after !== "") text = text.slice(0, text.indexOf("\n"));
  if (!text.trim()) return undefined;
  return { insertText: before + text, startColumn: 1, endColumn: column };
}
