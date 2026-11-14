// Where the time goes when the app opens or a project tab is switched: named marks, and from them
// a report of each phase's share. The window marks (vscode/contrib/cedian/browser/launchTiming.ts);
// this module only does the arithmetic, so it is tested without a window.

/** A moment that was reached, in milliseconds on any one clock. */
export interface Mark {
  name: string;
  at: number;
}

/** One phase: when it was reached after the first mark, and how long after the mark before it. */
export interface Phase {
  name: string;
  atMs: number;
  ms: number;
}

export interface PhaseReport {
  /** What was timed: "launch", "tab switch (warm)". */
  what: string;
  totalMs: number;
  phases: Phase[];
  /** The phase that took longest to reach; none without marks. */
  slowest?: string;
}

const round = (ms: number) => Math.round(ms);

export function phaseReport(what: string, marks: Mark[]): PhaseReport {
  const sorted = [...marks].sort((a, b) => a.at - b.at);
  const first = sorted[0];
  if (!first) return { what, totalMs: 0, phases: [] };
  const phases = sorted.map((m, i) => ({ name: m.name, atMs: round(m.at - first.at), ms: round(m.at - (sorted[i - 1] ?? m).at) }));
  const slowest = phases.reduce((a, b) => (b.ms > a.ms ? b : a));
  return { what, totalMs: phases[phases.length - 1]!.atMs, phases, slowest: slowest.name };
}

/** One line for the log: the total, the slowest phase, then each phase with its own time. */
export const formatPhases = (r: PhaseReport): string =>
  [`${r.what} ${r.totalMs} ms${r.slowest ? `, slowest: ${r.slowest}` : ""}`, ...r.phases.map((p) => `${p.name} +${p.ms}`)].join(" | ");

/** Marks gathered as they happen; a name marked twice keeps its first time. */
export class PhaseLog {
  private readonly marks: Mark[] = [];

  constructor(
    readonly what: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  mark(name: string, at: number = this.now()): void {
    if (!this.has(name)) this.marks.push({ name, at });
  }

  has(name: string): boolean {
    return this.marks.some((m) => m.name === name);
  }

  /** The marks as they were made, to put beside marks from another source on the same clock. */
  all(): Mark[] {
    return [...this.marks];
  }

  report(): PhaseReport {
    return phaseReport(this.what, this.marks);
  }
}

/** VS Code's own startup marks worth a line, in the words of the report. */
const VSCODE_MARKS: Record<string, string> = {
  "code/timeOrigin": "process start",
  "code/didStartMain": "main started",
  "code/willOpenNewWindow": "window asked for",
  "code/didStartRenderer": "renderer started",
  "code/didLoadWorkbenchMain": "workbench code loaded",
  "code/didStartWorkbench": "workbench started",
  "code/didRestoreEditors": "editors restored",
};

/** A window asked for this long after the process started is a window of an app already running. */
const WARM_APP_MS = 60_000;

/**
 * VS Code's marks (base/common/performance `getMarks()`, times since the epoch) as marks for a
 * launch report. The process's own start counts only for the window it started with: for a
 * later window (a project tab that had none) the report starts where the window was asked for.
 */
export function launchMarks(vscode: { name: string; startTime: number }[]): Mark[] {
  const marks = vscode.flatMap((m) => (VSCODE_MARKS[m.name] ? [{ name: VSCODE_MARKS[m.name]!, at: m.startTime }] : []));
  const origin = marks.find((m) => m.name === "process start");
  // The last window asked for is this one: the marks are read in the window they describe.
  const asked = marks.filter((m) => m.name === "window asked for").at(-1);
  if (origin && asked && asked.at - origin.at > WARM_APP_MS) return marks.filter((m) => m.at >= asked.at);
  return marks;
}
