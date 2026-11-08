// Named layouts (spec §3.3, ARCHITECTURE "Named layouts"): each project keeps several arrangements
// of the window by name, and the person switches between them (⌘⌥1–9, or Switch Layout). A layout
// is what is open where, not a look: the editor area's split (VS Code's `EditorGroupLayout`, kept
// as the workbench gives it) and the blocks floating over it. Kept in `desktop.layout` beside
// `pip`, per project slug: `layouts` and the `current` one's name. The daemon writes it; the window
// reads it and asks for a write.
import { recordOf as record, type Desktop } from "../settings/desktop.js";
import { floatingList, projectLayout, withProjectLayout, type Floating } from "./layout.js";

export interface NamedLayout {
  name: string;
  /** The blocks floating over the editor area, as `pip` keeps them. */
  pip: Floating[];
  /** The editor area's split as the workbench gives it (`IEditorGroupsService.getLayout()`); none
   * leaves the split as it is. */
  groups?: unknown;
}

/** At most this many layouts per project; ⌘⌥1–9 reach the first nine. */
export const MAX_LAYOUTS = 20;

const row = (size = 1) => ({ size });
/** VS Code's `EditorGroupLayout`: one group, or two side by side. */
const ONE = { orientation: 0, groups: [row()] };
const TWO = { orientation: 0, groups: [row(0.5), row(0.5)] };

/**
 * What a project starts with, before it saves its own (the old app's four): Focus, one editor and
 * nothing floating; Code, two editors side by side; Preview, one editor with the Browser block
 * floating bottom right; Review, two editors with the Browser stashed.
 */
export const STARTERS: readonly NamedLayout[] = [
  { name: "Focus", pip: [], groups: ONE },
  { name: "Code", pip: [], groups: TWO },
  { name: "Preview", pip: [{ kind: "browser", corner: "br", width: 480, height: 360 }], groups: ONE },
  { name: "Review", pip: [{ kind: "browser", corner: "br", stash: "right", width: 480, height: 360 }], groups: TWO },
];

/**
 * The starters' names before the app went all English. A project that saved a layout kept the
 * starters under these names; they read back as the English ones. A name the person chose stays.
 */
const OLD_STARTER_NAMES: Readonly<Record<string, string>> = {
  "\u0e42\u0e1f\u0e01\u0e31\u0e2a": "Focus",
  "\u0e40\u0e02\u0e35\u0e22\u0e19\u0e42\u0e04\u0e49\u0e14": "Code",
  "\u0e1e\u0e23\u0e35\u0e27\u0e34\u0e27": "Preview",
  "\u0e23\u0e35\u0e27\u0e34\u0e27": "Review",
};
const renamed = (name: string): string => OLD_STARTER_NAMES[name] ?? name;

/** A name as kept: trimmed, one line, at most 40 characters; empty when nothing is left. */
export function layoutName(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 40);
}

function layoutOf(value: unknown): NamedLayout | undefined {
  const r = record(value);
  const name = typeof r?.name === "string" ? renamed(layoutName(r.name)) : "";
  if (!r || !name) return undefined;
  return { name, pip: floatingList(r.pip), ...(record(r.groups) ? { groups: r.groups } : {}) };
}

/**
 * The project's layouts in order, and the current one's name; the starters while it has saved
 * none. Anything malformed, and a second layout of one name, is left out.
 */
export function layoutsIn(desktop: Desktop, root: string): { layouts: NamedLayout[]; current?: string } {
  const project = projectLayout(desktop, root);
  const saved = Array.isArray(project.layouts) ? project.layouts : undefined;
  const layouts: NamedLayout[] = [];
  for (const item of saved ?? STARTERS) {
    const l = layoutOf(item);
    if (l && !layouts.some((k) => k.name === l.name) && layouts.length < MAX_LAYOUTS) layouts.push(l);
  }
  const named = typeof project.current === "string" ? renamed(project.current) : undefined;
  const current = named !== undefined && layouts.some((l) => l.name === named) ? named : undefined;
  return { layouts, ...(current ? { current } : {}) };
}

/**
 * `desktop.layout` with `layout` saved in the project (in place of one of its name, else last)
 * and made current. Saving over the starters keeps them, so the first save does not lose them.
 */
export function withLayout(desktop: Desktop, root: string, layout: NamedLayout): Record<string, unknown> {
  const name = layoutName(layout.name);
  const { layouts } = layoutsIn(desktop, root);
  const kept: NamedLayout = { name, pip: layout.pip.map((f) => ({ ...f })), ...(layout.groups !== undefined ? { groups: layout.groups } : {}) };
  const at = layouts.findIndex((l) => l.name === name);
  const next = at >= 0 ? layouts.map((l, i) => (i === at ? kept : l)) : [...layouts, kept].slice(-MAX_LAYOUTS);
  return withProjectLayout(desktop, root, (p) => {
    p.layouts = next;
    p.current = name;
  });
}

/** `desktop.layout` with the layout `name` gone from the project (the current one no longer). */
export function withoutLayout(desktop: Desktop, root: string, name: string): Record<string, unknown> {
  const { layouts, current } = layoutsIn(desktop, root);
  return withProjectLayout(desktop, root, (p) => {
    p.layouts = layouts.filter((l) => l.name !== name);
    if (current === name || p.current === name) delete p.current;
  });
}

/** `desktop.layout` with `name` the project's current layout. */
export function withCurrent(desktop: Desktop, root: string, name: string): Record<string, unknown> {
  return withProjectLayout(desktop, root, (p) => {
    p.current = name;
  });
}
