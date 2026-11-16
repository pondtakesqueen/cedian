// The Pull requests card (`/prs`, as the mockup draws it): the repository's open PRs in three
// tabs, To review, Yours and All, each with Review in a thread (a worktree with the PR checked
// out, and a run that reads it) and Open on GitHub.
import { button, el } from "../dom/el.js";
import type { PrList, PrSummary } from "../protocol/wire.js";

export type PrListTab = "to_review" | "mine" | "open";

const TAB_LABEL: Record<PrListTab, string> = { to_review: "To review", mine: "Yours", open: "All open" };
const CI_LABEL: Record<string, string> = { passing: "✓ checks", failing: "✕ checks", pending: "● running", none: "" };

export interface PrListHandlers {
  tab(tab: PrListTab): void;
  review(number: number): void;
  openUrl(url: string): void;
  close(): void;
}

/** The tab to open on: To review when anything waits on the person, else Yours, else All. */
export function firstTab(list: PrList): PrListTab {
  return list.to_review.length ? "to_review" : list.mine.length ? "mine" : "open";
}

export function prListCard(d: Document, list: PrList | string | undefined, tab: PrListTab, h: PrListHandlers): HTMLElement {
  const card = el(d, "div", "card pr-list");
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", "Pull requests");
  const head = el(d, "div", "row");
  head.append(el(d, "span", "grow", "Pull requests"), button(d, "Close", () => h.close(), "btn small flat"));
  card.append(head);
  if (list === undefined) {
    card.append(el(d, "div", "small", "Asking GitHub…"));
    return card;
  }
  if (typeof list === "string") {
    card.append(el(d, "div", "small bad", list));
    return card;
  }
  const tabs = el(d, "div", "row tabs");
  tabs.setAttribute("role", "tablist");
  for (const id of ["to_review", "mine", "open"] as const) {
    const b = button(d, `${TAB_LABEL[id]} ${list[id].length}`, () => h.tab(id), `tab${tab === id ? " on" : ""}`);
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(tab === id));
    tabs.append(b);
  }
  card.append(tabs);
  const shown = list[tab];
  if (!shown.length) card.append(el(d, "div", "small", tab === "to_review" ? "Nothing waits on your review" : "No open pull requests"));
  for (const pr of shown) card.append(row(d, pr, h));
  return card;
}

function row(d: Document, pr: PrSummary, h: PrListHandlers): HTMLElement {
  const box = el(d, "div", "pr-row");
  const top = el(d, "div", "row");
  if (pr.draft) top.append(el(d, "span", "tag", "Draft"));
  top.append(el(d, "span", "ell grow", `#${pr.number} ${pr.title}`));
  const ci = CI_LABEL[pr.ci];
  if (ci) top.append(el(d, "span", `small ${pr.ci === "passing" ? "ok" : pr.ci === "failing" ? "bad" : "warn"}`, ci));
  const meta = `${pr.author} · ${pr.head} → ${pr.base} · +${pr.additions} −${pr.deletions}${pr.review_requested ? " · review requested from you" : ""}`;
  const actions = el(d, "div", "row wrap");
  actions.append(button(d, "Review in a thread", () => h.review(pr.number), "btn small primary"), button(d, "Open", () => h.openUrl(pr.url), "btn small"));
  box.append(top, el(d, "div", "small", meta), actions);
  return box;
}
