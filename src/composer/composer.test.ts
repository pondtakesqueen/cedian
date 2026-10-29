import { describe, expect, it } from "vitest";
import { accept, complete, score, tokenAt } from "./complete.js";
import { dropQueued, editQueued, isEmpty, sendNow, submit } from "./composer.js";

const choices = { model: "anthropic/claude-opus-5-5", permission: "workspace", worktree: true };

describe("submit", () => {
  it("opens a new thread, in a worktree when asked", () => {
    expect(submit({ text: " fix it ", images: [] }, { cwd: "/r", running: false }, choices)).toEqual([
      { op: "prompt", cwd: "/r", text: "fix it", thread: null, worktree: true, model: "anthropic/claude-opus-5-5", permission: "workspace" },
    ]);
  });

  it("runs a thread at rest, never in a new worktree", () => {
    const [r] = submit({ text: "again", images: ["/tmp/a.png"] }, { cwd: "/r", thread: "t-1", running: false }, choices);
    expect(r).toMatchObject({ op: "prompt", thread: "t-1", worktree: false, images: ["/tmp/a.png"] });
  });

  it("queues for a running thread, images included", () => {
    expect(submit({ text: "also this", images: ["/tmp/a.png"] }, { cwd: "/r", thread: "t-1", running: true }, choices)).toEqual([
      { op: "send", cwd: "/r", thread: "t-1", text: "also this", images: ["/tmp/a.png"] },
    ]);
  });

  it("sends nothing for an empty draft, but an image alone is a message", () => {
    expect(submit({ text: "  ", images: [] }, { cwd: "/r", running: false }, choices)).toEqual([]);
    expect(isEmpty({ text: "", images: ["/a.png"] })).toBe(false);
  });
});

describe("the queue", () => {
  const target = { cwd: "/r", thread: "t-1" };
  it("Send now takes the message back, stops the run, then runs it", () => {
    const r = sendNow({ id: "m-1", text: "do this first" }, target, choices);
    expect(r.now).toEqual([{ op: "unsend", cwd: "/r", thread: "t-1", ids: ["m-1"] }, { op: "stop", thread: "t-1" }]);
    expect(r.then).toMatchObject({ op: "prompt", thread: "t-1", text: "do this first", worktree: false });
  });
  it("Edit puts it back in the draft; × drops it", () => {
    expect(editQueued({ id: "m-1", text: "x" }, target)).toEqual({ request: { op: "unsend", cwd: "/r", thread: "t-1", ids: ["m-1"] }, draft: { text: "x", images: [] } });
    expect(dropQueued({ id: "m-2", text: "y" }, target)).toEqual({ op: "unsend", cwd: "/r", thread: "t-1", ids: ["m-2"] });
  });
});

describe("@ and /", () => {
  const files = ["src/settings/roots.ts", "src/settings/index.ts", "docs/specs/ROOTS_SETTINGS_DRAFT.md", "README.md"];
  const commands = [
    { name: "code-review", description: "Review a diff", kind: "skill", source: "repository" },
    { name: "commit", description: "Commit", kind: "skill", source: "user" },
  ] as never[];

  it("finds the token at the cursor; / only at the start", () => {
    expect(tokenAt("look at @src/se", 15)).toEqual({ trigger: "@", query: "src/se", start: 8, end: 15 });
    expect(tokenAt("/co", 3)).toEqual({ trigger: "/", query: "co", start: 0, end: 3 });
    expect(tokenAt("  /co", 5)?.trigger).toBe("/");
    expect(tokenAt("run /co", 7)).toBeUndefined();
    expect(tokenAt("plain", 5)).toBeUndefined();
  });

  it("ranks a prefix over a file name over a word over letters in order", () => {
    expect(score("src", "src/a.ts")).toBe(3);
    expect(score("roots", "src/settings/roots.ts")).toBe(2.5);
    expect(score("draft", "docs/specs/ROOTS_SETTINGS_DRAFT.md")).toBe(2);
    expect(score("rts", "src/settings/roots.ts")).toBe(1);
    expect(score("zz", "README.md")).toBeUndefined();
  });

  it("completes files and commands, and accepting replaces the token", () => {
    const at = tokenAt("see @roots", 10)!;
    const [first] = complete(at, files, commands);
    expect(first).toEqual({ label: "src/settings/roots.ts", insert: "@src/settings/roots.ts " });
    expect(accept("see @roots", at, first!)).toEqual({ text: "see @src/settings/roots.ts ", cursor: 27 });
    const slash = tokenAt("/rev", 4)!;
    expect(complete(slash, files, commands).map((c) => c.label)).toEqual(["/code-review"]);
    expect(complete(tokenAt("/", 1)!, files, commands).map((c) => c.label)).toEqual(["/commit", "/code-review"]);
  });
});
