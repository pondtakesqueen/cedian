import { describe, expect, it } from "vitest";
import { drawAt, edgeBox, ground, moved, stretchFrames, type Box, type Card } from "./stretch.js";

const CARD: Card = { top: 0, right: 4, bottom: 0, left: 4, radius: 12 };
const NONE: Card = { top: 0, right: 0, bottom: 0, left: 0, radius: 8 };

/** The rectangle a frame shows on screen, for an element laid out at `at`, read back from its CSS. */
function shown(at: Box, frame: Keyframe): Box {
  const [dx, dy] = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(String(frame.transform))!.slice(1).map(Number);
  const [t, r, b, l] = /inset\(([-\d.]+)px ([-\d.]+)px ([-\d.]+)px ([-\d.]+)px/.exec(String(frame.clipPath))!.slice(1).map(Number);
  return { left: at.left + dx + l, top: at.top + dy + t, width: at.width - l - r, height: at.height - t - b };
}

describe("edgeBox", () => {
  const box = { left: 100, top: 20, width: 300, height: 200 };
  it("puts a box of no size on each edge", () => {
    expect(edgeBox(box, "left")).toEqual({ left: 100, top: 20, width: 0, height: 200 });
    expect(edgeBox(box, "right")).toEqual({ left: 400, top: 20, width: 0, height: 200 });
    expect(edgeBox(box, "top")).toEqual({ left: 100, top: 20, width: 300, height: 0 });
    expect(edgeBox(box, "bottom")).toEqual({ left: 100, top: 220, width: 300, height: 0 });
  });
});

describe("drawAt", () => {
  const at = { left: 300, top: 0, width: 400, height: 500 };

  it("draws a block at rest as its card", () => {
    expect(drawAt(at, at, CARD)).toEqual({ transform: "translate(0px, 0px)", clipPath: "inset(0px 4px 0px 4px round 12px 12px 12px 12px)" });
  });

  it("draws a split growing out of its right edge with its content moving in from there", () => {
    const start = shown(at, drawAt(at, edgeBox(at, "right"), CARD));
    expect(start.width).toBeLessThanOrEqual(0);
    const half = shown(at, drawAt(at, { left: 500, top: 0, width: 200, height: 500 }, CARD));
    expect(half).toEqual({ left: 504, top: 0, width: 192, height: 500 });
  });

  it("draws a sidebar growing out of the window's left edge, its content still", () => {
    const side = { left: 0, top: 0, width: 260, height: 500 };
    const frame = drawAt(side, { left: 0, top: 0, width: 100, height: 500 }, NONE);
    expect(frame.transform).toBe("translate(0px, 0px)");
    expect(shown(side, frame)).toEqual({ left: 0, top: 0, width: 100, height: 500 });
  });

  it("draws a block bigger than it is laid out from its start corner, square where its ground carries on", () => {
    const frame = drawAt(at, { left: 100, top: 0, width: 600, height: 500 }, CARD);
    expect(frame.transform).toBe("translate(-200px, 0px)");
    expect(frame.clipPath).toBe("inset(0px 4px 0px 4px round 12px 0px 0px 12px)");
  });
});

describe("stretchFrames", () => {
  it("goes from one box to the other", () => {
    const at = { left: 0, top: 0, width: 400, height: 300 };
    const [a, b] = stretchFrames(at, edgeBox(at, "bottom"), at, NONE);
    expect(shown(at, a).height).toBe(0);
    expect(shown(at, a).top).toBe(300);
    expect(shown(at, b)).toEqual(at);
  });
});

describe("ground", () => {
  // The editor while the sidebar opens: laid out narrower and further right, drawn from where it was.
  const from = { left: 8, top: 0, width: 800, height: 500 };
  const at = { left: 268, top: 0, width: 540, height: 500 };

  it("is none for a block that only grows or moves", () => {
    expect(ground(at, at, at, CARD)).toBeUndefined();
    expect(ground(from, at, from, CARD)).toBeUndefined();
    expect(ground(at, { ...at, left: 0 }, at, CARD)).toBeUndefined();
  });

  it("fills from the block's far side to the drawn box's, and shrinks to nothing", () => {
    const g = ground(at, from, at, CARD)!;
    expect(g.box).toEqual(from);
    const start = shown(g.box, g.frames[0]);
    const block = shown(at, drawAt(at, from, CARD));
    // The strip starts where the block's card ends, and ends where the drawn box's card ends.
    expect(start.left).toBe(block.left + block.width);
    expect(start.left + start.width).toBe(from.left + from.width - CARD.right);
    expect(shown(g.box, g.frames[1]).width).toBe(0);
  });

  it("draws a strip under a block whose bottom rises for the panel", () => {
    const editor = { left: 0, top: 0, width: 600, height: 500 };
    const now = { left: 0, top: 0, width: 600, height: 300 };
    const g = ground(now, editor, now, NONE)!;
    const start = shown(g.box, g.frames[0]);
    expect(start).toEqual({ left: 0, top: 300, width: 600, height: 200 });
    expect(g.frames[0].clipPath).toContain("round 0px 0px 8px 8px");
  });
});

describe("moved", () => {
  it("ignores less than a pixel", () => {
    const a = { left: 0, top: 0, width: 10, height: 10 };
    expect(moved(a, { ...a, left: 0.5 })).toBe(false);
    expect(moved(a, { ...a, width: 11 })).toBe(true);
  });
});
