import { describe, expect, test } from "vitest";
import { arrange, fit, GAP, nearest, place, PIP_MIN, resized, settle, sideOf, STASH_TAB, step, velocityOf } from "./pip.js";

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
    expect(place({ corner: "br" }, size, frame, 300 + GAP).y).toBe(800 - 2 * GAP - 600);
    expect(place({ corner: "tl" }, size, frame, 300 + GAP).y).toBe(2 * GAP + 300);
    expect(place({ corner: "tl" }, size, frame, 5 * (300 + GAP)).y).toBe(800 - GAP - 300);
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
  test("flung so its middle ends past a side, it stashes there", () => {
    expect(settle(at(900, 450), { x: 3000, y: 0 }, frame)).toEqual({ corner: "br", stash: "right" });
    expect(settle(at(-250, 40), { x: 0, y: 0 }, frame)).toEqual({ corner: "tl", stash: "left" });
    // Over the edge, but less than half of it, is not a stash.
    expect(settle(at(-60, 40), { x: 0, y: 0 }, frame)).toEqual({ corner: "tl" });
    // A wide block in a narrow frame, dropped toward the bottom right, rests there.
    const narrow = { width: 786, height: 805 };
    expect(settle({ x: 400, y: 400, width: 600, height: 400 }, { x: 0, y: 0 }, narrow)).toEqual({ corner: "br" });
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

describe("resizing by the free edges", () => {
  test("the edges toward the middle move; the resting corner stays", () => {
    // Bottom right: dragging left and up grows it.
    expect(resized(size, "br", -100, -50, frame)).toEqual({ width: 500, height: 350 });
    // Top left: dragging right and down grows it.
    expect(resized(size, "tl", 100, 50, frame)).toEqual({ width: 500, height: 350 });
    expect(resized(size, "tr", 60, 0, frame)).toEqual({ width: 340, height: 300 });
  });
  test("one edge moves one way only, and the size keeps to the least and the frame", () => {
    expect(resized(size, "br", -100, -50, frame, "x")).toEqual({ width: 500, height: 300 });
    expect(resized(size, "br", -100, -50, frame, "y")).toEqual({ width: 400, height: 350 });
    expect(resized(size, "br", 1000, 1000, frame)).toEqual(PIP_MIN);
    expect(resized(size, "br", -5000, -5000, frame)).toEqual({ width: 1200 - 2 * GAP, height: 800 - 2 * GAP });
  });
});

describe("sharing a small frame", () => {
  const narrow = { width: 786, height: 805 };
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
  test("two blocks side by side that would overlap give up width, half each", () => {
    const [a, b] = arrange([{ rest: { corner: "tl" }, size: { width: 600, height: 400 } }, { rest: { corner: "tr" }, size: { width: 400, height: 560 } }], narrow);
    expect(overlaps(a, b)).toBe(false);
    expect(b.x - (a.x + a.width)).toBe(GAP);
    expect(a.height).toBe(400);
    expect(b.height).toBe(560);
    expect(a.width + b.width).toBe(786 - 3 * GAP);
  });
  test("one above the other gives up height, so a header is never under the other block", () => {
    const [a, b] = arrange([{ rest: { corner: "br" }, size: { width: 600, height: 400 } }, { rest: { corner: "tr" }, size: { width: 400, height: 560 } }], narrow);
    expect(overlaps(a, b)).toBe(false);
    expect(a.y - (b.y + b.height)).toBeGreaterThanOrEqual(GAP);
  });
  test("blocks that fit keep their sizes; a stashed one shares nothing", () => {
    const fits = arrange([{ rest: { corner: "tl" }, size: { width: 300, height: 300 } }, { rest: { corner: "tr" }, size: { width: 300, height: 300 } }], narrow);
    expect(fits.map((r) => r.width)).toEqual([300, 300]);
    const stashed = arrange([{ rest: { corner: "tl" }, size: { width: 600, height: 400 } }, { rest: { corner: "tr", stash: "right" }, size: { width: 600, height: 400 } }], narrow);
    expect(stashed[0].width).toBe(600);
  });
  test("never under the least size: when the frame is too small they may still overlap", () => {
    const tiny = { width: 500, height: 300 };
    const [a, b] = arrange([{ rest: { corner: "tl" }, size: { width: 400, height: 250 } }, { rest: { corner: "tr" }, size: { width: 400, height: 250 } }], tiny);
    expect(a.width).toBeGreaterThanOrEqual(PIP_MIN.width);
    expect(b.width).toBeGreaterThanOrEqual(PIP_MIN.width);
  });
  test("a stack taller than the frame shares its height", () => {
    const short = { width: 700, height: 500 };
    const [a, b] = arrange([{ rest: { corner: "tr" }, size: { width: 440, height: 300 } }, { rest: { corner: "tr" }, size: { width: 440, height: 300 } }], short);
    expect(overlaps(a, b)).toBe(false);
    expect(a.height + b.height).toBe(500 - 3 * GAP);
  });
  test("a stack in one corner grows by each block's own height", () => {
    const [a, b] = arrange([{ rest: { corner: "tl" }, size: { width: 300, height: 200 } }, { rest: { corner: "tl" }, size: { width: 300, height: 300 } }], frame);
    expect(a.y).toBe(GAP);
    expect(b.y).toBe(GAP + 200 + GAP);
  });
});
