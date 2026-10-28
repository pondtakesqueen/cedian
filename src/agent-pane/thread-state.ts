// What a window holds of the open thread, built only from the daemon's notices: its blocks (the
// fold's), the thread's row from the list, its status and review. A viewer: the daemon sends
// it all again on open or reconnect, so nothing here is ever the only copy.
import type { Notice, Review, Status, ThreadInfo } from "../protocol/wire.js";
import type { Block } from "./block.js";
import { applyBlocks, emptyView, type BlocksNotice, type ThreadView } from "./view.js";

export interface ThreadState {
  cwd: string;
  /** None until the first prompt opens one (`Notice::Started`). */
  thread?: string;
  view: ThreadView;
  info?: ThreadInfo;
  status?: Status;
  review?: Review;
  /** The history is all here; what follows is live. */
  caught: boolean;
  /** The latest error the daemon sent, shown inline until the next send. */
  error?: string;
  /** A step before the run starts, such as creating the worktree. */
  preparing?: string;
}

export function openState(cwd: string, thread?: string): ThreadState {
  return { cwd, ...(thread ? { thread } : {}), view: emptyView(thread ?? ""), caught: thread === undefined };
}

/** The state after one notice. Notices for other threads leave it as it was. */
export function reduce(state: ThreadState, notice: Notice): ThreadState {
  switch (notice.kind) {
    case "started":
    case "forked":
      if (notice.cwd !== state.cwd || (state.thread !== undefined && notice.kind === "started")) return state;
      return { ...openState(state.cwd, notice.thread), caught: false };
    case "preparing":
      return notice.cwd === state.cwd && state.thread === undefined ? { ...state, preparing: notice.step } : state;
    case "blocks":
      if (notice.thread !== state.thread) return state;
      return { ...state, view: applyBlocks(state.view, notice as unknown as BlocksNotice), preparing: undefined };
    case "caught":
      return notice.thread === state.thread ? { ...state, caught: true } : state;
    case "status":
      return notice.thread === state.thread ? { ...state, status: notice.status } : state;
    case "review":
      return notice.thread === state.thread ? { ...state, review: notice.review } : state;
    case "threads": {
      if (notice.cwd !== state.cwd || state.thread === undefined) return state;
      const info = notice.threads.find((t) => t.id === state.thread);
      return info ? { ...state, info, status: info.status } : state;
    }
    case "error":
      return { ...state, error: notice.message };
    default:
      return state;
  }
}

export const isRunning = (state: ThreadState) => state.status === "working" || state.status === "queued";

/** The session's model the header names: the latest session block's. */
export function currentModel(blocks: Block[]): string | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!;
    if (block.kind === "session") return block.model;
  }
  return undefined;
}

/** The thread's queue, oldest first: its messages no session has been shown yet. */
export function queued(info: ThreadInfo | undefined): { id: string; text: string }[] {
  if (!info) return [];
  const waiting = new Set(info.pending);
  return info.messages.filter((m) => waiting.has(m.id) && m.from === "user").map((m) => ({ id: m.id, text: m.text }));
}
