// The Threads list (the prototype's left column, laid out as Synara's sidebar,
// github.com/Emanuele-web04/synara, MIT): a new thread and the project chat on top, then what needs
// the person and what is at work, then the finished threads by day (Today, Yesterday, Earlier),
// each row with a second line for its PR and worktree. It opens a thread in the agent in the
// middle; the agent says which one shows, and the list marks it.
import { button, el, type Wire } from "../dom/el.js";
import { icon } from "./icons.js";
import type { Notice, Request, ThreadInfo } from "../protocol/wire.js";
import { todoCard } from "./cards.js";
import { COORDINATOR, coordinatorThread } from "./project-chat.js";
import { isBusy, newestFirst } from "./status.js";

export type ThreadGroup = "needs" | "working" | "done";
/** A section: the two that need looking at, then the finished threads by the day they ended. */
export type ThreadSectionId = "needs" | "working" | "today" | "yesterday" | "earlier";

export interface ThreadRow {
  id: string;
  title: string;
  status: ThreadInfo["status"];
  /** What the row says on its right: `3/5` from its todo list, else why it needs the person. */
  note?: string;
  /** Its second line: the PR it follows and the worktree it ran in, when it has either. */
  meta?: string;
}

export interface ThreadSection {
  group: ThreadSectionId;
  label: string;
  rows: ThreadRow[];
}

const LABEL: Record<ThreadSectionId, string> = { needs: "Needs you", working: "Working", today: "Today", yesterday: "Yesterday", earlier: "Earlier" };
const DAY = 86_400_000;

/** The day a finished thread falls in, by local midnight: today, yesterday or before. */
export function dayOf(updatedAt: string | undefined, now: number): "today" | "yesterday" | "earlier" {
  const at = updatedAt ? Date.parse(updatedAt) : NaN;
  if (Number.isNaN(at)) return "earlier";
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  if (at >= midnight.getTime()) return "today";
  return at >= midnight.getTime() - DAY ? "yesterday" : "earlier";
}

/** The row's second line: `#128 · fix-export` from its PR and worktree folder. */
function metaOf(t: ThreadInfo, project: string | undefined): string | undefined {
  const tree = t.cwd && t.cwd !== project ? t.cwd.split("/").filter(Boolean).pop() : undefined;
  const parts = [t.pr ? `#${t.pr.number}` : undefined, tree].filter((p): p is string => !!p);
  return parts.length ? parts.join(" · ") : undefined;
}
const NOTE: Partial<Record<ThreadInfo["status"], string>> = { asking: "asking", failed: "failed", interrupted: "stopped" };

/** Which section a thread is in: waiting on the person, at work, or finished. */
export function groupOf(t: ThreadInfo): ThreadGroup {
  if (t.needs_you || t.status === "asking" || t.status === "failed" || t.status === "interrupted") return "needs";
  if (isBusy(t.status)) return "working";
  return "done";
}

/**
 * The sections: needs you, working, then the finished threads today, yesterday and earlier, each
 * newest first, empty ones left out. The coordinator's thread is the project chat, not a row;
 * archived threads and sub-threads stay out. `query` keeps the rows whose title or task holds it,
 * any case. `project` is the project's folder, so a thread in a worktree names that worktree.
 */
export function threadSections(threads: ThreadInfo[], query = "", now = Date.now(), project?: string): ThreadSection[] {
  const coordinator = coordinatorThread(threads)?.id;
  const q = query.trim().toLowerCase();
  const shown = threads
    .filter((t) => !t.archived && !t.parent && t.id !== coordinator && t.profile !== COORDINATOR)
    .filter((t) => !q || `${t.title} ${t.task}`.toLowerCase().includes(q))
    .sort(newestFirst);
  const sectionOf = (t: ThreadInfo): ThreadSectionId => {
    const group = groupOf(t);
    return group === "done" ? dayOf(t.updated_at, now) : group;
  };
  const ids: ThreadSectionId[] = ["needs", "working", "today", "yesterday", "earlier"];
  return ids
    .map((group) => ({
      group,
      label: LABEL[group],
      rows: shown.filter((t) => sectionOf(t) === group).map((t): ThreadRow => {
        const note = NOTE[t.status] ?? todoCard(t)?.progress;
        const meta = metaOf(t, project);
        return { id: t.id, title: t.title || t.task, status: t.status, ...(note ? { note } : {}), ...(meta ? { meta } : {}) };
      }),
    }))
    .filter((s) => s.rows.length > 0);
}

