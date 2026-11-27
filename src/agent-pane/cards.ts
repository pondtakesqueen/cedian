// The cards a thread shows beside its blocks: the question it asked (`asking`, cedia's
// `ask_user`) and its todo list (cedia's `todo`, the thread's progress).
import type { ProjectAsk, Request, Step, ThreadInfo } from "../protocol/wire.js";

export interface AskCard {
  question: string;
  /** Two to four choices, the recommended first; none for a free answer. */
  options: string[];
  /** cedia's `add_project`: what Allow would do. The card then offers Allow and Deny only. */
  request?: ProjectAsk;
}

/** The question card while the thread waits in `asking`. */
export function askCard(info: ThreadInfo | undefined): AskCard | undefined {
  if (!info || info.status !== "asking" || !info.question) return undefined;
  const request = info.question.request ?? undefined;
  return { question: info.question.question, options: info.question.options ?? [], ...(request ? { request } : {}) };
}

/** What Allow would change, one line each, for the project card. */
export function projectChanges(r: ProjectAsk): string[] {
  return [
    ...(r.create ? [`Create the folder ${r.path} and run git init in it`] : []),
    `Add ${r.path} to your projects`,
    ...(r.carry ? ["Carry this chat over to it: a new thread there starts from a recap, and this one is archived"] : []),
  ];
}

/** Allow on the project card: the daemon reads the request from the thread file and carries it out. */
export function allowProject(cwd: string, thread: string): Request {
  return { op: "allow_project", cwd, thread };
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
