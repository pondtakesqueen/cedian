// The project chat (spec §11 phase C, ARCHITECTURE "The person does not start threads"): a
// conversation with the project's coordinator, a cedia thread whose profile is `coordinator`,
// which opens a thread per piece of work with `open_thread`. The chat shows a card for each
// thread it opened: its state, its progress from the todo list, and its question when it asks.
import type { Status, ThreadInfo } from "../protocol/wire.js";
import { todoCard } from "./cards.js";

export const COORDINATOR = "coordinator";

/** The project's coordinator thread: the latest one not archived, if the chat has started. */
export function coordinatorThread(threads: ThreadInfo[]): ThreadInfo | undefined {
  return threads
    .filter((t) => t.profile === COORDINATOR && !t.archived)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
}

export interface ChatCard {
  id: string;
  title: string;
  status: Status;
  /** `2/5` from the thread's todo list. */
  progress?: string;
  /** The step it is on. */
  step?: string;
  /** The question it waits on, with its choices, the recommended first. */
  question?: { text: string; options: string[] };
  cwd?: string;
}

// A question first, then work going on, then what is finished.
const ORDER: Partial<Record<Status, number>> = { asking: 0, working: 1, queued: 2, failed: 3, interrupted: 3, stopped: 4, done: 5 };

/** One card per thread the coordinator opened, the ones that need the person first. */
export function chatCards(threads: ThreadInfo[], coordinator: string): ChatCard[] {
  return threads
    .filter((t) => t.by === coordinator && !t.archived)
    .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || b.updated_at.localeCompare(a.updated_at))
    .map((t) => {
      const todo = todoCard(t);
      const step = t.todo?.find((s) => s.state === "doing")?.text;
      return {
        id: t.id,
        title: t.title || t.task,
        status: t.status,
        ...(todo ? { progress: todo.progress } : {}),
        ...(step ? { step } : {}),
        ...(t.status === "asking" && t.question ? { question: { text: t.question.question, options: t.question.options ?? [] } } : {}),
        ...(t.cwd ? { cwd: t.cwd } : {}),
      };
    });
}
