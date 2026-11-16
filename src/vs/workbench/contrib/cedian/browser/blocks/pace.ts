/**
 * Whether the machine keeps up with the window's motion (owner, 2026-11-06: "why does it hang"; a
 * Mac busy with other work dropped frames for up to 0.9 s a toggle). Frames are timed only while a
 * block moves, from its second frame (its first waits on VS Code's own layout, which is not the
 * motion's). A move that drops frames makes the window switch at once for a while, so a busy
 * machine is never shown a block crawling into place.
 */

/** One frame this long, or two of SLOW_MS, in a move: the machine is busy. */
export const STALL_MS = 100;
export const SLOW_MS = 50;
/** How long the window then switches at once before it moves again. */
export const REST_MS = 5000;

export class Pace {
  private until = -Infinity;
  private watching = false;

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly frame: (f: (t: number) => void) => unknown = (f) => requestAnimationFrame(f),
  ) {}

  /** Moves are being skipped. */
  busy(): boolean {
    return this.now() < this.until;
  }

  /** The frame gaps of one move, in ms, its first left out: busy if it dropped frames. */
  judge(gaps: readonly number[]): void {
    if (gaps.some((g) => g >= STALL_MS) || gaps.filter((g) => g >= SLOW_MS).length >= 2) {
      this.until = this.now() + REST_MS;
    }
  }

  /** Times `run`'s frames until it ends, then judges them. One move at a time. */
  watch(run: Animation): void {
    if (this.watching) {
      return;
    }
    this.watching = true;
    const gaps: number[] = [];
    let last: number | undefined;
    const tick = (t: number) => {
      if (last !== undefined) {
        gaps.push(t - last);
      }
      last = t;
      if (run.playState === "running") {
        this.frame(tick);
        return;
      }
      this.watching = false;
      this.judge(gaps);
    };
    // Its first frame is left out: it carries the layout of the change it shows.
    this.frame(() => this.frame(tick));
  }
}

/** The window's. */
export const pace = new Pace();
