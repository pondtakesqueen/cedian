/**
 * A block's size played out frame by frame (owner, 2026-11-05: the window divides its room as the
 * mockup's E does, every block laid out at each size it passes through, so what sits on a block's
 * far edge, its scrollbar, its buttons, its composer, moves with that edge). VS Code lays the
 * window out at each frame's size; this only says which size, on STRETCHING's time and curve.
 */
import { OPEN_MS } from "./motion.js";

/** Opening's curve, as a function: exactly EASE_OPEN, cubic ease-out (motion.test.ts). */
export const easeOpen = (t: number): number => 1 - (1 - t) ** 3;

/** The size `ms` milliseconds into going from `from` to `to`, on opening's curve, whole pixels. */
export function sizeAt(from: number, to: number, elapsed: number, ms = OPEN_MS): number {
  const t = Math.min(1, Math.max(0, elapsed / ms));
  return Math.round(from + (to - from) * easeOpen(t));
}

/** A size being played out: `finish` jumps it to its end at once (a second toggle while it runs). */
export interface Playing {
  readonly done: Promise<void>;
  finish(): void;
}

/**
 * Plays a size from `from` to `to`: `apply` gets the first size at once, before anything is
 * painted, then one per frame, and `to` last. `frames` is the window's requestAnimationFrame.
 */
export function play(
  from: number,
  to: number,
  apply: (size: number) => void,
  frames: { request(cb: () => void): number; cancel(id: number): void; now(): number },
  ms = OPEN_MS,
): Playing {
  const start = frames.now();
  let id = 0;
  let end!: () => void;
  const done = new Promise<void>((resolve) => (end = resolve));
  let over = false;
  const finish = () => {
    if (over) return;
    over = true;
    frames.cancel(id);
    apply(to);
    end();
  };
  // Time from `now`, not the frame's own stamp: one clock for the start and every frame.
  const step = () => {
    const now = frames.now();
    if (now - start >= ms) return finish();
    apply(sizeAt(from, to, now - start, ms));
    id = frames.request(step);
  };
  apply(from);
  id = frames.request(step);
  return { done, finish };
}
