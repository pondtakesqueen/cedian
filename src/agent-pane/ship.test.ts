import { describe, expect, it } from "vitest";
import type { ThreadInfo } from "../protocol/wire.js";
import { answer, askCard, todoCard } from "./cards.js";
import { cancel, confirmCommit, confirmPr, editDraft, idleShip, shipNotice, startCommit, startPr } from "./ship.js";

describe("commit", () => {
  it("drafts, lets the person edit, then commits the files kept", () => {
    let { ship, request } = startCommit(idleShip(), "/w", "t-1");
    expect(request).toEqual({ op: "commit_draft", cwd: "/w", thread: "t-1" });
    ship = shipNotice(ship, "t-1", { kind: "commit_draft", thread: "t-1", draft: { files: ["a.ts", "b.ts"], message: "Fix it", branch: "work" } });
    expect(ship.commit).toEqual({ step: "draft", message: "Fix it", files: ["a.ts", "b.ts"], chosen: ["a.ts", "b.ts"], branch: "work" });
    ship = editDraft(ship, { message: "Fix the sum\n\nbody", chosen: ["a.ts"] });
    const done = confirmCommit(ship, "/w", "t-1");
    expect(done.request).toEqual({ op: "commit", cwd: "/w", thread: "t-1", message: "Fix the sum\n\nbody", files: ["a.ts"] });
    ship = shipNotice(done.ship, "t-1", { kind: "committed", thread: "t-1", result: { commit: "abc1234", subject: "Fix the sum", files: ["a.ts"] } });
    expect(ship.commit).toEqual({ step: "committed", commit: "abc1234", subject: "Fix the sum" });
  });

  it("refuses an empty message or no files, and shows cedia's refusal", () => {
    let ship = shipNotice(startCommit(idleShip(), "/w", "t-1").ship, "t-1", { kind: "commit_draft", thread: "t-1", draft: { files: ["a"], message: "m" } });
    expect(confirmCommit(editDraft(ship, { message: " " }), "/w", "t-1").request).toBeUndefined();
    expect(confirmCommit(editDraft(ship, { chosen: [] }), "/w", "t-1").request).toBeUndefined();
    ship = shipNotice(startCommit(idleShip(), "/w", "t-1").ship, "t-1", { kind: "commit_draft", thread: "t-1", draft: { error: "nothing this thread changed differs from HEAD" } });
    expect(ship.commit).toEqual({ step: "failed", error: "nothing this thread changed differs from HEAD" });
    expect(shipNotice(idleShip(), "t-1", { kind: "commit_draft", thread: "t-2", draft: { files: [], message: "" } })).toEqual(idleShip());
  });
});

describe("pull request", () => {
  it("checks, waits for yes, then opens", () => {
    let { ship, request } = startPr(idleShip(), "/w", "t-1");
    expect(request).toEqual({ op: "pr_check", cwd: "/w", thread: "t-1" });
    expect(confirmPr(ship, "/w", "t-1").request).toBeUndefined();
    ship = shipNotice(ship, "t-1", { kind: "pr_plan", thread: "t-1", plan: { branch: "work", base: "main" } });
    expect(ship.pr).toEqual({ step: "plan", branch: "work", base: "main" });
    const yes = confirmPr(ship, "/w", "t-1");
    expect(yes.request).toEqual({ op: "pr", cwd: "/w", thread: "t-1" });
    ship = shipNotice(yes.ship, "t-1", { kind: "pr_opened", thread: "t-1", result: { branch: "work", base: "main", url: "https://x/pr/7", out: "" } });
    expect(ship.pr).toEqual({ step: "opened", branch: "work", base: "main", url: "https://x/pr/7" });
    expect(cancel(ship, "pr").pr).toEqual({ step: "idle" });
  });

  it("says why it cannot", () => {
    const ship = shipNotice(startPr(idleShip(), "/w", "t-1").ship, "t-1", { kind: "pr_plan", thread: "t-1", plan: { blocked: "on the default branch" } });
    expect(ship.pr).toEqual({ step: "blocked", reason: "on the default branch" });
  });
});

describe("cards", () => {
  const info = (over: Partial<ThreadInfo>) => ({ status: "working", messages: [], pending: [], ...over }) as unknown as ThreadInfo;
  it("asks only while asking; the answer is the next prompt", () => {
    expect(askCard(info({ status: "asking", question: { question: "Go ahead?", options: ["Yes", "No"] } }))).toEqual({ question: "Go ahead?", options: ["Yes", "No"] });
    expect(askCard(info({ status: "done", question: { question: "x", options: [] } }))).toBeUndefined();
    expect(answer("/w", "t-1", " Yes ", { permission: "workspace" })).toEqual({ op: "prompt", cwd: "/w", text: "Yes", thread: "t-1", worktree: false, permission: "workspace" });
    expect(answer("/w", "t-1", " ")).toBeUndefined();
  });
  it("counts the todo list", () => {
    expect(todoCard(info({ todo: [{ state: "done", text: "a" }, { state: "doing", text: "b" }, { state: "pending", text: "c" }] }))?.progress).toBe("1/3");
    expect(todoCard(info({}))).toBeUndefined();
  });
});
