// The project chat (spec §11 phase C, ARCHITECTURE "The person does not start threads"): a
// conversation with the project's coordinator, a cedia thread whose profile is `coordinator`,
// which opens a thread per piece of work with `open_thread`. The chat shows a card for each
// thread it opened: its state, its progress from the todo list, and its question when it asks.
import type { Status, ThreadInfo } from "../protocol/wire.js";
import { type Completion, score } from "../composer/complete.js";
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
  /** Archived, by the daemon once nothing was owed on it or by the person: a finished card. */
  archived?: boolean;
}

// A question first, then work going on, then what is finished.
const ORDER: Partial<Record<Status, number>> = { asking: 0, working: 1, queued: 2, failed: 3, interrupted: 3, stopped: 4, done: 5 };

/**
 * One card per thread the coordinator opened, the ones that need the person first. An archived
 * thread keeps its card, last, as a finished one (ARCHITECTURE "Auto-archive when nothing is
 * owed").
 */
export function chatCards(threads: ThreadInfo[], coordinator: string): ChatCard[] {
  return threads
    .filter((t) => t.by === coordinator)
    .sort((a, b) => Number(a.archived) - Number(b.archived) || (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || b.updated_at.localeCompare(a.updated_at))
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
        ...(t.archived ? { archived: true } : {}),
      };
    });
}

/**
 * `@<thread> text` at the start of a chat message (ARCHITECTURE "`@` sends a message straight to
 * one thread"): the text goes to that thread, one the coordinator opened, and not to the
 * coordinator. None when the message names no such thread.
 */
export function addressed(text: string, threads: ThreadInfo[], coordinator: string): { thread: ThreadInfo; text: string } | undefined {
  const m = /^@(\S+)(?:\s+([\s\S]*))?$/.exec(text.trimStart());
  if (!m) return undefined;
  const thread = threads.find((t) => t.id === m[1] && t.by === coordinator && !t.archived);
  return thread ? { thread, text: (m[2] ?? "").trim() } : undefined;
}

/** The chat's `@` at the start of a message: the coordinator's threads, by title or id. */
export function threadCompletions(query: string, cards: ChatCard[], limit = 8): Completion[] {
  return cards
    .filter((c) => !c.archived)
    .map((c) => ({ c, s: Math.max(score(query, c.title) ?? -1, score(query, c.id) ?? -1) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ c }) => ({ label: c.title, detail: c.id, insert: `@${c.id} ` }));
}
