/**
 * A block of the window coming or going the way Hyprland's windows do (owner, 2026-11-05, the
 * open/close mockup's H): one that opens grows from POPIN of its size at its own centre, its
 * whole self alike, as it fades in; one that closes shrinks to it as it fades out, over the blocks
 * that take its room (motion.ts). Transform and opacity only, so nothing is laid out meanwhile.
 */
import { EASE_FADE, EASE_WINDOWS, FADE_IN_MS, FADE_OUT_MS, POPIN, WINDOWS_IN_MS, WINDOWS_OUT_MS } from "./motion.js";
import { pace } from "./pace.js";

export type Way = "in" | "out";

/** One motion of a pop: its keyframes and its timing. */
export interface PopPart {
  frames: Keyframe[];
  timing: KeyframeAnimationOptions;
}

/** The two motions of a block popping in or out: its size, and its fade. */
export function popFrames(way: Way): [PopPart, PopPart] {
  const small = { transform: `scale(${POPIN})` };
  const whole = { transform: "none" };
  const size: PopPart = way === "in"
    ? { frames: [small, whole], timing: { duration: WINDOWS_IN_MS, easing: EASE_WINDOWS } }
    : { frames: [whole, small], timing: { duration: WINDOWS_OUT_MS, easing: "linear" } };
  const fade: PopPart = way === "in"
    ? { frames: [{ opacity: 0 }, { opacity: 1 }], timing: { duration: FADE_IN_MS, easing: EASE_FADE } }
    : { frames: [{ opacity: 1 }, { opacity: 0 }], timing: { duration: FADE_OUT_MS, easing: EASE_FADE } };
  return [size, fade];
}

/**
 * Pops `element` in or out. The animation that ends last is returned, to wait on; out, both hold
 * their end until the element is taken away.
 */
export function pop(element: Element, way: Way): Animation {
  const fill: FillMode = way === "out" ? "forwards" : "none";
  const runs = popFrames(way).map((p) => element.animate(p.frames, { ...p.timing, fill }));
  const last = runs.reduce((a, b) => (Number(b.effect?.getTiming().duration) > Number(a.effect?.getTiming().duration) ? b : a));
  pace.watch(last);
  return last;
}
