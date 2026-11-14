import { describe, expect, it } from "vitest";
import { formatPhases, launchMarks, PhaseLog, phaseReport } from "./phases.js";

describe("phaseReport", () => {
  it("orders the marks, gives each the time since the one before, and names the slowest", () => {
    const r = phaseReport("launch", [
      { name: "daemon connected", at: 9_400 },
      { name: "process start", at: 1_000 },
      { name: "workbench started", at: 3_000 },
      { name: "curtain up", at: 12_800 },
    ]);
    expect(r).toEqual({
      what: "launch",
      totalMs: 11_800,
      slowest: "daemon connected",
      phases: [
        { name: "process start", atMs: 0, ms: 0 },
        { name: "workbench started", atMs: 2_000, ms: 2_000 },
        { name: "daemon connected", atMs: 8_400, ms: 6_400 },
        { name: "curtain up", atMs: 11_800, ms: 3_400 },
      ],
    });
  });

  it("is empty for no marks, and keeps the first of a name marked twice", () => {
    expect(phaseReport("launch", [])).toEqual({ what: "launch", totalMs: 0, phases: [] });
    const log = new PhaseLog("launch", () => 50);
    log.mark("a", 10);
    log.mark("a", 30);
    log.mark("b");
    expect(log.report().phases.map((p) => [p.name, p.atMs])).toEqual([["a", 0], ["b", 40]]);
    expect(log.all()).toEqual([{ name: "a", at: 10 }, { name: "b", at: 50 }]);
    expect(log.has("a")).toBe(true);
    expect(log.has("c")).toBe(false);
  });

  it("prints one line a person can read and paste", () => {
    const r = phaseReport("tab switch (warm)", [{ name: "pressed", at: 0 }, { name: "windows listed", at: 12.4 }, { name: "focused", at: 6_900 }]);
    expect(formatPhases(r)).toBe("tab switch (warm) 6900 ms, slowest: focused | pressed +0 | windows listed +12 | focused +6888");
  });
});

describe("launchMarks", () => {
  const vs = (name: string, startTime: number) => ({ name, startTime });
  it("names VS Code's own marks and leaves the rest out", () => {
    expect(launchMarks([vs("code/timeOrigin", 100), vs("code/didStartMain", 400), vs("code/willOpenNewWindow", 900), vs("code/somethingElse", 950), vs("code/didStartWorkbench", 2_000)])).toEqual([
      { name: "process start", at: 100 },
      { name: "main started", at: 400 },
      { name: "window asked for", at: 900 },
      { name: "workbench started", at: 2_000 },
    ]);
  });

  it("starts at the window in an app that was already running: a project tab's new window", () => {
    const marks = launchMarks([vs("code/timeOrigin", 100), vs("code/didStartMain", 400), vs("code/willOpenNewWindow", 600_000), vs("code/didStartRenderer", 600_300)]);
    expect(marks.map((m) => m.name)).toEqual(["window asked for", "renderer started"]);
  });
});
