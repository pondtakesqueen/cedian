// The PR panel (after Synara's pull request panel, github.com/Emanuele-web04/synara, MIT): the
// thread's pull request in the right panel, beside the agent, with Summary, Timeline and Code
// tabs. It follows the thread the agent in the middle shows, reads the PR through the daemon
// (`pr_view`, the person's own `gh`) and only draws; merging and reviewing stay in the thread's
// PR block.
import { button, el, type Wire } from "../dom/el.js";
import type { Notice, PrView, Request } from "../protocol/wire.js";
import { ago, bodyText } from "./issues.js";
import { checkSummary, mergeBlockers, blockerTone } from "./pr-block.js";

export type PanelTab = "summary" | "timeline" | "code";

/** One line of the Timeline: a comment on the PR, or one in a line thread. */
export interface TimelineEntry {
  at: string;
  author: string;
  body: string;
  /** `path:line` for a comment on the code. */
  where?: string;
}

/** The PR's comments and its line threads' comments, oldest first. */
export function timeline(v: PrView): TimelineEntry[] {
  const out: TimelineEntry[] = v.comments.map((c) => ({ at: c.at, author: c.author, body: c.body }));
  for (const t of v.threads) {
    const where = t.line ? `${t.path}:${t.line}` : t.path;
    for (const c of t.comments) out.push({ at: c.at, author: c.author, body: c.body, where });
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** The state chip's word and tone. */
export function stateOf(v: PrView): { label: string; tone: string } {
  if (v.state === "merged") return { label: "Merged", tone: "merged" };
  if (v.state === "closed") return { label: "Closed", tone: "closed" };
  return v.draft ? { label: "Draft", tone: "draft" } : { label: "Open", tone: "open" };
}

export interface PanelHandlers {
  tab(tab: PanelTab): void;
  openUrl(url: string): void;
  openDiff(): void;
}

/** The panel's body for one PR. */
export function prPanel(doc: Document, v: PrView, tab: PanelTab, h: PanelHandlers, now = Date.now()): HTMLElement {
  const root = el(doc, "div", "pr-panel-body");
  const bar = el(doc, "div", "pp-bar");
  const tabs = el(doc, "div", "pp-tabs");
  tabs.setAttribute("role", "tablist");
  for (const [id, label] of [["summary", "Summary"], ["timeline", "Timeline"], ["code", "Code"]] as const) {
    const b = button(doc, label, () => h.tab(id), `pp-tab${tab === id ? " on" : ""}`);
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(tab === id));
    tabs.append(b);
  }
  const github = button(doc, "GitHub ↗", () => h.openUrl(v.url), "pp-link");
  github.title = v.url;
  bar.append(tabs, github);
  root.append(bar);
  const body = el(doc, "div", "pp-scroll");
  if (tab === "summary") body.append(...summary(doc, v, now));
  else if (tab === "timeline") body.append(...timelineView(doc, v, now));
  else body.append(...code(doc, v, h));
  root.append(body);
  return root;
}

function row(doc: Document, label: string, value: Node | string, cls = ""): HTMLElement {
  const r = el(doc, "div", `pp-row ${cls}`.trim());
  r.append(el(doc, "span", "pp-key", label));
  const val = el(doc, "span", "pp-val");
  val.append(value);
  r.append(val);
  return r;
}

function counts(doc: Document, v: PrView): HTMLElement {
  const s = el(doc, "span", "pp-counts");
  s.append(el(doc, "span", "pp-add", `+${v.additions.toLocaleString()}`), el(doc, "span", "pp-del", `−${v.deletions.toLocaleString()}`));
  return s;
}

function summary(doc: Document, v: PrView, now: number): HTMLElement[] {
  const state = stateOf(v);
  const head = el(doc, "div", "pp-head");
  head.append(el(doc, "div", "pp-title", `${v.title} `), el(doc, "span", "pp-num", `#${v.number}`));
  const meta = el(doc, "div", "pp-meta");
  meta.append(el(doc, "span", "pp-author", v.author), el(doc, "span", `pp-state s-${state.tone}`, state.label));
  const last = v.comments.at(-1)?.at;
  if (last) meta.append(el(doc, "span", "pp-faint", `active ${ago(last, now)}`));
  const branch = el(doc, "span", "pp-branch");
  branch.append(el(doc, "span", "m", v.head), el(doc, "span", "pp-faint", " › "), el(doc, "span", "m", v.base), counts(doc, v));
  const reviewers = v.reviewers.length ? v.reviewers.map((r) => (r.state ? `${r.login} (${r.state.toLowerCase().replace(/_/g, " ")})` : r.login)).join(", ") : "None";
  const comments = v.comments.length + v.threads.reduce((n, t) => n + t.comments.length, 0);
  const failed = v.checks.some((c) => c.state === "failed");
  const running = v.checks.some((c) => c.state === "pending");
  const checks = el(doc, "span", `pp-checks ${failed ? "bad" : running ? "run" : v.checks.length ? "ok" : ""}`.trim(), checkSummary(v));
  const rows = el(doc, "div", "pp-rows");
  rows.append(
    row(doc, "Branch", branch),
    row(doc, "Reviewers", reviewers),
    row(doc, "Comments", `${comments} ${comments === 1 ? "comment" : "comments"}`),
    row(doc, "Checks", checks),
  );
  if (v.labels.length) rows.append(row(doc, "Labels", v.labels.join(", ")));
  const out: HTMLElement[] = [head, meta, rows];
  const blockers = v.state === "open" ? mergeBlockers(v) : [];
  if (blockers.length) {
    const note = el(doc, "div", "pp-blockers");
    for (const b of blockers) note.append(el(doc, "div", `pp-blocker t-${blockerTone(b)}`, b));
    out.push(note);
  }
  const desc = el(doc, "section", "pp-section");
  desc.append(el(doc, "h3", "pp-h", "Description"));
  const text = bodyText(v.body);
  desc.append(el(doc, "div", text ? "pp-text" : "pp-text pp-faint", text || "No description"));
  out.push(desc);
  return out;
}

function timelineView(doc: Document, v: PrView, now: number): HTMLElement[] {
  const out: HTMLElement[] = [];
  const entries = timeline(v);
  if (!entries.length) out.push(el(doc, "div", "pp-empty", "No comments yet"));
  for (const e of entries) {
    const item = el(doc, "div", "pp-event");
    const who = el(doc, "div", "pp-who");
    who.append(el(doc, "span", "pp-author", e.author), el(doc, "span", "pp-faint", ago(e.at, now)));
    if (e.where) who.append(el(doc, "span", "pp-where m", e.where));
    item.append(who, el(doc, "div", "pp-text", bodyText(e.body)));
    out.push(item);
  }
  if (v.history.length) {
    const commits = el(doc, "section", "pp-section");
    commits.append(el(doc, "h3", "pp-h", `${v.commits} ${v.commits === 1 ? "commit" : "commits"}`));
    for (const c of v.history) {
      const r = el(doc, "div", "pp-commit");
      r.append(el(doc, "span", "pp-oid m", c.oid.slice(0, 7)), el(doc, "span", "pp-headline", c.headline), el(doc, "span", "pp-faint", c.author));
      commits.append(r);
    }
    out.push(commits);
  }
  return out;
}

function code(doc: Document, v: PrView, h: PanelHandlers): HTMLElement[] {
  const head = el(doc, "div", "pp-code-head");
  const files = el(doc, "span", "", `${v.changed_files} ${v.changed_files === 1 ? "file" : "files"} changed`);
  head.append(files, counts(doc, v), el(doc, "span", "sp"), button(doc, "Open diff", () => h.openDiff(), "btn small primary"));
  const out: HTMLElement[] = [head];
  const byPath = new Map<string, typeof v.threads>();
  for (const t of v.threads) byPath.set(t.path, [...(byPath.get(t.path) ?? []), t]);
  if (!byPath.size) out.push(el(doc, "div", "pp-empty", "No comments on the code"));
  for (const [path, threads] of byPath) {
    const file = el(doc, "section", "pp-file");
    file.append(el(doc, "div", "pp-path m", path));
    for (const t of threads) {
      const first = t.comments[0];
      const r = el(doc, "div", `pp-thread${t.resolved ? " resolved" : ""}`);
      r.append(el(doc, "span", "pp-line m", t.line ? `L${t.line}` : "file"), el(doc, "span", "pp-headline", first ? `${first.author}: ${bodyText(first.body)}` : ""));
      if (t.resolved) r.append(el(doc, "span", "pp-faint", "resolved"));
      file.append(r);
    }
    out.push(file);
  }
  return out;
}

/** What the panel needs from the window: which thread the agent shows, and where links go. */
export interface PrPanelHost {
  cwd: string;
  thread(): string | undefined;
  openUrl(url: string): void;
  openDiff(thread: string, view: PrView): void;
}

/** The panel: it reads the PR of the thread the agent shows, and draws it again on each answer. */
export class PrPanel {
  readonly root: HTMLElement;
  private shown?: string;
  private view: PrView | null | string | undefined;
  private tab: PanelTab = "summary";
  private readonly off: () => void;

  constructor(private readonly doc: Document, private readonly wire: Wire<Request, Notice>, private readonly host: PrPanelHost) {
    this.root = el(doc, "div", "cedian-pr-panel");
    this.off = wire.onAny((n) => {
      if (n.kind === "pr_view" && n.thread === this.shown) {
        this.view = "Ok" in n.view ? n.view.Ok : n.view.Err;
        this.render();
      } else if (host.thread() !== this.shown) this.follow();
    });
    this.follow();
  }

  /** Reads the PR again when the agent shows another thread; the window calls it on a change. */
  refresh(): void {
    if (this.host.thread() !== this.shown) this.follow();
  }

  dispose(): void {
    this.off();
    this.root.remove();
  }

  private follow(): void {
    this.shown = this.host.thread();
    this.view = undefined;
    if (this.shown) this.wire.request({ op: "pr_view", cwd: this.host.cwd, thread: this.shown });
    this.render();
  }

  private render(): void {
    const d = this.doc;
    const empty = (text: string) => this.root.replaceChildren(el(d, "div", "pp-empty", text));
    if (!this.shown) return empty("Open a thread to see its pull request");
    if (this.view === undefined) return empty("Reading the pull request…");
    if (this.view === null) return empty("This thread has no pull request yet");
    if (typeof this.view === "string") return empty(`Couldn't read the pull request: ${this.view}`);
    const view = this.view;
    const thread = this.shown;
    this.root.replaceChildren(
      prPanel(d, view, this.tab, {
        tab: (t) => {
          this.tab = t;
          this.render();
        },
        openUrl: (url) => this.host.openUrl(url),
        openDiff: () => this.host.openDiff(thread, view),
      }),
    );
  }
}
