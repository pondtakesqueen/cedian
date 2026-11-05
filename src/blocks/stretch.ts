/**
 * How a block is drawn while the window divides its room (owner, 2026-11-05, the open/close
 * mockup's E): a block that opens grows out of its edge while the blocks beside it shrink to make
 * room, and one that closes shrinks back into its edge while they stretch back. VS Code lays the
 * change out once, at its end; each block is then drawn at the box it is passing through with
 * transform and clip-path alone, so nothing is laid out while it moves (motion.ts).
 *
 * A block is drawn from its start corner (top left), where its content starts: moved there, and
 * cut at its far sides. A box bigger than the block is laid out at (one shrinking to make room)
 * shows its own content as far as it reaches and its card's ground beyond it (`ground`).
 */

/** Where an element is laid out or drawn, in window pixels. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A block's card within its box: how far in each side is drawn (the gaps between cards), and its corners. */
export interface Card {
  top: number;
  right: number;
  bottom: number;
  left: number;
  radius: number;
}

export type Edge = "left" | "right" | "top" | "bottom";

export const OPPOSITE: Record<Edge, Edge> = { left: "right", right: "left", top: "bottom", bottom: "top" };

/** A box of no size on `edge` of `box`: where a block grows out of and shrinks back into. */
export function edgeBox(box: Box, edge: Edge): Box {
  switch (edge) {
    case "left":
      return { ...box, width: 0 };
    case "right":
      return { ...box, left: box.left + box.width, width: 0 };
    case "top":
      return { ...box, height: 0 };
    case "bottom":
      return { ...box, top: box.top + box.height, height: 0 };
  }
}

const px = (n: number) => `${Math.round(n * 10) / 10}px`;

/** The corners of a clip, top-left first, `square` ones drawn without their round. */
function corners(radius: number, square: readonly ("tl" | "tr" | "br" | "bl")[] = []): string {
  return (["tl", "tr", "br", "bl"] as const).map((c) => px(square.includes(c) ? 0 : radius)).join(" ");
}

/**
 * One frame of an element laid out at `at`, drawn at `box`: moved so its start corner is `box`'s,
 * and cut to `box`'s size. A side of `box` beyond `at`'s is cut where `at` ends, with no round
 * there, since the card's ground carries on past it.
 */
export function drawAt(at: Box, box: Box, card: Card): Keyframe {
  const wider = box.width > at.width;
  const taller = box.height > at.height;
  const right = card.right + Math.max(0, at.width - box.width);
  const bottom = card.bottom + Math.max(0, at.height - box.height);
  const square: ("tl" | "tr" | "br" | "bl")[] = [];
  if (wider) square.push("tr", "br");
  if (taller) square.push("bl", "br");
  return {
    transform: `translate(${px(box.left - at.left)}, ${px(box.top - at.top)})`,
    clipPath: `inset(${px(card.top)} ${px(right)} ${px(bottom)} ${px(card.left)} round ${corners(card.radius, square)})`,
  };
}

/** An element laid out at `at`, drawn going from `from` to `to`. */
export function stretchFrames(at: Box, from: Box, to: Box, card: Card): Keyframe[] {
  return [drawAt(at, from, card), drawAt(at, to, card)];
}

/** A plain card laid out at `box` that draws the part of a shrinking block past where it is laid out. */
export interface Ground {
  box: Box;
  frames: Keyframe[];
}

/**
 * The card's ground past a block laid out at `at` while it is drawn from `from` to `to`: where the
 * drawn box is wider (or taller) than the block, a strip from the block's far side to the box's,
 * with the card's round on its far corners only. None when the block always covers its box. Wider
 * and taller at once draws the wider side's strip.
 */
export function ground(at: Box, from: Box, to: Box, card: Card): Ground | undefined {
  const big = { ...from, width: Math.max(from.width, to.width), height: Math.max(from.height, to.height) };
  const wide = big.width - at.width;
  const tall = big.height - at.height;
  if (wide < 1 && tall < 1) return undefined;
  const frame = (b: Box): Keyframe => {
    const move = `translate(${px(b.left - big.left)}, ${px(b.top - big.top)})`;
    if (wide >= tall) {
      const left = Math.min(at.width, b.width) - card.right;
      return {
        transform: move,
        clipPath: `inset(${px(card.top)} ${px(card.right + big.width - b.width)} ${px(card.bottom + Math.max(0, big.height - b.height))} ${px(left)} round ${corners(card.radius, ["tl", "bl"])})`,
      };
    }
    const top = Math.min(at.height, b.height) - card.bottom;
    return {
      transform: move,
      clipPath: `inset(${px(top)} ${px(card.right + Math.max(0, big.width - b.width))} ${px(card.bottom + big.height - b.height)} ${px(card.left)} round ${corners(card.radius, ["tl", "tr"])})`,
    };
  };
  return { box: big, frames: [frame(from), frame(to)] };
}

/** Whether two boxes differ by a pixel or more on any side. */
export function moved(a: Box, b: Box): boolean {
  return Math.abs(a.left - b.left) >= 1 || Math.abs(a.top - b.top) >= 1 || Math.abs(a.width - b.width) >= 1 || Math.abs(a.height - b.height) >= 1;
}
