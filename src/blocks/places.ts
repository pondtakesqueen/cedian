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

export const PLACES: readonly Placed[] = [{ container: THREADS_CONTAINER, place: "sidebar" }, ...TOOLS, { container: AGENT_CONTAINER, place: "auxiliary" }];

/** Raised when PLACES changes, so a window moves the parts again once. */
export const PLACES_VERSION = 2;

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
