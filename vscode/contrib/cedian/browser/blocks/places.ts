// Where each part of the window lives, after the prototype (spec §3.3): the Threads list on the left,
// the agent in the middle (an agent editor, opened by the window), and the tools (Files, Search,
// Git, Terminal) as tabs of one panel on the right, with no activity bar. The side agent pane stays
// as the panel's last tab. VS Code's parts are its view containers; this says which part each
// goes to and in what order, and the window moves them once (a person who moves one later keeps
// it there).

/** VS Code's parts that hold view containers. */
export type Place = "sidebar" | "panel" | "auxiliary";

export interface Placed {
  /** A view container's id. */
  container: string;
  place: Place;
}

/** The agent pane's container (`AGENT_PANE_CONTAINER_ID`). */
export const AGENT_CONTAINER = "workbench.view.cedian.agent";

/** The Threads list's container (`THREADS_CONTAINER_ID`). */
export const THREADS_CONTAINER = "workbench.view.cedian.threads";

/** The tools panel's tabs, in order: VS Code's own containers. */
export const TOOLS: readonly Placed[] = [
  { container: "workbench.view.explorer", place: "auxiliary" },
  { container: "workbench.view.search", place: "auxiliary" },
  { container: "workbench.view.scm", place: "auxiliary" },
  { container: "terminal", place: "auxiliary" },
];

/**
 * VS Code's own Chat (`ChatViewContainerId`). Cedian's agent replaces it, but it can still show in
 * the right panel beside the tools (seen on a web build with `chat.disableAIFeatures` on), so it
 * goes to the bottom panel, out of the tools' way. Not in + Tool.
 */
export const VSCODE_CHAT = "workbench.panel.chat";

/**
 * VS Code's other containers that start in the left side bar, moved to the bottom panel so Threads
 * is alone there and its tab strip hides (`workbench.activityBar.autoHide`), and VS Code's Chat.
 */
export const ASIDE: readonly Placed[] = [
  { container: "workbench.view.debug", place: "panel" },
  { container: "workbench.view.extensions", place: "panel" },
  { container: VSCODE_CHAT, place: "panel" },
];

export const PLACES: readonly Placed[] = [{ container: THREADS_CONTAINER, place: "sidebar" }, ...TOOLS, { container: AGENT_CONTAINER, place: "auxiliary" }, ...ASIDE];

/** Raised when PLACES changes, so a window moves the parts again once. */
export const PLACES_VERSION = 4;

export interface Move {
  container: string;
  to: Place;
  /** Its tab's place among the right panel's tabs. */
  index?: number;
}

/**
 * The moves that put each container where PLACES says, given where each is now (`undefined`: not
 * registered in this build, so left alone). What goes to the right panel carries its tab's place,
 * so moving them in order leaves them in order.
 */
export function movesFor(where: (container: string) => Place | undefined): Move[] {
  const out: Move[] = [];
  for (const p of PLACES) {
    const now = where(p.container);
    if (now === undefined || now === p.place) continue;
    const tab = PLACES.filter((t) => t.place === "auxiliary").findIndex((t) => t.container === p.container);
    out.push({ container: p.container, to: p.place, ...(tab >= 0 ? { index: tab } : {}) });
  }
  return out;
}

/**
 * The side blocks stay put, as the prototype's do: Threads alone in the left side bar, every tool on
 * the right. Given where Threads is and what the left side bar holds now, the moves that undo a
 * drag or a "Move to" that broke that. Sizes stay free: only places are kept.
 */
export function lockMoves(threadsAt: Place | undefined, inSidebar: readonly string[]): Move[] {
  const out: Move[] = [];
  if (threadsAt !== undefined && threadsAt !== "sidebar") out.push({ container: THREADS_CONTAINER, to: "sidebar" });
  for (const c of inSidebar) if (c !== THREADS_CONTAINER) out.push({ container: c, to: "auxiliary" });
  return out;
}

/** What "+ Tool" opens: a part's container, shown and focused, or a command. */
export type ToolOpen = { container: string } | { command: string };

export interface ToolPick {
  label: string;
  /** Under which heading of the picker, as in the prototype's menu. */
  group: "tools" | "project";
  open: ToolOpen;
  /** Its icon in the tool strip under "+ Tool": a VS Code codicon's id. */
  icon: string;
}

/** The title bar's "+ Tool" menu: the tools, the Browser, then the project's own blocks. */
export const TOOL_PICKS: readonly ToolPick[] = [
  { label: "Files", group: "tools", open: { container: "workbench.view.explorer" }, icon: "files" },
  { label: "Search", group: "tools", open: { container: "workbench.view.search" }, icon: "search" },
  { label: "Git", group: "tools", open: { container: "workbench.view.scm" }, icon: "source-control" },
  { label: "Terminal", group: "tools", open: { container: "terminal" }, icon: "terminal" },
  { label: "Browser", group: "tools", open: { command: "cedian.openBrowser" }, icon: "globe" },
  { label: "Run and Debug", group: "tools", open: { container: "workbench.view.debug" }, icon: "debug-alt" },
  { label: "Extensions", group: "tools", open: { container: "workbench.view.extensions" }, icon: "extensions" },
  { label: "Agent", group: "project", open: { container: AGENT_CONTAINER }, icon: "sparkle" },
  { label: "Threads", group: "project", open: { container: THREADS_CONTAINER }, icon: "list-unordered" },
];
