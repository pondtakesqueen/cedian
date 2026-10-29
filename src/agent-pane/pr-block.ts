// The PR block (spec §11 Phase D: review, merge and issues in Cedian, as the mockup draws it):
// the thread's pull request under its receipt, with its conversation and line-comment threads,
// its checks, and Review and Merge. The daemon reads and acts through the person's own `gh`
// (`Request::PrView`, `Request::PrAct`, `Request::PrLog`); this file only draws and asks.
import { button, el } from "../dom/el.js";
import type { MergeMethod, PrAction, PrThread, PrView, ReviewEvent } from "../protocol/wire.js";

export type PrTab = "conversation" | "checks";

/** What the block keeps between draws: the tab, what is being sent, a log being read. */
export interface PrUi {
  tab: PrTab;
  busy?: string;
  log?: { run: string; text?: string };
  showResolved: boolean;
  method: MergeMethod;
}

export const newPrUi = (): PrUi => ({ tab: "conversation", showResolved: false, method: "squash" });

export interface PrHandlers {
  act(action: PrAction, label: string): void;
  log(run: string): void;
  /** Gives the thread a message to work on (Fix in thread). */
  fix(text: string): void;
  openUrl(url: string): void;
  openDiff(): void;
  redraw(): void;
}

/** Why it can't be merged yet, one line each; empty when it can. */
export function mergeBlockers(v: PrView): string[] {
  const out: string[] = [];
  if (v.state !== "open") return [v.state === "merged" ? "Merged" : "Closed"];
  if (v.draft) out.push("Still a draft");
  if (v.conflict) out.push("Conflicts with the base");
  const failed = v.checks.filter((c) => c.state === "failed").length;
  const pending = v.checks.filter((c) => c.state === "pending").length;
  if (failed) out.push(`${failed} ${failed === 1 ? "check" : "checks"} failed`);
  if (pending) out.push(`${pending} ${pending === 1 ? "check" : "checks"} running`);
  if (v.review_decision === "changes_requested") out.push("Changes requested");
  if (v.review_decision === "review_required") out.push("Review required");
  if (v.behind) out.push("Behind the base");
  return out;
}

export function checkSummary(v: PrView): string {
  const count = (s: string) => v.checks.filter((c) => c.state === s).length;
  const parts = [count("passed") && `${count("passed")} passed`, count("failed") && `${count("failed")} failed`, count("pending") && `${count("pending")} running`];
  return parts.filter(Boolean).join(" · ") || "No checks";
}

/** The message Fix in thread sends for a line comment's thread. */
export function fixText(t: PrThread): string {
  const asks = t.comments.map((c) => `${c.author}: ${c.body}`).join("\n");
  return `Address this review comment on ${t.path}${t.line ? `:${t.line}` : ""}:\n${asks}`;
}

const METHOD_LABEL: Record<MergeMethod, string> = { squash: "Squash and merge", merge: "Create a merge commit", rebase: "Rebase and merge" };

