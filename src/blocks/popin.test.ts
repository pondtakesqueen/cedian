import { describe, expect, it } from "vitest";
import { EASE_WINDOWS, POPIN } from "./motion.js";
import { popFrames } from "./popin.js";

describe("popin", () => {
  it("grows in from POPIN as it fades in, Hyprland's windowsIn and fadeIn at about half", () => {
    const [size, fade] = popFrames("in");
    expect(size.frames).toEqual([{ transform: `scale(${POPIN})` }, { transform: "none" }]);
    expect(size.timing).toEqual({ duration: 215, easing: EASE_WINDOWS });
    expect(fade.frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(fade.timing.duration).toBe(120);
  });

  it("shrinks out to POPIN as it fades out, Hyprland's windowsOut and fadeOut at about half", () => {
    const [size, fade] = popFrames("out");
    expect(size.frames).toEqual([{ transform: "none" }, { transform: `scale(${POPIN})` }]);
    expect(size.timing).toEqual({ duration: 100, easing: "linear" });
    expect(fade.frames).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(fade.timing.duration).toBe(100);
  });

  it("never scales past whole: no spring", () => {
    for (const way of ["in", "out"] as const) {
      for (const f of popFrames(way)[0].frames) expect(String(f.transform)).not.toMatch(/scale\(1\.\d*[1-9]/);
    }
  });
});
