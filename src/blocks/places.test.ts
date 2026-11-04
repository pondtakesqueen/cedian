import { describe, expect, test } from "vitest";
import { AGENT_CONTAINER, movesFor, PLACES, THREADS_CONTAINER, TOOL_PICKS, TOOLS, type Place } from "./places.js";

describe("where the window's parts go (the prototype's layout)", () => {
  test("from VS Code's own places: Threads to the left, the tools then the agent to one panel on the right, in order", () => {
    const stock: Record<string, Place> = { [THREADS_CONTAINER]: "panel", [AGENT_CONTAINER]: "auxiliary", "workbench.view.explorer": "sidebar", "workbench.view.search": "sidebar", "workbench.view.scm": "sidebar", terminal: "panel" };
    expect(movesFor((c) => stock[c])).toEqual([
      { container: THREADS_CONTAINER, to: "sidebar" },
      { container: "workbench.view.explorer", to: "auxiliary", index: 0 },
      { container: "workbench.view.search", to: "auxiliary", index: 1 },
      { container: "workbench.view.scm", to: "auxiliary", index: 2 },
      { container: "terminal", to: "auxiliary", index: 3 },
    ]);
  });
  test("a window moved by the first version (the agent on the left) puts the agent back as the panel's last tab", () => {
    const v1: Record<string, Place> = { [THREADS_CONTAINER]: "sidebar", [AGENT_CONTAINER]: "sidebar", ...Object.fromEntries(TOOLS.map((t) => [t.container, t.place])) };
    expect(movesFor((c) => v1[c])).toEqual([{ container: AGENT_CONTAINER, to: "auxiliary", index: 4 }]);
  });
  test("what is in place already, or not in this build, is left alone", () => {
    const placed = Object.fromEntries(PLACES.map((p) => [p.container, p.place]));
    expect(movesFor((c) => placed[c])).toEqual([]);
    expect(movesFor((c) => (c === "terminal" ? "panel" : undefined))).toEqual([{ container: "terminal", to: "auxiliary", index: 3 }]);
  });
  test("the tools are Files, Search, Git and Terminal", () => {
    expect(TOOLS.map((t) => t.container)).toEqual(["workbench.view.explorer", "workbench.view.search", "workbench.view.scm", "terminal"]);
  });
});

describe("the title bar's + Tool menu", () => {
  test("opens every tool of the right panel, the Browser, then the agent and Threads", () => {
    expect(TOOL_PICKS.map((t) => t.label)).toEqual(["Files", "Search", "Git", "Terminal", "Browser", "Agent", "Threads"]);
    const containers = TOOL_PICKS.flatMap((t) => ("container" in t.open ? [t.open.container] : []));
    for (const p of PLACES) expect(containers).toContain(p.container);
  });
});
