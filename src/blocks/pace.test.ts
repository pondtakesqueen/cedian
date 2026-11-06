import { describe, expect, it } from "vitest";
import { Pace, REST_MS } from "./pace.js";

function clock() {
  let t = 0;
  const frames: ((t: number) => void)[] = [];
  return {
    now: () => t,
    frame: (f: (t: number) => void) => frames.push(f),
    /** Runs the next frame `ms` later. */
    step(ms: number) { t += ms; frames.shift()?.(t); },
  };
}

describe("pace", () => {
  it("keeps moving while frames come on time", () => {
    const c = clock();
    const pace = new Pace(c.now, c.frame);
    pace.judge([16, 17, 33, 49, 16]);
    expect(pace.busy()).toBe(false);
  });

  it("switches at once for a while after a stalled frame or two slow ones", () => {
    for (const gaps of [[16, 120, 16], [55, 16, 60]]) {
      const c = clock();
      const pace = new Pace(c.now, c.frame);
      pace.judge(gaps);
      expect(pace.busy()).toBe(true);
      c.step(REST_MS);
      expect(pace.busy()).toBe(false);
    }
  });

  it("leaves out a move's first frame, which carries VS Code's layout", () => {
    const c = clock();
    const pace = new Pace(c.now, c.frame);
    const run = { playState: "running" } as Animation;
    pace.watch(run);
    c.step(300); // the layout's long frame
    c.step(16);
    c.step(16);
    c.step(17);
    (run as { playState: string }).playState = "finished";
    c.step(16);
    expect(pace.busy()).toBe(false);
  });

  it("judges a move that stalls", () => {
    const c = clock();
    const pace = new Pace(c.now, c.frame);
    const run = { playState: "running" } as Animation;
    pace.watch(run);
    c.step(16);
    c.step(16);
    c.step(150);
    (run as { playState: string }).playState = "finished";
    c.step(16);
    expect(pace.busy()).toBe(true);
  });
});