/** What the list needs from the window: where a pick goes, and which thread shows now. */
export interface ThreadListHost {
  cwd: string;
  open(thread: string): void;
  newThread(): void;
  projectChat(): void;
  /** The thread the agent in the middle shows, to mark it. */
  current(): string | undefined;
}

export class ThreadList {
  readonly root: HTMLElement;
  private threads: ThreadInfo[] = [];
  private readonly search: HTMLInputElement;
  private readonly body: HTMLElement;
  private readonly off: () => void;
  private shown?: string;

  constructor(private readonly doc: Document, wire: Wire<Request, Notice>, private readonly host: ThreadListHost) {
    this.root = el(doc, "div", "cedian-thread-list");
    this.search = el(doc, "input", "search");
    this.search.type = "search";
    this.search.placeholder = "Search threads";
    this.search.setAttribute("aria-label", "Search threads");
    this.search.addEventListener("input", () => this.render());
    this.search.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const first = threadSections(this.threads, this.search.value, Date.now(), host.cwd)[0]?.rows[0];
        if (first) host.open(first.id);
      }
    });
    const top = el(doc, "div", "top");
    const fresh = button(doc, "", () => host.newThread(), "row-btn new");
    fresh.append(icon(doc, "plus"), el(doc, "span", "", "New thread"));
    const chat = button(doc, "", () => host.projectChat(), "row-btn chat");
    chat.append(icon(doc, "chat"), el(doc, "span", "", "Project chat"));
    top.append(fresh, chat, this.search);
    this.body = el(doc, "div", "sections");
    this.body.setAttribute("role", "list");
    this.root.append(top, this.body);
    this.off = wire.onAny((n) => {
      if (n.kind === "threads" && n.cwd === host.cwd) {
        this.threads = n.threads;
        this.render();
      } else if (host.current() !== this.shown) this.render();
    });
    wire.request({ op: "threads", cwd: host.cwd });
    this.render();
  }

  /** Marks the thread the agent shows now; the window calls it when that may have changed. */
  refresh(): void {
    if (this.host.current() !== this.shown) this.render();
  }

  dispose(): void {
    this.off();
    this.root.remove();
  }

  private render(): void {
    const d = this.doc;
    this.shown = this.host.current();
    const sections = threadSections(this.threads, this.search.value, Date.now(), this.host.cwd);
    if (sections.length === 0) {
      this.body.replaceChildren(el(d, "div", "empty", this.search.value.trim() ? "No thread matches" : "No threads yet: start one with New thread"));
      return;
    }
    this.body.replaceChildren(
      ...sections.map((s) => {
        const section = el(d, "section", `group g-${s.group}`);
        const head = el(d, "div", "group-head");
        head.append(el(d, "span", "label", s.label));
        if (s.group === "needs" || s.group === "working") head.append(el(d, "span", "count", String(s.rows.length)));
        section.append(head);
        for (const r of s.rows) {
          const row = button(d, "", () => this.host.open(r.id), `thread-row st-${r.status}${r.id === this.shown ? " on" : ""}`);
          row.setAttribute("role", "listitem");
          if (r.id === this.shown) row.setAttribute("aria-current", "true");
          row.title = r.title;
          const line = el(d, "span", "line");
          line.append(el(d, "span", `dot st-${r.status}`), el(d, "span", "title", r.title));
          if (r.note) line.append(el(d, "span", `note n-${r.status}`, r.note));
          row.append(line);
          if (r.meta) row.append(el(d, "span", "meta", r.meta));
          section.append(row);
        }
        return section;
      }),
    );
  }
}
