import { describe, expect, it } from "vitest";
import { CLOSE_MS, EASE_CLOSE, EASE_OPEN, easeClose, easeOpen, MOTION_PROPERTIES, OPEN_MS } from "./motion.js";

/** A CSS cubic-bezier's y at x, solved for t by bisection. */
function bezier(css: string, x: number): number {
  const [x1, y1, x2, y2] = css.match(/[\d.]+/g)!.map(Number);
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < x) lo = mid; else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
}

describe("motion", () => {
  it("opens slower than it closes, both ending where they should", () => {
    expect(OPEN_MS).toBeGreaterThan(CLOSE_MS);
    for (const ease of [easeOpen, easeClose]) {
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
    }
  });

  it("draws the same curves in CSS as in the frame loops", () => {
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(bezier(EASE_OPEN, x)).toBeCloseTo(easeOpen(x), 1);
      expect(bezier(EASE_CLOSE, x)).toBeCloseTo(easeClose(x), 1);
    }
  });

  it("gives the CSS the same numbers", () => {
    expect(MOTION_PROPERTIES).toEqual({ "--cedian-motion-open": "320ms", "--cedian-motion-close": "240ms", "--cedian-ease-open": EASE_OPEN, "--cedian-ease-close": EASE_CLOSE });
  });
});
