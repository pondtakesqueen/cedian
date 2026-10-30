// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { PrAction, PrView } from "../protocol/wire";
import { checkSummary, fixText, mergeBlockers, newPrUi, prBlock, suggestion } from "./pr-block";

const view = (over: Partial<PrView> = {}): PrView => ({
  number: 7, url: "https://github.com/o/r/pull/7", title: "Reset submitting", body: "Why.", state: "open", draft: false, author: "me", mine: false,
  head: "fix-login", base: "main", additions: 18, deletions: 3, commits: 2, changed_files: 2, conflict: false, behind: true, review_decision: "changes_requested",
  reviewers: [{ login: "mai-k", state: "changes_requested" }, { login: "ton-s", state: null }], labels: ["bug"], closes: [14],
  checks: [{ name: "lint", state: "passed", url: "u1", run: "78" }, { name: "e2e", state: "failed", url: "u2", run: "79" }],
  comments: [], threads: [{ id: "PRRT_1", path: "src/a.ts", line: 42, resolved: false, hunk: "@@ -1 +1 @@\n+  x = 1;", comments: [{ author: "mai-k", body: "Use a finally.", at: "" }] }, { id: "PRRT_2", path: "src/b.ts", line: 3, resolved: true, hunk: "", comments: [] }],
  history: [{ oid: "a1b2c3d", headline: "Reset submitting", author: "me" }], auto_merge: null, ...over,
});

function draw(v: PrView) {
  const acts: [PrAction, string][] = [];
  const asks: string[] = [];
  const ui = newPrUi();
  const handlers = { act: (a: PrAction, l: string) => acts.push([a, l]), log: (run: string) => asks.push(`log ${run}`), fix: (t: string) => asks.push(t), openUrl: (u: string) => asks.push(u), openDiff: () => asks.push("diff"), redraw: () => {} };
  const root = () => prBlock(document, v, ui, handlers);
  return { acts, asks, ui, root };
}
const buttons = (root: HTMLElement, text: string) => [...root.querySelectorAll("button")].filter((b) => b.textContent === text);

describe("PR block", () => {
  it("says what blocks the merge", () => {
    expect(mergeBlockers(view())).toEqual(["1 check failed", "Changes requested", "Behind the base"]);
    expect(mergeBlockers(view({ checks: [], review_decision: "approved", behind: false }))).toEqual([]);
    expect(mergeBlockers(view({ state: "merged" }))).toEqual(["Merged"]);
    expect(checkSummary(view())).toBe("1 passed · 1 failed");
    expect(fixText(view().threads[0]!)).toBe("Address this review comment on src/a.ts:42:\nmai-k: Use a finally.");
  });

  it("draws the conversation with open threads, and reviews someone else's PR", () => {
    const { acts, asks, root } = draw(view());
    const r = root();
    expect(r.textContent).toContain("#7 Reset submitting");
    expect(r.textContent).toContain("fix-login → main · 2 commits · +18 −3");
    expect(r.textContent).toContain("ton-s · waiting");
    expect(r.textContent).toContain("Fixes #14");
    expect(r.querySelectorAll(".pr-thread")).toHaveLength(1);
    expect(r.textContent).toContain("1 resolved thread ▸");
    const reply = r.querySelector<HTMLInputElement>(".pr-thread input")!;
    reply.value = "Done";
    buttons(r, "Reply")[0]!.click();
    expect(acts.at(-1)).toEqual([{ do: "reply", thread: "PRRT_1", body: "Done" }, "Reply PRRT_1"]);
    buttons(r, "Resolve")[0]!.click();
    expect(acts.at(-1)![0]).toEqual({ do: "resolve", thread: "PRRT_1" });
    buttons(r, "Fix in thread")[0]!.click();
    expect(asks.at(-1)).toContain("Address this review comment on src/a.ts:42");
    buttons(r, "Approve")[0]!.click();
    expect(acts.at(-1)).toEqual([{ do: "review", event: "approve", body: "" }, "Approve"]);
    // Merge waits while something blocks it; Update branch is offered when behind.
    expect(buttons(r, "Merge")[0]!.disabled).toBe(true);
    buttons(r, "Update branch")[0]!.click();
    expect(acts.at(-1)![0]).toEqual({ do: "update_branch" });
  });

  it("never offers Approve on the person's own PR, and merges once nothing blocks it", () => {
    const { acts, root } = draw(view({ mine: true, checks: [], review_decision: "approved", behind: false }));
    const r = root();
    expect(buttons(r, "Approve")).toHaveLength(0);
    const merge = buttons(r, "Merge")[0]!;
    expect(merge.disabled).toBe(false);
    merge.click();
    expect(acts.at(-1)![0]).toEqual({ do: "merge", method: "squash", delete_branch: true });
    const auto = r.querySelector<HTMLInputElement>(".pr-merge input[type=checkbox]")!;
    auto.checked = true;
    auto.dispatchEvent(new Event("change"));
    expect(acts.at(-1)![0]).toEqual({ do: "auto_merge", method: "squash" });
  });

  it("lists the checks, with a failed one's log and Fix in thread", () => {
    const { asks, ui, root } = draw(view());
    ui.tab = "checks";
    const r = root();
    buttons(r, "Log")[0]!.click();
    expect(asks.at(-1)).toBe("log 79");
    ui.log = { run: "79", text: "error TS2322" };
    expect(root().querySelector(".log")?.textContent).toBe("error TS2322");
  });

  it("disables its buttons while an action runs", () => {
    const { ui, root } = draw(view());
    ui.busy = "Approve";
    const r = root();
    expect(buttons(r, "Approve…")[0]!.disabled).toBe(true);
    expect(buttons(r, "Request changes")[0]!.disabled).toBe(true);
  });
  it("lists commits, asks a reviewer, and applies a suggestion in the thread", () => {
    const body = "Try:\n```suggestion\n  try { x = 1; } finally {}\n```";
    const { acts, asks, ui, root } = draw(view({ threads: [{ id: "PRRT_1", path: "src/a.ts", line: 42, resolved: false, hunk: "", comments: [{ author: "mai-k", body, at: "" }] }] }));
    expect(suggestion(body)).toBe("  try { x = 1; } finally {}");
    buttons(root(), "Apply suggestion in thread")[0]!.click();
    expect(asks[0]).toBe("Apply mai-k's suggested change on src/a.ts:42, replacing the commented line(s) with:\n  try { x = 1; } finally {}");
    const ask = root().querySelector<HTMLInputElement>("input.reviewer")!;
    ask.value = "@lek, nok";
    ask.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(acts).toEqual([[{ do: "request_reviewers", logins: ["lek", "nok"] }, "Reviewers"]]);
    ui.tab = "commits";
    expect(root().textContent).toContain("a1b2c3dReset submittingme");
  });
});
