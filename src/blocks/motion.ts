/**
 * How every block moves, in one place (spec §9: no fade; owner, 2026-11-04: lean before smooth).
 * Only the compositor's properties move (transform, clip-path): VS Code lays a change out once, at
 * its end, and a block is drawn sliding or uncovered toward it, so nothing is laid out while it
 * moves. What opens or arrives takes OPEN_MS, coming at once and landing softly (cubic ease-out);
 * what closes or leaves takes CLOSE_MS on the same curve played backwards (cubic ease-in), so a
 * close reads as its open reversed. The side blocks (blockStretch.ts), the editor's blocks
 * (blockMove.ts), its tabs (tabMove.ts), the tool strip (toolStrip.ts) and the floating blocks
 * (layer.ts) take it from here, and the CSS from MOTION_PROPERTIES.
 */
export const OPEN_MS = 180;
export const CLOSE_MS = 140;

/** Opening, for the frame loops and as CSS (exactly cubic ease-out). */
export const easeOpen = (t: number) => 1 - Math.pow(1 - t, 3);
export const EASE_OPEN = "cubic-bezier(.33, 1, .68, 1)";

/** Closing: opening's curve played backwards (exactly cubic ease-in). */
export const easeClose = (t: number) => t * t * t;
export const EASE_CLOSE = "cubic-bezier(.32, 0, .67, 0)";

/** Opening's or closing's timing, for an element's `animate`. */
export const opening: KeyframeAnimationOptions = { duration: OPEN_MS, easing: EASE_OPEN };
export const closing: KeyframeAnimationOptions = { duration: CLOSE_MS, easing: EASE_CLOSE };

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

/** Whether the window moves: VS Code takes monaco-enable-motion off for the OS's or VS Code's reduced motion. */
export function moving(workbench: HTMLElement): boolean {
  return workbench.classList.contains("monaco-enable-motion");
}
