import { describe, expect, test } from "vitest";
import { AGENT_CONTAINER, movesFor, PLACES, TOOLS, type Place } from "./places.js";

describe("where the window's parts go (the prototype's layout)", () => {
  test("from VS Code's own places: the agent to the left, the tools to one panel on the right, in order", () => {
    const stock: Record<string, Place> = { [AGENT_CONTAINER]: "auxiliary", "workbench.view.explorer": "sidebar", "workbench.view.search": "sidebar", "workbench.view.scm": "sidebar", terminal: "panel" };
    expect(movesFor((c) => stock[c])).toEqual([
      { container: AGENT_CONTAINER, to: "sidebar" },
      { container: "workbench.view.explorer", to: "auxiliary", index: 0 },
      { container: "workbench.view.search", to: "auxiliary", index: 1 },
      { container: "workbench.view.scm", to: "auxiliary", index: 2 },
      { container: "terminal", to: "auxiliary", index: 3 },
    ]);
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
