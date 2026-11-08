// The window's floating blocks as `desktop.layout` keeps them (spec §5.5, §9 State ownership):
// per project slug, which blocks float, where they rest and how big they are, so a new window
// opens them where they were. The daemon writes it; the window only reads it and asks for a write.
import { projectSlug, recordOf as record, type Desktop } from "../settings/desktop.js";
import { isCorner, type Rest, type Size } from "./pip.js";

/** One floating block: its kind ("browser"), which one it shows (an agent's thread), where it
 * rests, and its size. */
export interface Floating extends Rest, Size {
  kind: string;
  id?: string;
}

/** A project's entry in `desktop.layout`; keys other than `pip` are kept as they are. */
export interface ProjectLayout {
  pip?: Floating[];
  [key: string]: unknown;
}

const px = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 10_000 ? Math.round(value) : undefined);

export function floatingOf(value: unknown): Floating | undefined {
  const r = record(value);
  if (!r || typeof r.kind !== "string" || !r.kind || !isCorner(r.corner)) return undefined;
  const width = px(r.width);
  const height = px(r.height);
  if (width === undefined || height === undefined) return undefined;
  const f: Floating = { kind: r.kind, corner: r.corner, width, height };
  if (r.stash === "left" || r.stash === "right") f.stash = r.stash;
  if (typeof r.id === "string" && r.id) f.id = r.id;
  return f;
}

/** A saved `pip` list as blocks, one per kind; anything malformed is left out. */
export function floatingList(list: unknown): Floating[] {
  const seen = new Set<string>();
  const out: Floating[] = [];
  for (const item of Array.isArray(list) ? list : []) {
    const f = floatingOf(item);
    if (f && !seen.has(f.kind)) {
      seen.add(f.kind);
      out.push(f);
    }
  }
  return out;
}

/** A copy of the project at `root`'s entry in `desktop.layout`, empty if it has none. */
export function projectLayout(desktop: Desktop, root: string): ProjectLayout {
  return { ...(record(record(desktop.layout)?.[projectSlug(root)]) ?? {}) };
}

/** `desktop.layout` with the project at `root`'s entry as `change` leaves it, the rest as it was. */
export function withProjectLayout(desktop: Desktop, root: string, change: (project: ProjectLayout) => void): Record<string, unknown> {
  const all = { ...(record(desktop.layout) ?? {}) };
  const project = projectLayout(desktop, root);
  change(project);
  all[projectSlug(root)] = project;
  return all;
}

/** The blocks floating in the project at `root`, one per kind; anything malformed is left out. */
export function floatingIn(desktop: Desktop, root: string): Floating[] {
  return floatingList(projectLayout(desktop, root).pip);
}

/** `desktop.layout` with the project at `root` floating `pip`, the rest as it was. */
export function withFloating(desktop: Desktop, root: string, pip: readonly Floating[]): Record<string, unknown> {
  const all = withProjectLayout(desktop, root, (project) => {
    if (pip.length) project.pip = pip.map((f) => ({ ...f }));
    else delete project.pip;
  });
  const slug = projectSlug(root);
  if (Object.keys(all[slug] as ProjectLayout).length === 0) delete all[slug];
  return all;
}

/** Whether two lists float the same blocks the same way, so an unchanged layout is not written. */
export function sameFloating(a: readonly Floating[], b: readonly Floating[]): boolean {
  return a.length === b.length && a.every((f, i) => {
    const g = b[i];
    return f.kind === g.kind && f.id === g.id && f.corner === g.corner && f.stash === g.stash && f.width === g.width && f.height === g.height;
  });
}
