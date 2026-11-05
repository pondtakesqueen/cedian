import { describe, expect, it } from "vitest";
import { CLOSE_MS, EASE_CLOSE, EASE_OPEN, EASE_WINDOWS, MOTION_PROPERTIES, OPEN_MS, stretching } from "./motion.js";

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

const XS = [0.1, 0.25, 0.5, 0.75, 0.9];

describe("motion", () => {
  it("opens on cubic ease-out and closes on cubic ease-in", () => {
    for (const x of XS) {
      expect(bezier(EASE_OPEN, x)).toBeCloseTo(1 - (1 - x) ** 3, 2);
      expect(bezier(EASE_CLOSE, x)).toBeCloseTo(x ** 3, 2);
    }
  });

  it("closing is opening played backwards", () => {
    for (const x of XS) expect(bezier(EASE_CLOSE, x)).toBeCloseTo(1 - bezier(EASE_OPEN, 1 - x), 2);
  });

  it("opens slower than it closes", () => {
    expect(OPEN_MS).toBeGreaterThan(CLOSE_MS);
  });

  it("gives the CSS the same numbers", () => {
    expect(MOTION_PROPERTIES).toEqual({ "--cedian-motion-open": "180ms", "--cedian-motion-close": "140ms", "--cedian-motion-press": "90ms", "--cedian-ease-open": EASE_OPEN, "--cedian-ease-close": EASE_CLOSE });
  });

  it("moves the window's blocks on Hyprland's easeOutQuint, with no overshoot", () => {
    for (const x of XS) {
      const y = bezier(EASE_WINDOWS, x);
      expect(y).toBeCloseTo(1 - (1 - x) ** 5, 1);
      expect(y).toBeLessThanOrEqual(1);
    }
    expect(stretching).toEqual({ duration: 479, easing: EASE_WINDOWS });
  });
});
