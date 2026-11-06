// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { CURTAIN, curtainDown, LIFTING, lift, lower } from "./curtain.js";
import { moving } from "./motion.js";

describe("curtain", () => {
  it("stops the blocks moving while it is down", () => {
    const wb = document.createElement("div");
    wb.classList.add("monaco-enable-motion");
    expect(moving(wb)).toBe(true);
    lower(wb);
    expect(curtainDown(wb)).toBe(true);
    expect(moving(wb)).toBe(false);
    lift(wb, false);
    expect(moving(wb)).toBe(true);
  });

  it("lifts once, fading only when asked, and the fade clears itself", () => {
    const wb = document.createElement("div");
    const runs: (() => void)[] = [];
    lower(wb);
    expect(lift(wb, true, (run) => runs.push(run))).toBe(true);
    expect(wb.classList.contains(CURTAIN)).toBe(false);
    expect(wb.classList.contains(LIFTING)).toBe(true);
    runs.forEach((r) => r());
    expect(wb.classList.contains(LIFTING)).toBe(false);
    expect(lift(wb, true, (run) => runs.push(run))).toBe(false);
    lower(wb);
    expect(lift(wb, false)).toBe(true);
    expect(wb.classList.contains(LIFTING)).toBe(false);
  });
});
