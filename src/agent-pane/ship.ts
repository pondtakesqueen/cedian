// The receipt card's Commit and open-PR steps (spec §3.1 Git actions): cedia drafts and makes
// the commit (`cedia commit`) and pushes and opens the pull request (`cedia pr`); the window only
// shows each step and asks before the one that cannot be taken back. Each step is a state, so
// the card draws from it and the person's next click is the only thing that moves it on.
import type { Notice, Request } from "../protocol/wire.js";

export type CommitStep =
  | { step: "idle" }
  | { step: "drafting" }
  | { step: "draft"; message: string; files: string[]; chosen: string[]; branch?: string }
  | { step: "committing"; message: string; files: string[] }
  | { step: "committed"; commit: string; subject: string }
  | { step: "failed"; error: string };

export type PrStep =
  | { step: "idle" }
  | { step: "checking" }
  /** Where it would go; the person says yes before anything is pushed. */
  | { step: "plan"; branch: string; base?: string }
  | { step: "blocked"; reason: string }
  | { step: "opening" }
  | { step: "opened"; url?: string; branch: string; base?: string }
  | { step: "failed"; error: string };

export interface Ship {
  commit: CommitStep;
  pr: PrStep;
}

export const idleShip = (): Ship => ({ commit: { step: "idle" }, pr: { step: "idle" } });

/** "Commit": ask cedia for a draft of the thread's files. Nothing is committed yet. */
export function startCommit(ship: Ship, cwd: string, thread: string): { ship: Ship; request: Request } {
  return { ship: { ...ship, commit: { step: "drafting" } }, request: { op: "commit_draft", cwd, thread } };
}

/** The person's edits to the draft: the message, and which files go in. */
export function editDraft(ship: Ship, change: { message?: string; chosen?: string[] }): Ship {
  if (ship.commit.step !== "draft") return ship;
  return { ...ship, commit: { ...ship.commit, ...change } };
}

/** "Commit" on the draft: the files the person kept, with their message. */
export function confirmCommit(ship: Ship, cwd: string, thread: string): { ship: Ship; request?: Request } {
  const c = ship.commit;
  if (c.step !== "draft" || c.message.trim() === "" || c.chosen.length === 0) return { ship };
  return {
    ship: { ...ship, commit: { step: "committing", message: c.message, files: c.chosen } },
    request: { op: "commit", cwd, thread, message: c.message.trim(), files: c.chosen },
  };
}

/** "เปิด PR": where it would go, or why it cannot. Nothing is pushed yet. */
export function startPr(ship: Ship, cwd: string, thread: string): { ship: Ship; request: Request } {
  return { ship: { ...ship, pr: { step: "checking" } }, request: { op: "pr_check", cwd, thread } };
}

/** Yes to the plan: push and open it. */
export function confirmPr(ship: Ship, cwd: string, thread: string): { ship: Ship; request?: Request } {
  if (ship.pr.step !== "plan") return { ship };
  return { ship: { ...ship, pr: { step: "opening" } }, request: { op: "pr", cwd, thread } };
}

export function cancel(ship: Ship, which: keyof Ship): Ship {
  return { ...ship, [which]: { step: "idle" } };
}

/** The daemon's answers move the steps on; notices for other threads change nothing. */
export function shipNotice(ship: Ship, thread: string, notice: Notice): Ship {
  switch (notice.kind) {
    case "commit_draft": {
      if (notice.thread !== thread || ship.commit.step !== "drafting") return ship;
      const d = notice.draft;
      if ("error" in d) return { ...ship, commit: { step: "failed", error: d.error } };
      return { ...ship, commit: { step: "draft", message: d.message, files: d.files, chosen: d.files, ...(d.branch ? { branch: d.branch } : {}) } };
    }
    case "committed": {
      if (notice.thread !== thread || ship.commit.step !== "committing") return ship;
      const r = notice.result;
      return { ...ship, commit: "error" in r ? { step: "failed", error: r.error } : { step: "committed", commit: r.commit, subject: r.subject } };
    }
    case "pr_plan": {
      if (notice.thread !== thread || ship.pr.step !== "checking") return ship;
      const p = notice.plan;
      if (p.blocked) return { ...ship, pr: { step: "blocked", reason: p.blocked } };
      if (!p.branch) return { ...ship, pr: { step: "blocked", reason: "ไม่รู้ว่าอยู่บน branch ไหน" } };
      return { ...ship, pr: { step: "plan", branch: p.branch, ...(p.base ? { base: p.base } : {}) } };
    }
    case "pr_opened": {
      if (notice.thread !== thread || ship.pr.step !== "opening") return ship;
      const r = notice.result;
      if ("error" in r) return { ...ship, pr: { step: "failed", error: r.error } };
      return { ...ship, pr: { step: "opened", branch: r.branch, ...(r.url ? { url: r.url } : {}), ...(r.base ? { base: r.base } : {}) } };
    }
    default:
      return ship;
  }
}
