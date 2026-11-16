// What the person leaves on a thread's diff (spec §3.7, diff comments + review card): line
// comments and the `/code-review` card's findings. The daemon keeps them (`Notice::Notes`); these
// are the pure rules the pane and the diff editor draw them by.
import type { CodeFinding, CodeReview, CommentState, LineComment, Notes, Request } from "../protocol/wire.js";

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

/** Lines of context kept on each side of a commented line (the daemon's `anchor::CONTEXT`). */
const CONTEXT = 3;

/**
 * The anchor of line `line` (from 1) of `lines`, as the daemon takes it again after each run: the
 * line's trimmed text and up to three trimmed lines above (nearest last) and below (nearest first).
 * The daemon finds the comment by it once the agent's edits move the line (spec §3.8).
 */
export function anchorAt(lines: readonly string[], line: number): Pick<LineComment, "quote" | "before" | "after"> {
  const at = Math.min(Math.max(line - 1, 0), lines.length);
  const quote = lines[at]?.trim();
  return {
    ...(quote ? { quote } : {}),
    before: lines.slice(Math.max(at - CONTEXT, 0), at).map((l) => l.trim()),
    after: lines.slice(at + 1, at + 1 + CONTEXT).map((l) => l.trim()),
  };
}

/** The comments with one more at `path:line`. Empty text adds nothing. */
export function addComment(comments: LineComment[], comment: Omit<LineComment, "id">, id = `c-${Date.now().toString(36)}-${(next++).toString(36)}`): LineComment[] {
  if (!comment.text.trim()) return comments;
  return [...comments, { ...comment, id, text: comment.text.trim() }];
}

export const removeComment = (comments: LineComment[], id: string): LineComment[] => comments.filter((c) => c.id !== id);

/** A comment's state; a comment from before states is a draft. */
export const stateOf = (comment: LineComment): CommentState => comment.state ?? "draft";

/** Whether the next batch carries it: drafts, and ones a run left open. */
export const goesNext = (comment: LineComment): boolean => stateOf(comment) === "draft" || stateOf(comment) === "open";

/** The comments with one resolved (collapsed, not sent again) or opened again. */
export function resolveComment(comments: LineComment[], id: string, resolved: boolean): LineComment[] {
  return comments.map((c) => (c.id === id ? { ...c, state: resolved ? "resolved" : "open" } : c));
}

/** What a comment's state says beside it. */
export function stateLabel(comment: LineComment): string {
  switch (stateOf(comment)) {
    case "draft":
      return "Not sent";
    case "sent":
      return "Sent";
    case "open":
      return "Still open";
    case "resolved":
      return "Resolved";
  }
}

/** The count line on the comments card: `2 to send · 1 sent · 3 resolved`. */
export function commentCount(comments: LineComment[]): string {
  const count = (state: CommentState) => comments.filter((c) => stateOf(c) === state).length;
  const toSend = comments.filter(goesNext).length;
  const parts = [toSend ? `${toSend} to send` : "", count("sent") ? `${count("sent")} sent` : "", count("resolved") ? `${count("resolved")} resolved` : ""].filter(Boolean);
  return parts.join(" · ") || "No comments";
}

/** The requests that change the thread's comments, or send them (Cmd+Enter). */
export const setComments = (thread: string, comments: LineComment[]): Request => ({ op: "comments", thread, comments });
export const sendComments = (cwd: string, thread: string): Request => ({ op: "send_comments", cwd, thread });

/** What the diff shows under one line of a file: a comment, with its state, or an open finding. */
export type LineNote = { kind: "comment"; id: string; line: number; text: string; state: CommentState } | { kind: "finding"; id: string; line: number; text: string };

/** The notes under the lines of `path`, by line, comments before findings on the same line. */
export function lineNotes(notes: Notes | undefined, path: string): LineNote[] {
  const comments: LineNote[] = (notes?.comments ?? []).filter((c) => c.path === path).map((c) => ({ kind: "comment", id: c.id, line: c.line, text: c.text, state: stateOf(c) }));
  const findings: LineNote[] = walkSteps(notes)
    .filter((f) => f.path === path || path.endsWith(`/${f.path}`))
    .map((f) => ({ kind: "finding", id: f.id, line: f.line, text: f.text }));
  return [...comments, ...findings].sort((a, b) => a.line - b.line || (a.kind === b.kind ? 0 : a.kind === "comment" ? -1 : 1));
}
