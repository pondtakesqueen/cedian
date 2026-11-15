// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { Notice, PrView, Request } from "../protocol/wire.js";
import { PrPanel, stateOf, timeline } from "./pr-panel.js";

const view = (over: Partial<PrView> = {}): PrView => ({
  additions: 120, deletions: 14, author: "kit", base: "main", head: "fix/reconnect", behind: false, body: "Backs off after sleep.<!-- hidden -->", changed_files: 3,
  checks: [{ name: "ci", state: "passed", url: "u" }], closes: [], commits: 2, conflict: false, draft: false, labels: ["bug"], mine: false, number: 131,
  comments: [{ at: "2026-11-15T10:00:00Z", author: "mali", body: "Looks good" }],
  threads: [{ id: "t", path: "src/a.ts", line: 4, hunk: "", resolved: false, comments: [{ at: "2026-11-15T09:00:00Z", author: "kit", body: "Why 30s?" }] }],
  history: [{ oid: "abcdef1234", headline: "Back off", author: "kit" }], reviewers: [{ login: "mali", state: "APPROVED" }], state: "open", title: "Reconnect with backoff", url: "https://github.com/o/r/pull/131",
  ...over,
}) as PrView;

describe("the PR panel", () => {
  it("puts the PR's comments and its line comments in one timeline, oldest first", () => {
    expect(timeline(view()).map((e) => [e.author, e.where])).toEqual([["kit", "src/a.ts:4"], ["mali", undefined]]);
    expect(stateOf(view({ draft: true })).label).toBe("Draft");
    expect(stateOf(view({ state: "merged" })).label).toBe("Merged");
  });

  it("follows the thread the agent shows, and draws Summary, Timeline and Code", () => {
    const sent: Request[] = [];
    let listener: (n: Notice) => void = () => {};
    let thread: string | undefined = "t-1";
    const diffs: string[] = [];
    const panel = new PrPanel(document, { request: (r) => sent.push(r), onAny: (l) => ((listener = l), () => {}) }, { cwd: "/r", thread: () => thread, openUrl: () => {}, openDiff: (t) => diffs.push(t) });
    document.body.replaceChildren(panel.root);
    expect(sent).toEqual([{ op: "pr_view", cwd: "/r", thread: "t-1" }]);
    expect(panel.root.textContent).toContain("Reading the pull request");
    listener({ kind: "pr_view", thread: "t-1", view: { Ok: view() } } as Notice);
    const text = () => panel.root.textContent ?? "";
    expect(text()).toContain("Reconnect with backoff");
    expect(text()).toContain("fix/reconnect › main");
    expect(text()).toContain("mali (approved)");
    expect(text()).toContain("2 comments");
    expect(text()).toContain("Backs off after sleep.");
    expect(text()).not.toContain("hidden");
    const tab = (name: string) => [...panel.root.querySelectorAll<HTMLButtonElement>(".pp-tab")].find((b) => b.textContent === name)!.click();
    tab("Timeline");
    expect([...panel.root.querySelectorAll(".pp-event .pp-author")].map((n) => n.textContent)).toEqual(["kit", "mali"]);
    expect(text()).toContain("2 commits");
    tab("Code");
    expect(text()).toContain("3 files changed");
    [...panel.root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Open diff")!.click();
    expect(diffs).toEqual(["t-1"]);
    // Another thread in the agent: its PR is read, and one without a PR says so.
    thread = "t-2";
    panel.refresh();
    expect(sent.at(-1)).toEqual({ op: "pr_view", cwd: "/r", thread: "t-2" });
    listener({ kind: "pr_view", thread: "t-2", view: { Ok: null } } as Notice);
    expect(text()).toContain("no pull request yet");
    thread = undefined;
    panel.refresh();
    expect(text()).toContain("Open a thread");
  });
});
