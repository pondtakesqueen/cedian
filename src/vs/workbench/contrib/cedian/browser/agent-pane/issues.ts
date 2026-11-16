// The Issues card (`/issues`, as the mockup draws it): the repository's issues with search and
// three tabs, one issue with its labels, assignees, milestone, linked PRs and comments, Comment,
// Close as and Reopen, New issue, and Start a thread with the issue as its task. The daemon reads
// and acts through the person's own `gh` (`Request::Issues`, `Issue`, `IssueAct`, `NewIssue`).
import { button, el } from "../dom/el.js";
import type { CloseReason, IssueAction, IssueFilter, IssueSummary, IssueView, NewIssue } from "../protocol/wire.js";

export type IssueTab = "open" | "closed" | "assigned";

/** What the card keeps between draws. */
export interface IssuesUi {
  tab: IssueTab;
  search: string;
  list?: IssueSummary[] | string;
  /** The issue open in the card, and it as last read. */
  open?: number;
  view?: IssueView | string;
  /** The New issue form is showing. */
  writing: boolean;
  busy?: string;
  failed?: string;
  closeMenu: boolean;
  /** What the person has typed, kept across draws. */
  draft: string;
  newTitle: string;
  newBody: string;
}

/** A GitHub body as the card shows it: without the HTML comments GitHub hides. */
export function bodyText(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, "").trim();
}

export const newIssuesUi = (): IssuesUi => ({ tab: "open", search: "", writing: false, closeMenu: false, draft: "", newTitle: "", newBody: "" });

export function filterOf(ui: IssuesUi): IssueFilter {
  return { state: ui.tab === "closed" ? "closed" : "open", assigned: ui.tab === "assigned", search: ui.search };
}

export interface IssuesHandlers {
  /** Asks for the list again with the card's filter. */
  list(): void;
  open(number: number): void;
  act(number: number, action: IssueAction, label: string): void;
  create(issue: NewIssue): void;
  /** Starts a thread with the issue as its task. */
  start(view: IssueView): void;
  /** The thread of this project on that PR, when there is one. */
  threadOf(pr: number): { label: string; open(): void } | undefined;
  openUrl(url: string): void;
  redraw(): void;
  close(): void;
}

/** "2h ago", "yesterday", "3d ago", from GitHub's RFC 3339 time. */
export function ago(at: string, now = Date.now()): string {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

/** The task a thread started from the issue gets; its PR then closes the issue. */
export function issueTask(v: IssueView): string {
  const talk = v.comments.map((c) => `${c.author}: ${c.body}`).join("\n");
  return [`Fix issue #${v.number}: ${v.title}`, v.body, talk && `Comments:\n${talk}`, `When you open the pull request, say "Fixes #${v.number}" in its description.`].filter(Boolean).join("\n\n");
}

const TAB_LABEL: Record<IssueTab, string> = { open: "Open", closed: "Closed", assigned: "Assigned to me" };

export function issuesCard(d: Document, ui: IssuesUi, h: IssuesHandlers): HTMLElement {
  const card = el(d, "div", "card issues");
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", "Issues");
  const head = el(d, "div", "row");
  head.append(el(d, "span", "grow", "Issues"));
  if (!ui.writing) head.append(button(d, "New issue", () => ((ui.writing = true), (ui.open = undefined), h.redraw()), "btn small"));
  head.append(button(d, "Close", () => h.close(), "btn small flat"));
  card.append(head);
  if (ui.failed) card.append(el(d, "div", "small bad", ui.failed));
  if (ui.writing) card.append(newIssueForm(d, ui, h));
  else if (ui.open !== undefined) card.append(issueView(d, ui, h));
  else card.append(...listView(d, ui, h));
  return card;
}

function listView(d: Document, ui: IssuesUi, h: IssuesHandlers): HTMLElement[] {
  const search = el(d, "input", "input");
  search.placeholder = "Search issues";
  search.setAttribute("aria-label", "Search issues");
  search.value = ui.search;
  search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    ui.search = search.value;
    h.list();
  });
  const tabs = el(d, "div", "row tabs");
  tabs.setAttribute("role", "tablist");
  for (const id of ["open", "closed", "assigned"] as const) {
    const count = ui.tab === id && Array.isArray(ui.list) ? ` ${ui.list.length}` : "";
    const b = button(d, `${TAB_LABEL[id]}${count}`, () => {
      ui.tab = id;
      h.list();
    }, `tab${ui.tab === id ? " on" : ""}`);
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(ui.tab === id));
    tabs.append(b);
  }
  const out: HTMLElement[] = [search, tabs];
  if (ui.list === undefined) out.push(el(d, "div", "small", "Asking GitHub…"));
  else if (typeof ui.list === "string") out.push(el(d, "div", "small bad", ui.list));
  else if (!ui.list.length) out.push(el(d, "div", "small", ui.search ? "No issues match" : ui.tab === "assigned" ? "Nothing is assigned to you" : `No ${ui.tab} issues`));
  else for (const i of ui.list) out.push(row(d, i, h));
  return out;
}

