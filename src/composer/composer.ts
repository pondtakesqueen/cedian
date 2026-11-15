// The composer's rules (prototype `composer()`; spec §3.1, §3.7): what Enter does depends on the
// thread. No thread yet starts one (in a new worktree when asked); a thread at rest takes the
// text as its next run; a running thread is steered: the text is queued (`cedia threads send`)
// and cedia shows it to the model at the run's next step, without stopping the run. "Stop and
// send" is the other way: it stops the run and sends the text as the next one.
import type { CommandEntry, Request, ResumeCost } from "../protocol/wire.js";

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
 * "Stop and send" on a queued message, for when the run should not go on as it is: take it back from the queue, stop the run, and send it as the
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

/** "Edit" on a queued message: take it back, and put its text in the draft. */
export function editQueued(queued: Queued, target: Required<Pick<Target, "cwd" | "thread">>): { request: Request; draft: Draft } {
  return { request: { op: "unsend", cwd: target.cwd, thread: target.thread, ids: [queued.id] }, draft: { text: queued.text, images: [] } };
}

/** "×" on a queued message. */
export function dropQueued(queued: Queued, target: Required<Pick<Target, "cwd" | "thread">>): Request {
  return { op: "unsend", cwd: target.cwd, thread: target.thread, ids: [queued.id] };
}

/**
 * A thread quiet for this long may have lost its prompt cache (cedia's shortest lasts 5 minutes,
 * and it counts a cache as good as gone at 80% of that), so its next prompt is priced first. A
 * thread that answered more recently is sent to at once, with no question and no wait.
 */
export const MAY_BE_COLD_MS = 4 * 60_000;

export const mayBeCold = (updatedAt: string | undefined, now: number): boolean => {
  const at = updatedAt ? Date.parse(updatedAt) : NaN;
  return Number.isNaN(at) || now - at >= MAY_BE_COLD_MS;
};

const idle = (ms: number): string => (ms >= 3_600_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.max(1, Math.round(ms / 60_000))} min`);
const k = (tokens: number): string => `${Math.round(tokens / 1000)}k`;

/** The cold-cache question's two lines: where the thread stands, and what each answer costs. */
export function coldLines(cost: ResumeCost): { state: string; whole: string; fresh: string } {
  return {
    state: `Idle ${idle(cost.idleMs)}, cache ${cost.cold ? "expired" : "about to expire"}`,
    whole: `Whole context: re-reads ${k(cost.contextTokens)} tokens, about $${cost.resumeUsd.toFixed(2)}`,
    fresh: `New session from where it stopped: about ${k(cost.freshTokens)}, $${cost.freshUsd.toFixed(2)}`,
  };
}

/** The held prompt with the person's answer: `fresh` or `keep` (cedia's `--cold-resume`). */
export const withColdResume = (request: Request, answer: "fresh" | "keep"): Request => (request.op === "prompt" ? { ...request, cold_resume: answer } : request);

export type { CommandEntry };
