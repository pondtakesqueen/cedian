// The composer's rules (prototype `composer()`; spec §3.1, §3.7): what Enter does depends on the
// thread. No thread yet starts one (in a new worktree when asked); a thread at rest takes the
// text as its next run; a running thread queues it, and cedia shows it at the run's next turn
// (`cedia threads send`) until "ส่งเลย" stops the run and sends it as the next one instead.
import type { CommandEntry, Request } from "../protocol/wire.js";

export interface Draft {
  text: string;
  /** Image files (or `sha256:<hex>` for one cedia stored) shown with the text. */
  images: string[];
}

/** What the composer is pointed at. */
export interface Target {
  cwd: string;
  /** None: the next send opens a new thread. */
  thread?: string;
  /** The thread has a run going. */
  running: boolean;
}

/** The run's choices from the chips: the model, the permission mode, the effort. */
export interface RunChoices {
  model?: string;
  permission?: string;
  effort?: string;
  /** For a new thread: run it in a new worktree. */
  worktree: boolean;
}

export const emptyDraft = (): Draft => ({ text: "", images: [] });

/** Nothing to send: no text and no image. */
export const isEmpty = (draft: Draft) => draft.text.trim() === "" && draft.images.length === 0;

/**
 * The requests Enter sends, in order. A running thread gets a message (queued, cedia shows it at
 * the next turn); otherwise a run. An empty draft sends nothing.
 */
export function submit(draft: Draft, target: Target, choices: RunChoices): Request[] {
  if (isEmpty(draft)) return [];
  const text = draft.text.trim();
  if (target.thread !== undefined && target.running) {
    return [{ op: "send", cwd: target.cwd, thread: target.thread, text, ...(draft.images.length ? { images: draft.images } : {}) }];
  }
  return [
    {
      op: "prompt",
      cwd: target.cwd,
      text,
      thread: target.thread ?? null,
      worktree: target.thread === undefined && choices.worktree,
      ...(choices.model ? { model: choices.model } : {}),
      ...(choices.permission ? { permission: choices.permission } : {}),
      ...(choices.effort ? { effort: choices.effort } : {}),
      ...(draft.images.length ? { images: draft.images } : {}),
    },
  ];
}

/** A message waiting in the thread's queue (`ThreadInfo.pending` with its text). */
export interface Queued {
  id: string;
  text: string;
}

/**
 * "ส่งเลย" on a queued message: take it back from the queue, stop the run, and send it as the
 * next run once the run has stopped (the caller sends `then` when the thread's status leaves
 * `working`).
 */
export function sendNow(queued: Queued, target: Required<Pick<Target, "cwd" | "thread">>, choices: RunChoices): { now: Request[]; then: Request } {
  return {
    now: [
      { op: "unsend", cwd: target.cwd, thread: target.thread, ids: [queued.id] },
      { op: "stop", thread: target.thread },
    ],
    then: submit({ text: queued.text, images: [] }, { ...target, running: false }, choices)[0]!,
  };
}

/** "แก้" on a queued message: take it back, and put its text in the draft. */
export function editQueued(queued: Queued, target: Required<Pick<Target, "cwd" | "thread">>): { request: Request; draft: Draft } {
  return { request: { op: "unsend", cwd: target.cwd, thread: target.thread, ids: [queued.id] }, draft: { text: queued.text, images: [] } };
}

/** "×" on a queued message. */
export function dropQueued(queued: Queued, target: Required<Pick<Target, "cwd" | "thread">>): Request {
  return { op: "unsend", cwd: target.cwd, thread: target.thread, ids: [queued.id] };
}

export type { CommandEntry };
