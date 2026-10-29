// Inline edit, Cmd+K in a text editor (spec §11 Phase B): the selection and the person's
// instruction go to cedia (`cedia inline-edit`, through the daemon's `inline_edit`), and the
// replacement comes back as a diff in the editor that the person accepts or discards. Nothing is
// written until they accept, and then only the editor's buffer changes.
import type { InlineEdit, Request } from "../protocol/wire.js";

/** An editor's selection: lines and columns from 1, columns in UTF-16 code units. */
export interface EditorSelection {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** The path of `file` under `cwd`, or nothing when it is outside it. */
export function relativeTo(cwd: string, file: string): string | undefined {
  const base = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return file.startsWith(base) ? file.slice(base.length) : undefined;
}

/** The request for one selection; the buffer's text goes with it, unsaved changes included. */
export function inlineEditRequest(opts: { id: string; cwd: string; file: string; selection: EditorSelection; instruction: string; text: string; model?: string }): Request | { error: string } {
  const file = relativeTo(opts.cwd, opts.file);
  if (!file) return { error: `${opts.file} is outside the project (${opts.cwd})` };
  const instruction = opts.instruction.trim();
  if (!instruction) return { error: "Say what to change first" };
  const s = opts.selection;
  return {
    op: "inline_edit",
    id: opts.id,
    cwd: opts.cwd,
    file,
    range: { start: { line: s.startLineNumber, column: s.startColumn }, end: { line: s.endLineNumber, column: s.endColumn } },
    instruction,
    text: opts.text,
    ...(opts.model ? { model: opts.model } : {}),
  };
}

/** The buffer with the replacement in place of the selection, for the diff's right side. */
export function proposedText(text: string, selection: EditorSelection, replacement: string): string {
  const lines = text.split("\n");
  const offset = (line: number, column: number) => {
    let at = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) at += lines[i]!.length + 1;
    return at + column - 1;
  };
  const from = offset(selection.startLineNumber, selection.startColumn);
  const to = offset(selection.endLineNumber, selection.endColumn);
  return text.slice(0, from) + replacement + text.slice(to);
}

/** What the editor shows for cedia's answer. */
export function outcome(edit: InlineEdit): { replacement: string; costUsd: number; model: string } | { error: string } {
  if ("error" in edit) return { error: edit.error };
  if (edit.patch === "") return { error: "Nothing to change" };
  return { replacement: edit.replacement, costUsd: edit.costUsd, model: edit.model };
}
