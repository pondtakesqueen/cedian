import { describe, expect, it } from "vitest";
import { easeOpen, play, sizeAt } from "./resize.js";

describe("sizeAt", () => {
  it("goes from one size to the other on opening's curve, in whole pixels", () => {
    expect(sizeAt(0, 300, 0)).toBe(0);
    expect(sizeAt(0, 300, 90)).toBe(Math.round(300 * easeOpen(0.5)));
    expect(sizeAt(0, 300, 180)).toBe(300);
    expect(sizeAt(300, 0, 400)).toBe(0);
  });

  it("is cubic ease-out: most of the way early, landing softly", () => {
    expect(easeOpen(0.5)).toBe(0.875);
    expect(sizeAt(260, 0, 90)).toBe(33);
  });
});

/** Frames by hand: each `tick(ms)` runs the waiting callback that much later. */
function clock() {
  let t = 0;
  let waiting: ((now: number) => void) | undefined;
  return {
    frames: {
      request: (cb: (now: number) => void) => ((waiting = cb), 1),
      cancel: () => (waiting = undefined),
      now: () => t,
    },
    tick(ms: number) {
      t += ms;
      const cb = waiting;
      waiting = undefined;
      cb?.(t);
    },
  };
}

describe("play", () => {
  it("applies the first size at once, one per frame, and the last exactly", async () => {
    const c = clock();
    const sizes: number[] = [];
    const p = play(0, 260, (s) => sizes.push(s), c.frames);
    expect(sizes).toEqual([0]);
    c.tick(16);
    c.tick(16);
    expect(sizes.length).toBe(3);
    expect(sizes[1]).toBeGreaterThan(0);
    expect(sizes[2]).toBeGreaterThan(sizes[1]);
    for (let i = 0; i < 20; i++) c.tick(16);
    expect(sizes.at(-1)).toBe(260);
    await p.done;
  });

  it("finishes at once on finish(), and only once", async () => {
    const c = clock();
    const sizes: number[] = [];
    const p = play(300, 0, (s) => sizes.push(s), c.frames);
    p.finish();
    p.finish();
    c.tick(16);
    expect(sizes).toEqual([300, 0]);
    await p.done;
  });
});
