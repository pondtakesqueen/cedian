// Where each part of the window lives, after the prototype (spec §3.3): the agent on the left, the
// editors in the middle, and the tools (Files, Search, Git, Terminal) as tabs of one panel on the
// right, with no activity bar. VS Code's parts are its view containers; this says which part each
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

/** The tools panel's tabs, in order: VS Code's own containers. */
export const TOOLS: readonly Placed[] = [
  { container: "workbench.view.explorer", place: "auxiliary" },
  { container: "workbench.view.search", place: "auxiliary" },
  { container: "workbench.view.scm", place: "auxiliary" },
  { container: "terminal", place: "auxiliary" },
];

export const PLACES: readonly Placed[] = [{ container: AGENT_CONTAINER, place: "sidebar" }, ...TOOLS];

/** Raised when PLACES changes, so a window moves the parts again once. */
export const PLACES_VERSION = 1;

export interface Move {
  container: string;
  to: Place;
  /** Its tab's place among the part's tabs, for the tools. */
  index?: number;
}

/**
 * The moves that put each container where PLACES says, given where each is now (`undefined`: not
 * registered in this build, so left alone). The tools carry their tab's place, so moving them in
 * order leaves them in order.
 */
export function movesFor(where: (container: string) => Place | undefined): Move[] {
  const out: Move[] = [];
  for (const p of PLACES) {
    const now = where(p.container);
    if (now === undefined || now === p.place) continue;
    const tool = TOOLS.findIndex((t) => t.container === p.container);
    out.push({ container: p.container, to: p.place, ...(tool >= 0 ? { index: tool } : {}) });
  }
  return out;
}
