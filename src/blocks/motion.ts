/**
 * How every block moves, in one place, as a tiling window manager's do (spec §9: no scale, no
 * fade): what opens or arrives stretches or slides in over OPEN_MS, coming at once and landing
 * softly (cubic ease-out); what closes or leaves goes over CLOSE_MS, no jump on its first frame and
 * gone briskly at the end (cubic ease-in-out). The side blocks (blockStretch.ts), the editor's
 * blocks (blockMove.ts), its tabs (tabMove.ts), the tool strip (toolStrip.ts) and the floating
 * blocks (layer.ts) take it from here, and the CSS from MOTION_PROPERTIES.
 */
export const OPEN_MS = 320;
export const CLOSE_MS = 240;

/** Opening, for the frame loops and as CSS (exactly cubic ease-out). */
export const easeOpen = (t: number) => 1 - Math.pow(1 - t, 3);
export const EASE_OPEN = "cubic-bezier(.33, 1, .68, 1)";

/** Closing, for the frame loops and as CSS (exactly cubic ease-in-out). */
export const easeClose = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const EASE_CLOSE = "cubic-bezier(.65, 0, .35, 1)";

/** Opening's or closing's timing, for an element's `animate`. */
export const opening: KeyframeAnimationOptions = { duration: OPEN_MS, easing: EASE_OPEN };
export const closing: KeyframeAnimationOptions = { duration: CLOSE_MS, easing: EASE_CLOSE };

/** The same, for the window's CSS: set on the workbench with the theme's tokens. */
export const MOTION_PROPERTIES: Record<string, string> = {
  "--cedian-motion-open": `${OPEN_MS}ms`,
  "--cedian-motion-close": `${CLOSE_MS}ms`,
  "--cedian-ease-open": EASE_OPEN,
  "--cedian-ease-close": EASE_CLOSE,
};

/** Whether the window moves: VS Code takes monaco-enable-motion off for the OS's or VS Code's reduced motion. */
export function moving(workbench: HTMLElement): boolean {
  return workbench.classList.contains("monaco-enable-motion");
}
