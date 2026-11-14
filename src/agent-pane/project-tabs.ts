// The project tabs in the title bar (the prototype's .ptab row): the projects the person keeps open,
// `desktop.projects` in their order, each with how many of its threads need the person and how many
// are at work, so a project that wants something shows from any other. A folder opened in a window
// joins the list; a tab's × takes it off. VS Code's recently opened list is not used: it held every
// folder any build or test had opened, which is not the person's projects.
import type { Desktop } from "../settings/desktop.js";
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

/** A folder in the system's temporary space (a test run's, an unzipped download): never a project. */
export function isScratch(root: string): boolean {
  return /^(\/private)?\/(var\/folders|tmp)\//.test(root) || /[\\/]AppData[\\/]Local[\\/]Temp[\\/]/i.test(root);
}

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/[\\/]+$/, "") : path);

/** `desktop.projects`: the folders the person keeps as tabs, in their order, each once. */
export function projectsOf(desktop: Desktop): string[] {
  const listed = Array.isArray(desktop.projects) ? desktop.projects : [];
  const roots = listed.filter((r): r is string => typeof r === "string" && r.trim() !== "").map((r) => trimSlash(r.trim()));
  return roots.filter((r, i) => roots.indexOf(r) === i);
}

/** The list with `root` at its end, or `undefined` when it is there already or is a temporary folder. */
export function withProject(projects: readonly string[], root: string): string[] | undefined {
  const r = trimSlash(root);
  return projects.includes(r) || isScratch(r) ? undefined : [...projects, r];
}

/** The list without `root`. */
export function withoutProject(projects: readonly string[], root: string): string[] {
  return projects.filter((r) => r !== trimSlash(root));
}

/**
 * The tabs: the person's projects in their order, with this window's project among them (first,
 * while it is not listed yet). A project whose threads the daemon has not sent yet counts none.
 */
export function projectTabs(current: string, projects: readonly string[], threads: ReadonlyMap<string, readonly ThreadInfo[]>): ProjectTab[] {
  const roots = projects.includes(current) ? projects : [current, ...projects];
  return roots.map((root) => ({ root, name: projectName(root), on: root === current, ...counts(threads.get(root) ?? []) }));
}

/** The tab to show when this window's own tab closes: the one after it, else the one before, else none. */
export function nextAfterClose(tabs: readonly ProjectTab[], root: string): string | undefined {
  const at = tabs.findIndex((t) => t.root === root);
  if (at < 0) return undefined;
  return (tabs[at + 1] ?? tabs[at - 1])?.root;
}

/**
 * The tabs as this window last drew them, read back by the next window to load (a tab switch loads
 * the window again), so the title bar shows its tabs from the first frame, before the daemon
 * answers. This window's own is marked; one it doesn't list goes first. Undefined when the text is
 * not such a list.
 */
export function tabsFromCache(text: string | undefined, current: string): ProjectTab[] | undefined {
  if (!text) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const tabs: ProjectTab[] = [];
  for (const item of parsed) {
    const root = (item as { root?: unknown } | null)?.root;
    if (typeof root !== "string" || !root || tabs.some((t) => t.root === root)) continue;
    const { needs, working } = item as { needs?: unknown; working?: unknown };
    tabs.push({ root, name: projectName(root), on: root === current, needs: count(needs), working: count(working) });
  }
  if (!tabs.some((t) => t.on)) tabs.unshift({ root: current, name: projectName(current), on: true, needs: 0, working: 0 });
  return tabs;
}

/** What tabsFromCache reads: each tab's folder and counts. */
export const cacheText = (tabs: readonly ProjectTab[]): string => JSON.stringify(tabs.map(({ root, needs, working }) => ({ root, needs, working })));

/**
 * How many projects keep a window open, so switching to them shows the window at once (as a
 * browser shows a tab it keeps) instead of loading it again: the shown one and the two used before
 * it (owner, 2026-11-14). A project past them loads when it is picked, and its window closes again
 * once three newer ones are open.
 */
export const WARM_PROJECTS = 3;

/** Where the windows keep which projects were shown last, most recent first (application storage). */
export const RECENT_KEY = "cedian.projectRecent";

/** The list with `root` first, each once, at most 20 long. */
export function touched(recent: readonly string[], root: string): string[] {
  const r = trimSlash(root);
  return [r, ...recent.filter((x) => x !== r)].slice(0, 20);
}

/** The recent list as stored, or none when the text is not one. */
export function recentFrom(text: string | undefined): string[] {
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string" && r !== "") : [];
  } catch {
    return [];
  }
}

/** A window of the app: its id, the project it shows (none for an empty one) and whether it has unsaved changes. */
export interface ProjectWindow {
  id: number;
  root?: string;
  dirty: boolean;
}

/**
 * The windows to close once `target` shows: project windows past the `keep` most recently shown
 * projects. The target's own is never one, nor a window with unsaved changes (closing it would ask
 * the person), nor a window with no project.
 */
export function coldWindows(windows: readonly ProjectWindow[], recent: readonly string[], target: string, keep = WARM_PROJECTS): number[] {
  const order = touched(recent, target);
  const rank = (root: string) => {
    const at = order.indexOf(trimSlash(root));
    return at < 0 ? order.length : at;
  };
  const projects = windows.filter((w): w is ProjectWindow & { root: string } => w.root !== undefined);
  const byRecent = [...projects].sort((a, b) => rank(a.root) - rank(b.root));
  const warm = new Set<string>();
  const cold: number[] = [];
  for (const w of byRecent) {
    const root = trimSlash(w.root);
    if (root === trimSlash(target) || warm.has(root) || warm.size < keep) {
      warm.add(root);
      continue;
    }
    if (!w.dirty) cold.push(w.id);
  }
  return cold;
}