export function prBlock(d: Document, v: PrView, ui: PrUi, h: PrHandlers): HTMLElement {
  const card = el(d, "div", "card pr-block");
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", `Pull request #${v.number}`);
  const busy = (label: string) => ui.busy === label;
  const go = (action: PrAction, label: string) => () => h.act(action, label);
  const btn = (label: string, action: PrAction, cls = "btn small") => {
    const b = button(d, busy(label) ? `${label}…` : label, go(action, label), cls);
    if (ui.busy) b.disabled = true;
    return b;
  };

  // Head: state, number and title, branch and size, reviewers and labels.
  const head = el(d, "div", "row");
  head.append(el(d, "span", `tag pr-${v.draft ? "draft" : v.state}`, v.draft ? "Draft" : v.state[0]!.toUpperCase() + v.state.slice(1)), el(d, "span", "ell grow", `#${v.number} ${v.title}`), button(d, "GitHub ↗", () => h.openUrl(v.url), "link small"));
  card.append(head, el(d, "div", "small m", `${v.head} → ${v.base} · ${v.commits} ${v.commits === 1 ? "commit" : "commits"} · +${v.additions} −${v.deletions}`));
  const people = el(d, "div", "row small wrap");
  for (const r of v.reviewers) people.append(el(d, "span", "tag", `${r.login} · ${r.state ? r.state.replace("_", " ") : "waiting"}`));
  for (const l of v.labels) people.append(el(d, "span", "tag", l));
  if (v.closes.length) people.append(el(d, "span", "", `Fixes ${v.closes.map((n) => `#${n}`).join(", ")}`));
  if (people.childElementCount) card.append(people);

  // Tabs.
  const tabs = el(d, "div", "row tabs");
  tabs.setAttribute("role", "tablist");
  const open = v.threads.filter((t) => !t.resolved);
  const failed = v.checks.filter((c) => c.state === "failed").length;
  const tab = (id: PrTab, label: string) => {
    const b = button(d, label, () => ((ui.tab = id), h.redraw()), `tab${ui.tab === id ? " on" : ""}`);
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(ui.tab === id));
    return b;
  };
  tabs.append(tab("conversation", `Conversation ${v.comments.length + v.threads.length}`), tab("checks", failed ? `Checks · ${failed} failed` : `Checks · ${checkSummary(v)}`), button(d, `Files ${v.changed_files}`, () => h.openDiff(), "tab"));
  card.append(tabs);

  if (ui.tab === "checks") {
    for (const c of v.checks) {
      const row = el(d, "div", "row");
      row.append(el(d, "span", c.state === "passed" ? "ok" : c.state === "failed" ? "bad" : "small", c.state === "passed" ? "✓" : c.state === "failed" ? "✕" : c.state === "pending" ? "●" : "–"), button(d, c.name, () => h.openUrl(c.url), "link m ell grow"));
      if (c.state === "failed" && c.run) {
        const run = c.run;
        row.append(button(d, "Log", () => h.log(run), "btn small"), button(d, "Fix in thread", () => h.fix(`The check ${c.name} failed on PR #${v.number}. Read its log (gh run view ${run} --log-failed), find the cause and fix it.`), "btn small primary"));
      }
      card.append(row);
      if (ui.log?.run === c.run && c.run) card.append(el(d, "pre", "log m small", ui.log?.text ?? "Reading the log…"));
    }
    if (!v.checks.length) card.append(el(d, "div", "small", "No checks on this PR"));
  } else {
    if (v.body) card.append(el(d, "div", "small", `${v.author} · description`), el(d, "div", "ans", v.body));
    for (const c of v.comments) card.append(el(d, "div", "small", c.author), el(d, "div", "ans", c.body));
    for (const t of ui.showResolved ? v.threads : open) card.append(threadView(d, t, ui, h));
    const resolved = v.threads.length - open.length;
    if (resolved) card.append(button(d, ui.showResolved ? "Hide resolved threads" : `${resolved} resolved ${resolved === 1 ? "thread" : "threads"} ▸`, () => ((ui.showResolved = !ui.showResolved), h.redraw()), "btn small flat"));
    // A comment on the conversation, and the person's review on someone else's PR.
    const box = el(d, "textarea", "input");
    box.rows = 2;
    box.placeholder = "Comment on the PR";
    box.setAttribute("aria-label", "Comment on the PR");
    const row = el(d, "div", "row wrap");
    const send = (event: ReviewEvent | undefined, label: string) => {
      const b = button(d, busy(label) ? `${label}…` : label, () => {
        const body = box.value.trim();
        if (event === undefined) {
          if (body) h.act({ do: "comment", body }, label);
        } else h.act({ do: "review", event, body }, label);
      }, event === "request_changes" ? "btn small danger" : "btn small");
      if (ui.busy) b.disabled = true;
      return b;
    };
    row.append(send(undefined, "Comment"));
    if (!v.mine && v.state === "open") row.append(send("approve", "Approve"), send("request_changes", "Request changes"));
    card.append(box, row);
  }

  // Merge: what still blocks it, Update branch, merge when ready, and the merge itself.
  if (v.state === "open") {
    const foot = el(d, "div", "pr-merge");
    const blockers = mergeBlockers(v);
    for (const b of blockers) foot.append(el(d, "div", "small warn", b));
    const row = el(d, "div", "row wrap");
    if (v.draft && v.mine) row.append(btn("Ready for review", { do: "ready" }));
    if (v.behind) row.append(btn("Update branch", { do: "update_branch" }));
    const auto = el(d, "label", "row small grow");
    const box = el(d, "input");
    box.type = "checkbox";
    box.checked = v.auto_merge !== null && v.auto_merge !== undefined;
    box.disabled = !!ui.busy;
    box.addEventListener("change", () => h.act({ do: "auto_merge", method: box.checked ? ui.method : null }, "Merge when ready"));
    auto.append(box, el(d, "span", "", "Merge when ready"));
    const method = el(d, "select", "sel small");
    method.setAttribute("aria-label", "Merge method");
    for (const m of ["squash", "merge", "rebase"] as const) {
      const o = el(d, "option", "", METHOD_LABEL[m]);
      o.value = m;
      method.append(o);
    }
    method.value = ui.method;
    method.addEventListener("change", () => ((ui.method = method.value as MergeMethod), h.redraw()));
    const merge = btn("Merge", { do: "merge", method: ui.method, delete_branch: true }, "btn small primary");
    merge.disabled = merge.disabled || blockers.length > 0;
    merge.title = blockers.length ? blockers.join(" · ") : `${METHOD_LABEL[ui.method]}, then delete ${v.head}`;
    row.append(auto, method, merge);
    foot.append(row);
    card.append(foot);
  }
  return card;
}

function threadView(d: Document, t: PrThread, ui: PrUi, h: PrHandlers): HTMLElement {
  const box = el(d, "div", `pr-thread${t.resolved ? " resolved" : ""}`);
  box.append(el(d, "div", "small m", `${t.path}${t.line ? `:${t.line}` : ""}${t.resolved ? " · resolved" : ""}`));
  const last = t.hunk.split("\n").filter((l) => !l.startsWith("@@")).slice(-3);
  if (last.length) box.append(el(d, "pre", "hunk m small", last.join("\n")));
  for (const c of t.comments) box.append(el(d, "div", "small", c.author), el(d, "div", "ans", c.body));
  const row = el(d, "div", "row wrap");
  const reply = el(d, "input", "input grow");
  reply.placeholder = "Reply…";
  reply.setAttribute("aria-label", `Reply on ${t.path}`);
  const label = `Reply ${t.id}`;
  const send = button(d, ui.busy === label ? "Replying…" : "Reply", () => {
    const body = reply.value.trim();
    if (body) h.act({ do: "reply", thread: t.id, body }, label);
  }, "btn small");
  const fix = button(d, "Fix in thread", () => h.fix(fixText(t)), "btn small primary");
  const resolve = button(d, t.resolved ? "Unresolve" : "Resolve", () => h.act(t.resolved ? { do: "unresolve", thread: t.id } : { do: "resolve", thread: t.id }, `Resolve ${t.id}`), "btn small");
  for (const b of [send, resolve]) b.disabled = !!ui.busy;
  row.append(reply, send, fix, resolve);
  box.append(row);
  return box;
}
