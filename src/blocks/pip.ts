// Where a floating block (PiP, spec §3.3, §4.4) sits in the window's frame: in one of the four
// corners, or stashed against a side with only a tab showing. Pure geometry: the layer measures
// the frame and the pointer, and this says where the block goes when it is let go.

export type Corner = "tl" | "tr" | "bl" | "br";
export type Side = "left" | "right";

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A block's place in the frame, in CSS pixels from the frame's top left. */
export interface Rect extends Point, Size {}

/** Where a block rests: a corner, and the side it is stashed against when it is. */
export interface Rest {
  corner: Corner;
  stash?: Side;
}

/** The gap between a floating block and the frame's edge, and between blocks in one corner. */
export const GAP = 12;
/** How much of a stashed block stays in the frame: the tab that brings it back. */
export const STASH_TAB = 28;
/** A new floating block's size, and the least it may be. */
export const PIP_SIZE: Size = { width: 440, height: 300 };
export const PIP_MIN: Size = { width: 280, height: 180 };
/** How far a fling carries the block on after it is let go, in seconds of its speed. */
export const FLING_S = 0.18;

export const CORNERS: readonly Corner[] = ["tl", "tr", "bl", "br"];

const isRight = (corner: Corner) => corner === "tr" || corner === "br";
const isBottom = (corner: Corner) => corner === "bl" || corner === "br";

export function isCorner(value: unknown): value is Corner {
  return typeof value === "string" && (CORNERS as readonly string[]).includes(value);
}

/** `size` made to fit `frame` with the gaps, never under the least size unless the frame is. */
export function fit(size: Size, frame: Size): Size {
  const room = (have: number, want: number, least: number) => Math.max(Math.min(least, have), Math.min(want, have - 2 * GAP));
  return { width: room(frame.width, Math.max(size.width, PIP_MIN.width), PIP_MIN.width), height: room(frame.height, Math.max(size.height, PIP_MIN.height), PIP_MIN.height) };
}

/**
 * The block's place resting in `corner`, `before` px from the corner as a stack grows toward the
 * frame's middle (the blocks nearer the corner and their gaps); stashed, all but the tab is past
 * `stash`'s side.
 */
export function place(rest: Rest, size: Size, frame: Size, before = 0): Rect {
  const { width, height } = fit(size, frame);
  const top = isBottom(rest.corner) ? frame.height - GAP - height - before : GAP + before;
  const y = Math.max(GAP, Math.min(top, frame.height - GAP - height));
  let x = isRight(rest.corner) ? frame.width - GAP - width : GAP;
  if (rest.stash === "left") x = STASH_TAB - width;
  else if (rest.stash === "right") x = frame.width - STASH_TAB;
  return { x, y, width, height };
}

/** A floating block to arrange: where it rests and the size it was given. */
export interface Resting {
  rest: Rest;
  size: Size;
}

const overlap = (a: Rect, b: Rect): Size => ({
  width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
});

/**
 * Where each block goes, in order: in its corner, stacked after the ones before it there (a
 * stack taller than the frame shares its height). Blocks
 * in different corners that would overlap give up size along the axis that needs less, half each
 * (down to the least size), so a small frame shows them side by side instead of one over the
 * other's header. The sizes they were given stay theirs; this is only how they are drawn now.
 * Stashed blocks are left out of the sharing: only their tab is in the frame.
 */
