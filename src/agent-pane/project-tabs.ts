// The project tabs in the title bar (the prototype's .ptab row): the project open in this window and
// the ones opened lately, each with how many of its threads need the person and how many are at
// work, so a project that wants something shows from any other.
import type { ThreadInfo } from "../protocol/wire.js";
import { COORDINATOR, coordinatorThread } from "./project-chat.js";
import { groupOf } from "./thread-list.js";

export interface ProjectTab {
  /** The project's folder, which the daemon keys its threads by. */
  root: string;
  name: string;
  /** The project this window shows. */
  on: boolean;
  needs: number;
  working: number;
}

/** How many tabs the title bar holds, this window's project among them. */
export const MAX_TABS = 5;

/** The last part of a folder's path, either separator. */
export function projectName(root: string): string {
  const parts = root.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? root;
}

/** How many of a project's own threads need the person and how many are at work. */
export function counts(threads: readonly ThreadInfo[]): { needs: number; working: number } {
  const coordinator = coordinatorThread([...threads])?.id;
  let needs = 0;
  let working = 0;
  for (const t of threads) {
    // The rows the Threads list shows (threadSections): no project chat, sub-thread or archived one.
    if (t.archived || t.parent || t.id === coordinator || t.profile === COORDINATOR) continue;
    const g = groupOf(t);
    if (g === "needs") needs++;
    else if (g === "working") working++;
  }
  return { needs, working };
}

/**
 * The tabs: this window's project first, then the folders opened lately, newest first, each once,
 * up to MAX_TABS. A project whose threads the daemon has not sent yet counts none.
 */
export function projectTabs(current: string, recent: readonly string[], threads: ReadonlyMap<string, readonly ThreadInfo[]>): ProjectTab[] {
  const roots = [current, ...recent.filter((r) => r !== current)].filter((r, i, all) => all.indexOf(r) === i).slice(0, MAX_TABS);
  return roots.map((root) => ({ root, name: projectName(root), on: root === current, ...counts(threads.get(root) ?? []) }));
}
