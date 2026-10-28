// The cards a thread shows beside its blocks: the question it asked (`asking`, cedia's
// `ask_user`) and its todo list (cedia's `todo`, the thread's progress).
import type { Request, Step, ThreadInfo } from "../protocol/wire.js";

export interface AskCard {
  question: string;
  /** Two to four choices, the recommended first; none for a free answer. */
  options: string[];
}

/** The question card while the thread waits in `asking`. */
export function askCard(info: ThreadInfo | undefined): AskCard | undefined {
  if (!info || info.status !== "asking" || !info.question) return undefined;
  return { question: info.question.question, options: info.question.options ?? [] };
}

/** The answer is the thread's next prompt (cedia SPEC, `ask`). */
export function answer(cwd: string, thread: string, text: string, choices: { model?: string; permission?: string; effort?: string } = {}): Request | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  return { op: "prompt", cwd, text: trimmed, thread, worktree: false, ...choices };
}

export interface TodoCard {
  steps: Step[];
  done: number;
  /** `2/5`, as the header and the sidebar say it. */
  progress: string;
}

export function todoCard(info: ThreadInfo | undefined): TodoCard | undefined {
  const steps = info?.todo ?? [];
  if (steps.length === 0) return undefined;
  const done = steps.filter((s) => s.state === "done").length;
  return { steps, done, progress: `${done}/${steps.length}` };
}
