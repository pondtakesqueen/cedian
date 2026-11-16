// The diff editor's two sides for one file of a thread's review (`cedian_review`): the right is
// the file as the thread left it in its worktree, the left is that file with the review's hunks
// undone. Rebuilding the left from the hunks keeps the daemon the only source of the diff; the
// window reads nothing from the shadow snapshots itself.
import type { FileReview, Hunk } from "../protocol/wire.js";

/** `@@ -a,b +c,d @@` → the new side's first line and length (a length of 0 starts after `c`). */
export function newSpan(hunk: Hunk): { start: number; length: number } {
  const m = /\+(\d+)(?:,(\d+))?/.exec(hunk.header);
  const length = m?.[2] === undefined ? 1 : Number(m[2]);
  return { start: Number(m?.[1] ?? hunk.new_start), length };
}

/**
 * The file before the thread changed it, from the file now and its hunks. A hunk whose new side
 * no longer matches the file (it changed since the review) is left as the file has it, and
 * named in `stale`, so the diff shows only what is still true.
 */
export function originalText(modified: string, file: FileReview): { text: string; stale: string[] } {
  const eol = modified.includes("\r\n") ? "\r\n" : "\n";
  const lines = modified.split(/\r?\n/);
  const stale: string[] = [];
  // From the bottom up, so each hunk's line numbers still hold when it is undone.
  const hunks = [...file.hunks].sort((a, b) => newSpan(b).start - newSpan(a).start);
  for (const hunk of hunks) {
    const span = newSpan(hunk);
    const now = hunk.lines.filter((l) => l[0] === " " || l[0] === "+").map((l) => l.slice(1));
    const before = hunk.lines.filter((l) => l[0] === " " || l[0] === "-").map((l) => l.slice(1));
    const at = span.length === 0 ? span.start : span.start - 1;
    const there = lines.slice(at, at + now.length);
    if (there.length !== now.length || there.some((l, i) => l !== now[i])) {
      stale.push(hunk.id);
      continue;
    }
    lines.splice(at, now.length, ...before);
  }
  return { text: lines.join(eol), stale };
}

/** The new side's first line of a hunk, where "open in editor" puts the cursor. */
export const hunkLine = (hunk: Hunk) => Math.max(1, newSpan(hunk).start);

export interface ReviewSummary {
  files: number;
  added: number;
  removed: number;
  pending: number;
  stale: number;
}

export function summarize(files: FileReview[]): ReviewSummary {
  const hunks = files.flatMap((f) => f.hunks);
  return {
    files: files.length,
    added: files.reduce((n, f) => n + f.added, 0),
    removed: files.reduce((n, f) => n + f.removed, 0),
    pending: hunks.filter((h) => h.state === "pending").length,
    stale: hunks.filter((h) => h.state === "stale").length,
  };
}