function row(d: Document, i: IssueSummary, h: IssuesHandlers): HTMLElement {
  const box = el(d, "div", "issue-row");
  const top = el(d, "div", "row");
  top.append(el(d, "span", i.state === "open" ? "ok" : "small", i.state === "open" ? "●" : "✓"));
  top.append(button(d, i.title, () => h.open(i.number), "link ell grow"));
  for (const l of i.labels) top.append(el(d, "span", "tag", l));
  const by = i.mine ? "you" : i.author;
  const talk = i.comments ? ` · ${i.comments} ${i.comments === 1 ? "comment" : "comments"}` : "";
  box.append(top, el(d, "div", "small m", `#${i.number} · opened ${ago(i.created)} by ${by}${talk}`));
  return box;
}

function issueView(d: Document, ui: IssuesUi, h: IssuesHandlers): HTMLElement {
  const box = el(d, "div", "issue");
  const back = button(d, "← All issues", () => ((ui.open = undefined), (ui.view = undefined), h.list()), "btn small flat");
  box.append(back);
  const v = ui.view;
  if (v === undefined) {
    box.append(el(d, "div", "small", "Reading the issue…"));
    return box;
  }
  if (typeof v === "string") {
    box.append(el(d, "div", "small bad", v));
    return box;
  }
  const busy = !!ui.busy;
  const act = (action: IssueAction, label: string) => h.act(v.number, action, label);
  const head = el(d, "div", "row");
  head.append(el(d, "span", `tag issue-${v.state}`, v.state === "open" ? "Open" : v.state_reason === "not_planned" ? "Closed · not planned" : "Closed"), el(d, "span", "ell grow", `#${v.number} ${v.title}`), button(d, "GitHub ↗", () => h.openUrl(v.url), "link small"));
  box.append(head);
  box.append(el(d, "div", "small", `${v.author} · description`), el(d, "div", "ans", bodyText(v.body) || "No description"));

  // Labels, assignees, milestone and linked PRs.
  const labels = el(d, "div", "row small wrap");
  // Labels, assignees and close are GitHub's triage rights; Comment is anyone's.
  const triage = v.can_triage;
  for (const l of v.labels) {
    const tag = el(d, "span", "tag", l);
    labels.append(tag);
    if (!triage) continue;
    const x = button(d, "×", () => act({ do: "labels", add: [], remove: [l] }, `Label ${l}`), "link small");
    x.setAttribute("aria-label", `Remove label ${l}`);
    x.disabled = busy;
    tag.append(x);
  }
  const more = triage ? v.repo_labels.filter((l) => !v.labels.includes(l)) : [];
  if (more.length) {
    const pick = el(d, "select", "sel small");
    pick.setAttribute("aria-label", "Add a label");
    pick.append(el(d, "option", "", "+ Label"));
    for (const l of more) {
      const o = el(d, "option", "", l);
      o.value = l;
      pick.append(o);
    }
    pick.disabled = busy;
    pick.addEventListener("change", () => pick.value !== "+ Label" && act({ do: "labels", add: [pick.value], remove: [] }, `Label ${pick.value}`));
    labels.append(pick);
  }
  box.append(labels);
  const people = el(d, "div", "row small wrap");
  people.append(el(d, "span", "m", "Assignee"));
  for (const a of v.assignees) {
    const tag = el(d, "span", "tag", a);
    people.append(tag);
    if (!triage) continue;
    const x = button(d, "×", () => act({ do: "assignees", add: [], remove: [a] }, `Assign ${a}`), "link small");
    x.setAttribute("aria-label", `Unassign ${a}`);
    x.disabled = busy;
    tag.append(x);
  }
  if (!v.assignees.length) people.append(el(d, "span", "", "No one"));
  if (triage && v.me && !v.assignees.includes(v.me)) {
    const me = button(d, "Assign me", () => act({ do: "assignees", add: [v.me], remove: [] }, "Assign me"), "link small");
    me.disabled = busy;
    people.append(me);
  }
  if (v.milestone) people.append(el(d, "span", "", `Milestone: ${v.milestone}`));
  box.append(people);
  for (const pr of v.linked) {
    const line = el(d, "div", "row small");
    line.append(el(d, "span", "m", "Linked:"), button(d, `#${pr.number} ${pr.title}`, () => h.openUrl(pr.url), "link ell"));
    const thread = h.threadOf(pr.number);
    if (thread) line.append(button(d, `· ${thread.label}`, () => thread.open(), "link small"));
    box.append(line);
  }

  for (const c of v.comments) box.append(el(d, "div", "small", `${c.author} · ${ago(c.at)}`), el(d, "div", "ans", c.body));

  // Comment, Close as, Reopen and Start a thread.
  const text = el(d, "textarea", "input");
  text.rows = 2;
  text.placeholder = "Comment";
  text.setAttribute("aria-label", "Comment on the issue");
  text.value = ui.draft;
  text.addEventListener("input", () => (ui.draft = text.value));
  const row = el(d, "div", "row wrap");
  const label = (l: string) => (ui.busy === l ? `${l}…` : l);
  const comment = button(d, label("Comment"), () => text.value.trim() && act({ do: "comment", body: text.value.trim() }, "Comment"), "btn small");
  row.append(comment);
  // Its author may close and reopen it without triage.
  const closer = triage || (!!v.me && v.me === v.author);
  if (!closer) {
    // No Close as or Reopen: GitHub would refuse them.
  } else if (v.state === "open") {
    const closeAs = button(d, ui.busy === "Close" ? "Closing…" : "Close as ▾", () => ((ui.closeMenu = !ui.closeMenu), h.redraw()), "btn small");
    closeAs.setAttribute("aria-expanded", String(ui.closeMenu));
    row.append(closeAs);
    if (ui.closeMenu) {
      const close = (reason: CloseReason, l: string) => button(d, l, () => ((ui.closeMenu = false), act({ do: "close", reason, body: text.value.trim() }, "Close")), "btn small flat");
      row.append(close("completed", "Completed"), close("not_planned", "Not planned"));
    }
  } else row.append(button(d, label("Reopen"), () => act({ do: "reopen" }, "Reopen"), "btn small"));
  for (const b of row.querySelectorAll("button")) b.disabled = busy;
  const grow = el(d, "span", "grow");
  const start = button(d, "Start a thread", () => h.start(v), "btn small primary");
  row.append(grow, start);
  box.append(text, row, el(d, "div", "small m", `Start a thread puts the issue in a new thread's message, for you to send; its PR says "Fixes #${v.number}".`));
  return box;
}

function newIssueForm(d: Document, ui: IssuesUi, h: IssuesHandlers): HTMLElement {
  const box = el(d, "div", "issue-new");
  const title = el(d, "input", "input");
  title.placeholder = "Title";
  title.setAttribute("aria-label", "Issue title");
  title.value = ui.newTitle;
  title.addEventListener("input", () => (ui.newTitle = title.value));
  const body = el(d, "textarea", "input");
  body.rows = 4;
  body.placeholder = "Description";
  body.setAttribute("aria-label", "Issue description");
  body.value = ui.newBody;
  body.addEventListener("input", () => (ui.newBody = body.value));
  const row = el(d, "div", "row");
  const create = button(d, ui.busy === "New issue" ? "Opening…" : "Open issue", () => {
    if (title.value.trim()) h.create({ title: title.value.trim(), body: body.value.trim(), labels: [] });
  }, "btn small primary");
  create.disabled = !!ui.busy;
  row.append(el(d, "span", "grow"), button(d, "Cancel", () => ((ui.writing = false), h.redraw()), "btn small flat"), create);
  box.append(title, body, row);
  return box;
}
