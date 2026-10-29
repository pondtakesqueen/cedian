// What the person leaves on a thread's diff (spec §3.7, diff comments + review card): line
// comments and the `/code-review` card's findings. The daemon keeps them (`Notice::Notes`); these
// are the pure rules the pane and the diff editor draw them by.
import type { CodeFinding, CodeReview, LineComment, Notes, Request } from "../protocol/wire.js";

/** A review that came back, or undefined for one that failed or never ran. */
export function reviewed(notes: Notes | undefined): Extract<CodeReview, { findings: unknown }> | undefined {
  const review = notes?.review;
  return review && "findings" in review ? review : undefined;
}

export interface FindingRow {
  finding: CodeFinding;
  dismissed: boolean;
}

/** The findings by file, files in the order the reviewer first named them; findings that name no file go last. */
export function byFile(notes: Notes | undefined): { path?: string; rows: FindingRow[] }[] {
  const review = reviewed(notes);
  if (!review) return [];
  const dismissed = new Set(notes?.dismissed ?? []);
  const groups = new Map<string | undefined, FindingRow[]>();
  for (const finding of review.findings) {
    const key = finding.path ?? undefined;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ finding, dismissed: dismissed.has(finding.id) });
  }
  const files = [...groups].filter(([path]) => path !== undefined);
  const loose = groups.get(undefined);
  return [...files.map(([path, rows]) => ({ path, rows })), ...(loose ? [{ rows: loose }] : [])];
}

/** The open findings, in the reviewer's order. */
export function openFindings(notes: Notes | undefined): CodeFinding[] {
  const dismissed = new Set(notes?.dismissed ?? []);
  return reviewed(notes)?.findings.filter((f) => !dismissed.has(f.id)) ?? [];
}

/** The steps Walk through goes through in the diff: the open findings that name a file and a line. */
export function walkSteps(notes: Notes | undefined): (CodeFinding & { path: string; line: number })[] {
  return openFindings(notes).filter((f): f is CodeFinding & { path: string; line: number } => typeof f.path === "string" && typeof f.line === "number");
}

/** The count line on the card: `2 findings · 1 skipped`. */
export function findingCount(notes: Notes | undefined): string {
  const review = reviewed(notes);
  if (!review) return "";
  const skipped = review.findings.length - openFindings(notes).length;
  return review.findings.length === 0 ? "No findings" : `${review.findings.length} ${review.findings.length === 1 ? "finding" : "findings"}${skipped ? ` · ${skipped} skipped` : ""}`;
}

let next = 0;

/** The comments with one more at `path:line`. Empty text adds nothing. */
export function addComment(comments: LineComment[], comment: Omit<LineComment, "id">, id = `c-${Date.now().toString(36)}-${(next++).toString(36)}`): LineComment[] {
  if (!comment.text.trim()) return comments;
  return [...comments, { ...comment, id, text: comment.text.trim() }];
}

export const removeComment = (comments: LineComment[], id: string): LineComment[] => comments.filter((c) => c.id !== id);

/** The requests that change the thread's comments, or send them (Cmd+Enter). */
export const setComments = (thread: string, comments: LineComment[]): Request => ({ op: "comments", thread, comments });
export const sendComments = (cwd: string, thread: string): Request => ({ op: "send_comments", cwd, thread });

/** What the diff shows under one line of a file: a comment waiting to go, or an open finding. */
export type LineNote = { kind: "comment"; id: string; line: number; text: string } | { kind: "finding"; id: string; line: number; text: string };

/** The notes under the lines of `path`, by line, comments before findings on the same line. */
export function lineNotes(notes: Notes | undefined, path: string): LineNote[] {
  const comments: LineNote[] = (notes?.comments ?? []).filter((c) => c.path === path).map((c) => ({ kind: "comment", id: c.id, line: c.line, text: c.text }));
  const findings: LineNote[] = walkSteps(notes)
    .filter((f) => f.path === path || path.endsWith(`/${f.path}`))
    .map((f) => ({ kind: "finding", id: f.id, line: f.line, text: f.text }));
  return [...comments, ...findings].sort((a, b) => a.line - b.line || (a.kind === b.kind ? 0 : a.kind === "comment" ? -1 : 1));
}
