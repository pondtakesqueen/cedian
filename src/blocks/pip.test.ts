import { describe, expect, test } from "vitest";
import { fit, GAP, nearest, place, PIP_MIN, settle, sideOf, STASH_TAB, step, velocityOf } from "./pip.js";

const frame = { width: 1200, height: 800 };
const size = { width: 400, height: 300 };

describe("where a floating block rests (spec §3.3 PiP)", () => {
  test("each corner, a gap from the edges", () => {
    expect(place({ corner: "tl" }, size, frame)).toEqual({ x: GAP, y: GAP, width: 400, height: 300 });
    expect(place({ corner: "br" }, size, frame)).toEqual({ x: 1200 - GAP - 400, y: 800 - GAP - 300, width: 400, height: 300 });
    expect(place({ corner: "tr" }, size, frame).x).toBe(1200 - GAP - 400);
    expect(place({ corner: "bl" }, size, frame).y).toBe(800 - GAP - 300);
  });
  test("a second block in a corner stacks toward the middle, never off the frame", () => {
    expect(place({ corner: "br" }, size, frame, 1).y).toBe(800 - 2 * GAP - 600);
    expect(place({ corner: "tl" }, size, frame, 1).y).toBe(2 * GAP + 300);
    expect(place({ corner: "tl" }, size, frame, 5).y).toBe(800 - GAP - 300);
  });
  test("stashed, only the tab is in the frame", () => {
    expect(place({ corner: "tr", stash: "right" }, size, frame).x).toBe(1200 - STASH_TAB);
    expect(place({ corner: "bl", stash: "left" }, size, frame).x).toBe(STASH_TAB - 400);
  });
  test("a size fits the frame and keeps the least size while the frame has room", () => {
    expect(fit({ width: 5000, height: 5000 }, frame)).toEqual({ width: 1200 - 2 * GAP, height: 800 - 2 * GAP });
    expect(fit({ width: 10, height: 10 }, frame)).toEqual(PIP_MIN);
    expect(fit(size, { width: 200, height: 100 })).toEqual({ width: 200, height: 100 });
  });
});

describe("letting go", () => {
  const at = (x: number, y: number) => ({ x, y, width: 400, height: 300 });
  test("dropped still, it rests in the corner nearest its middle", () => {
    expect(settle(at(100, 80), { x: 0, y: 0 }, frame)).toEqual({ corner: "tl" });
    expect(settle(at(700, 450), { x: 0, y: 0 }, frame)).toEqual({ corner: "br" });
    expect(settle(at(700, 50), { x: 0, y: 0 }, frame)).toEqual({ corner: "tr" });
  });
  test("flung, it carries on toward where it was going", () => {
    // Middle starts top-left; a fast fling right and down lands it bottom right.
    expect(settle(at(100, 80), { x: 4000, y: 3000 }, frame)).toEqual({ corner: "br" });
  });
  test("flung well past a side, it stashes there", () => {
    expect(settle(at(900, 450), { x: 3000, y: 0 }, frame)).toEqual({ corner: "br", stash: "right" });
    expect(settle(at(-250, 40), { x: 0, y: 0 }, frame)).toEqual({ corner: "tl", stash: "left" });
    // Over the edge a little is not a stash.
    expect(settle(at(-60, 40), { x: 0, y: 0 }, frame)).toEqual({ corner: "tl" });
  });
  test("speed comes from the last 80 ms: a pause before letting go is a drop", () => {
    expect(velocityOf([{ x: 0, y: 0, t: 0 }, { x: 50, y: 0, t: 50 }])).toEqual({ x: 1000, y: 0 });
    expect(velocityOf([{ x: 0, y: 0, t: 0 }, { x: 50, y: 0, t: 50 }, { x: 50, y: 0, t: 400 }])).toEqual({ x: 0, y: 0 });
    expect(velocityOf([{ x: 3, y: 3, t: 0 }])).toEqual({ x: 0, y: 0 });
  });
  test("nearest corner", () => {
    expect(nearest({ x: 10, y: 790 }, frame)).toBe("bl");
  });
});

describe("keys", () => {
  test("left and right cross the frame, up and down go along a side", () => {
    expect(step("br", "ArrowLeft")).toBe("bl");
    expect(step("br", "ArrowUp")).toBe("tr");
    expect(step("tl", "ArrowRight")).toBe("tr");
    expect(step("tl", "ArrowDown")).toBe("bl");
    expect(step("tl", "ArrowLeft")).toBe("tl");
  });
  test("a block stashes against its corner's side", () => {
    expect(sideOf("tr")).toBe("right");
    expect(sideOf("bl")).toBe("left");
  });
});
