// The git pane in the thread (spec §11 Phase D, as the prototype draws it): a branch chip in the
// composer and, from it, the Git card: the branch against its base and upstream, and Pull and
// Push. The daemon reads and runs git (`Request::Git`, `Request::GitAction`); VS Code's Source
// Control, which follows the open thread, stays for everything else.
import type { GitAction, GitState } from "../protocol/wire.js";

/** `fix-login → origin/main · ahead 2 · behind 1`, or just the branch when there is no base. */
export function branchLine(s: GitState): string {
  const branch = s.branch ?? "detached HEAD";
  if (!s.base) return branch;
  const apart = [s.ahead ? `ahead ${s.ahead}` : "", s.behind ? `behind ${s.behind}` : ""].filter(Boolean);
  return `${branch} → ${s.base}${apart.length ? ` · ${apart.join(" · ")}` : " · up to date"}`;
}

/** What is not committed or not pushed yet, if anything. */
export function pendingLine(s: GitState): string {
  const parts = [
    s.changed ? `${s.changed} uncommitted ${s.changed === 1 ? "file" : "files"}` : "",
    s.branch && s.unpushed ? `${s.unpushed} not pushed` : "",
    s.upstream && s.unpulled ? `${s.unpulled} to pull from ${s.upstream}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

/** The menu's actions that would do something now. */
export function gitActions(s: GitState): GitAction[] {
  const out: GitAction[] = [];
  if (s.behind > 0 || (s.upstream && s.branch)) out.push("pull");
  if (s.branch && s.base && (s.unpushed > 0 || !s.upstream)) out.push("push");
  return out;
}

export const ACTION_LABEL: Record<GitAction, string> = { pull: "Pull", push: "Push" };
export const ACTION_BUSY: Record<GitAction, string> = { pull: "Pulling…", push: "Pushing…" };
