/**
 * How every block moves, in one place (owner, 2026-11-04: lean before smooth).
 * Only the compositor's properties move (transform, clip-path, opacity): VS Code lays a change out
 * once, at its start, and a block is drawn sliding or uncovered toward it, so nothing is laid out
 * per frame. What opens or arrives takes OPEN_MS, coming at once and landing softly (cubic
 * ease-out); what closes or leaves takes CLOSE_MS on the same curve played backwards (cubic
 * ease-in), so a close reads as its open reversed. Its tabs (tabMove.ts), the tool strip
 * (toolStrip.ts) and the floating blocks (layer.ts) take it from here, and the CSS from
 * MOTION_PROPERTIES. The window's blocks dividing their room (the side blocks, blockStretch.ts; the
 * editor's blocks, blockMove.ts) move the way Hyprland's tiled windows do (owner, 2026-11-05, the
 * open/close mockup's H, its spring taken out): see WINDOWS_MS below. A machine too busy to keep
 * up switches at once for a while (pace.ts).
 */
import { curtainDown } from "./curtain.js";
import { pace } from "./pace.js";

export const OPEN_MS = 180;
export const CLOSE_MS = 140;

/** Opening, as CSS: exactly cubic ease-out, 1 - (1 - t)³ (motion.test.ts). */
export const EASE_OPEN = "cubic-bezier(.33, 1, .68, 1)";

/** Closing: opening's curve played backwards, exactly cubic ease-in, t³ (motion.test.ts). */
export const EASE_CLOSE = "cubic-bezier(.32, 0, .67, 0)";

/** Opening's or closing's timing, for an element's `animate`. */
export const opening: KeyframeAnimationOptions = { duration: OPEN_MS, easing: EASE_OPEN };
export const closing: KeyframeAnimationOptions = { duration: CLOSE_MS, easing: EASE_CLOSE };

/**
 * The window's blocks dividing their room, timed as Hyprland's defaults (its example config, speed 1
 * = 100 ms) at about half their length (owner, 2026-11-06: 0.5 s a toggle felt slow), on its
 * easeOutQuint curve in place of its spring. A block that opens grows from
 * POPIN of its size at its own centre as it fades in; one that closes shrinks to it as it fades
 * out; the blocks beside them move over WINDOWS_MS, each laid out once at the bigger of its two
 * sizes and cut at its far sides, so its text is never stretched or wrapped again (stretch.ts).
 */
export const WINDOWS_MS = 250;
export const WINDOWS_IN_MS = 215;
export const WINDOWS_OUT_MS = 100;
export const FADE_IN_MS = 120;
export const FADE_OUT_MS = 100;
export const POPIN = 0.87;
/** Hyprland's easeOutQuint: starts fast, lands softly, never past its end. */
export const EASE_WINDOWS = "cubic-bezier(.23, 1, .32, 1)";
/** Hyprland's almostLinear, for its fades. */
export const EASE_FADE = "cubic-bezier(.5, .5, .75, 1)";

/** Blocks moving aside for one that opens or closes. */
export const stretching: KeyframeAnimationOptions = { duration: WINDOWS_MS, easing: EASE_WINDOWS };

/** A press on a button: a short dip, the only scale anywhere (uiarc.dev's press feedback). */
export const PRESS_MS = 90;

/** The same, for the window's CSS: set on the workbench with the theme's tokens. */
export const MOTION_PROPERTIES: Record<string, string> = {
  "--cedian-motion-open": `${OPEN_MS}ms`,
  "--cedian-motion-close": `${CLOSE_MS}ms`,
  "--cedian-motion-press": `${PRESS_MS}ms`,
  "--cedian-ease-open": EASE_OPEN,
  "--cedian-ease-close": EASE_CLOSE,
};

/**
 * Whether the window moves: VS Code takes monaco-enable-motion off for the OS's or VS Code's reduced
 * motion, and a machine that just dropped frames switches at once for a while (pace.ts). Nothing
 * moves while the window loads behind its curtain (curtain.ts).
 */
export function moving(workbench: HTMLElement): boolean {
  return workbench.classList.contains("monaco-enable-motion") && !pace.busy() && !curtainDown(workbench);
}