export function arrange(items: readonly Resting[], frame: Size): Rect[] {
  const sizes = items.map((i) => fit(i.size, frame));
  // A stack taller than the frame shares its height, each block in proportion.
  const stacks = new Map<string, number[]>();
  items.forEach((item, i) => {
    if (item.rest.stash) return;
    const list = stacks.get(item.rest.corner) ?? [];
    list.push(i);
    stacks.set(item.rest.corner, list);
  });
  for (const list of stacks.values()) {
    const room = frame.height - (list.length + 1) * GAP;
    const tall = list.reduce((sum, i) => sum + sizes[i].height, 0);
    if (list.length < 2 || tall <= room) continue;
    for (const i of list) sizes[i] = { ...sizes[i], height: Math.max(Math.min(PIP_MIN.height, sizes[i].height), Math.floor((sizes[i].height * room) / tall)) };
  }
  const layout = () => {
    const used = new Map<string, number>();
    return items.map((item, i) => {
      const key = `${item.rest.corner}:${item.rest.stash ?? ""}`;
      const before = used.get(key) ?? 0;
      const rect = place(item.rest, sizes[i], frame, before);
      used.set(key, before + rect.height + GAP);
      return rect;
    });
  };
  let rects = layout();
  for (let round = 0; round < 8; round++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (a.rest.stash || b.rest.stash || a.rest.corner === b.rest.corner) continue;
        const o = overlap(rects[i], rects[j]);
        if (o.width <= 0 || o.height <= 0) continue;
        const axis = o.width <= o.height ? "width" : "height";
        const least = axis === "width" ? PIP_MIN.width : PIP_MIN.height;
        // What each gives, so the two end a gap apart: half each, the rest from whichever can.
        const need = o[axis] + GAP;
        const roomA = Math.max(0, sizes[i][axis] - least);
        const roomB = Math.max(0, sizes[j][axis] - least);
        let giveA = Math.min(roomA, Math.ceil(need / 2));
        const giveB = Math.min(roomB, need - giveA);
        giveA = Math.min(roomA, need - giveB);
        if (giveA + giveB <= 0) continue;
        sizes[i] = { ...sizes[i], [axis]: sizes[i][axis] - giveA };
        sizes[j] = { ...sizes[j], [axis]: sizes[j][axis] - giveB };
        moved = true;
      }
    }
    if (!moved) break;
    rects = layout();
  }
  return rects;
}

/** The corner nearest `point`. */
export function nearest(point: Point, frame: Size): Corner {
  const right = point.x > frame.width / 2;
  const bottom = point.y > frame.height / 2;
  return bottom ? (right ? "br" : "bl") : right ? "tr" : "tl";
}

/**
 * Where a block let go at `at` with `velocity` (px/s) comes to rest: it carries on for
 * `FLING_S` of its speed, and stashes against a side its middle would end past, else rests in the
 * corner nearest where its middle ends.
 */
export function settle(at: Rect, velocity: Point, frame: Size): Rest {
  const x = at.x + velocity.x * FLING_S;
  const y = at.y + velocity.y * FLING_S;
  const middle = { x: x + at.width / 2, y: y + at.height / 2 };
  const corner = nearest(middle, frame);
  // Stashed only when more than half of it would end past the side: a wide block dropped near
  // an edge rests in the corner.
  if (middle.x < 0) return { corner: isBottom(corner) ? "bl" : "tl", stash: "left" };
  if (middle.x > frame.width) return { corner: isBottom(corner) ? "br" : "tr", stash: "right" };
  return { corner };
}

/** The corner one arrow key away: left and right cross the frame, up and down go along a side. */
export function step(corner: Corner, key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"): Corner {
  const right = key === "ArrowRight" ? true : key === "ArrowLeft" ? false : isRight(corner);
  const bottom = key === "ArrowDown" ? true : key === "ArrowUp" ? false : isBottom(corner);
  return bottom ? (right ? "br" : "bl") : right ? "tr" : "tl";
}

/** The side a block in `corner` stashes against. */
export function sideOf(corner: Corner): Side {
  return isRight(corner) ? "right" : "left";
}

/** The speed of a drag from its last few samples (time in ms), in px/s; still when too few. */
export function velocityOf(samples: readonly (Point & { t: number })[]): Point {
  if (samples.length < 2) return { x: 0, y: 0 };
  const last = samples[samples.length - 1];
  // The samples from the last 80 ms: a pause before letting go is a drop, not a fling.
  const recent = samples.filter((s) => last.t - s.t <= 80);
  const first = recent[0];
  const dt = (last.t - first.t) / 1000;
  if (recent.length < 2 || dt <= 0) return { x: 0, y: 0 };
  return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
}

/** Which way a size grows: the edges away from the corner the block rests in. */
export function growth(corner: Corner): Point {
  return { x: isRight(corner) ? -1 : 1, y: isBottom(corner) ? -1 : 1 };
}

/**
 * The size after dragging the free edges of a block resting in `corner` by `dx`, `dy` from `from`:
 * the edges toward the frame's middle move, the corner stays where it is.
 */
export function resized(from: Size, corner: Corner, dx: number, dy: number, frame: Size, axes: "x" | "y" | "xy" = "xy"): Size {
  const g = growth(corner);
  const want = {
    width: axes === "y" ? from.width : from.width + g.x * dx,
    height: axes === "x" ? from.height : from.height + g.y * dy,
  };
  return fit(want, frame);
}
