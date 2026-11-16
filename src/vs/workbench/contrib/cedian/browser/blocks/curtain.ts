// The curtain over a window that is loading (curtain.ts in the workbench contribution). Switching
// project tabs loads the window again, and until Cedian has laid it out VS Code's own workbench
// shows (its watermark, an activity bar, unstyled headers) and then jumps into Cedian's layout;
// the old window, shutting down, drops Cedian's styling first. While the curtain is down every
// part but the title bar is hidden (workbench.css), so the frame and the project tabs show and
// the rest appears once, laid out. Blocks don't move while it is down: nothing pops in on load.

/** On the main window's workbench while it loads or shuts down. */
export const CURTAIN = "cedian-curtain";
/** On it for one fade as the curtain lifts (with motion only). */
export const LIFTING = "cedian-curtain-lifting";
/** The longest the curtain stays down from the restore phase, whatever is still loading. */
export const CURTAIN_MAX_MS = 2000;
/** The fade as it lifts. */
export const LIFT_MS = 120;

export const curtainDown = (workbench: HTMLElement): boolean => workbench.classList.contains(CURTAIN);

/** Puts the curtain down. */
export function lower(workbench: HTMLElement): void {
  workbench.classList.remove(LIFTING);
  workbench.classList.add(CURTAIN);
}

/** Lifts it, fading the window in when it moves; true when it was down. */
export function lift(workbench: HTMLElement, fade: boolean, later: (run: () => void, ms: number) => unknown = setTimeout): boolean {
  if (!curtainDown(workbench)) return false;
  workbench.classList.remove(CURTAIN);
  if (fade) {
    workbench.classList.add(LIFTING);
    later(() => workbench.classList.remove(LIFTING), LIFT_MS + 40);
  }
  return true;
}
