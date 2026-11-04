import { describe, expect, it, test } from "vitest";
import { AGENT_CONTAINER, ASIDE, lockMoves, movesFor, PLACES, THREADS_CONTAINER, TOOL_PICKS, TOOLS, VSCODE_CHAT, type Place } from "./places.js";

describe("where the window's parts go (the prototype's layout)", () => {
  test("from VS Code's own places: Threads to the left, the tools then the agent to one panel on the right, in order", () => {
    const stock: Record<string, Place> = { [THREADS_CONTAINER]: "panel", [AGENT_CONTAINER]: "auxiliary", "workbench.view.explorer": "sidebar", "workbench.view.search": "sidebar", "workbench.view.scm": "sidebar", terminal: "panel", "workbench.view.debug": "sidebar", "workbench.view.extensions": "sidebar", [VSCODE_CHAT]: "auxiliary" };
    expect(movesFor((c) => stock[c])).toEqual([
      { container: THREADS_CONTAINER, to: "sidebar" },
      { container: "workbench.view.explorer", to: "auxiliary", index: 0 },
      { container: "workbench.view.search", to: "auxiliary", index: 1 },
      { container: "workbench.view.scm", to: "auxiliary", index: 2 },
      { container: "terminal", to: "auxiliary", index: 3 },
      { container: "workbench.view.debug", to: "panel" },
      { container: "workbench.view.extensions", to: "panel" },
      { container: VSCODE_CHAT, to: "panel" },
    ]);
  });
  test("Threads is alone in the left side bar, so its tab strip hides", () => {
    expect(PLACES.filter((p) => p.place === "sidebar").map((p) => p.container)).toEqual([THREADS_CONTAINER]);
  });
  test("a window moved by the first version (the agent on the left) puts the agent back as the panel's last tab", () => {
    const v1: Record<string, Place> = { [THREADS_CONTAINER]: "sidebar", [AGENT_CONTAINER]: "sidebar", ...Object.fromEntries([...TOOLS, ...ASIDE].map((t) => [t.container, t.place])) };
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
  test("opens every part the window places: the tools, the Browser, Run and Debug, Extensions, then the agent and Threads", () => {
    expect(TOOL_PICKS.map((t) => t.label)).toEqual(["Files", "Search", "Git", "Terminal", "Browser", "Run and Debug", "Extensions", "Agent", "Threads"]);
    const containers = TOOL_PICKS.flatMap((t) => ("container" in t.open ? [t.open.container] : []));
    for (const p of PLACES) if (p.container !== VSCODE_CHAT) expect(containers).toContain(p.container);
  });
});

describe("lockMoves", () => {
  it("leaves a window that keeps the side blocks in place", () => {
    expect(lockMoves("sidebar", [THREADS_CONTAINER])).toEqual([]);
  });
  it("sends Threads back to the left and anything else there to the right", () => {
    expect(lockMoves("auxiliary", ["workbench.view.explorer"])).toEqual([
      { container: THREADS_CONTAINER, to: "sidebar" },
      { container: "workbench.view.explorer", to: "auxiliary" },
    ]);
  });
  it("leaves Threads alone when this build has none", () => {
    expect(lockMoves(undefined, [])).toEqual([]);
  });
});
