// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { IssueView } from "../protocol/wire";
import { ago, bodyText, filterOf, issuesCard, issueTask, newIssuesUi, type IssuesHandlers } from "./issues";

const view: IssueView = {
  number: 14, url: "u14", title: "Median is wrong for an even count", body: "median([1, 2, 3, 4]) returns 3.", state: "open", state_reason: null, author: "mai-k",
  labels: ["bug"], assignees: [], milestone: "v1.2", me: "pond", comments: [{ author: "ton-s", body: "Same with an empty array.", at: "2026-10-29T09:00:00Z" }],
  linked: [{ number: 7, title: "Fix median for even counts", url: "u7", head: "fix-median" }], repo_labels: ["bug", "enhancement"], can_triage: true,
};

function handlers(asked: unknown[]): IssuesHandlers {
  return {
    list: () => asked.push("list"), open: (n) => asked.push(`open ${n}`), act: (n, a, l) => asked.push([n, a, l]), create: (i) => asked.push(i), start: (v) => asked.push(`start ${v.number}`),
    threadOf: (pr) => (pr === 7 ? { label: "thread working", open: () => asked.push("thread") } : undefined), openUrl: (u) => asked.push(u), redraw: () => asked.push("redraw"), close: () => asked.push("close"),
  };
}
const click = (root: HTMLElement, text: string) => [...root.querySelectorAll("button")].find((b) => b.textContent === text)!.click();

describe("Issues card", () => {
  it("lists with search and tabs, and opens one", () => {
    const ui = newIssuesUi();
    ui.list = [{ number: 14, url: "u14", title: "Median is wrong", author: "mai-k", mine: false, state: "open", labels: ["bug"], comments: 3, created: new Date(Date.now() - 2 * 3600e3).toISOString() }];
    const asked: unknown[] = [];
    const card = issuesCard(document, ui, handlers(asked));
    expect(card.textContent).toContain("Open 1");
    expect(card.textContent).toContain("#14 · opened 2h ago by mai-k · 3 comments");
    click(card, "Median is wrong");
    click(card, "Assigned to me");
    expect(asked).toEqual(["open 14", "list"]);
    expect(filterOf(ui)).toEqual({ state: "open", assigned: true, search: "" });
  });

  it("reads an issue: labels, Assign me, linked PR and its thread, Close as, Start a thread", () => {
    const ui = { ...newIssuesUi(), open: 14, view };
    const asked: unknown[] = [];
    let card = issuesCard(document, ui, handlers(asked));
    expect(card.textContent).toContain("Milestone: v1.2");
    expect(card.textContent).toContain("Linked:#7 Fix median for even counts· thread working");
    card.querySelector<HTMLSelectElement>("select[aria-label='Add a label']")!.value = "enhancement";
    card.querySelector("select")!.dispatchEvent(new Event("change"));
    click(card, "Assign me");
    click(card, "Close as ▾");
    card = issuesCard(document, ui, handlers(asked));
    click(card, "Not planned");
    click(card, "Start a thread");
    expect(asked).toEqual([
      [14, { do: "labels", add: ["enhancement"], remove: [] }, "Label enhancement"],
      [14, { do: "assignees", add: ["pond"], remove: [] }, "Assign me"],
      "redraw",
      [14, { do: "close", reason: "not_planned", body: "" }, "Close"],
      "start 14",
    ]);
    expect(issueTask(view)).toContain('say "Fixes #14"');
    expect(issueTask(view)).toContain("ton-s: Same with an empty array.");
  });

  it("opens a new issue, and says when times are", () => {
    const ui = { ...newIssuesUi(), writing: true, newTitle: "Mode helper" };
    const asked: unknown[] = [];
    click(issuesCard(document, ui, handlers(asked)), "Open issue");
    expect(asked).toEqual([{ title: "Mode helper", body: "", labels: [] }]);
    const now = Date.parse("2026-10-29T12:00:00Z");
    expect([ago("2026-10-29T11:30:00Z", now), ago("2026-10-28T10:00:00Z", now), ago("2026-10-26T12:00:00Z", now)]).toEqual(["30m ago", "yesterday", "3d ago"]);
  });
  it("shows only what GitHub lets the person do, and hides GitHub's comments", () => {
    const card = issuesCard(document, { ...newIssuesUi(), open: 14, view: { ...view, can_triage: false, body: "<!-- template -->\nSteps" } }, handlers([]));
    const labels = [...card.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).not.toContain("Assign me");
    expect(labels).not.toContain("Close as ▾");
    expect(labels).toContain("Comment");
    expect(card.querySelector("select")).toBeNull();
    expect(card.textContent).not.toContain("template");
    expect(bodyText("<!-- a -->\n_Requested_")).toBe("_Requested_");
  });
});
