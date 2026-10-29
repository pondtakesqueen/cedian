import { describe, expect, it } from "vitest";
import type { Block } from "./block.js";
import { contextMeter, meterLabel, ringDash } from "./context-meter.js";
import { currentModel, isRunning, openState, queued, reduce } from "./thread-state.js";
import { nextViewMode, viewModeOf, visibleBlocks } from "./view-modes.js";

const tool = (over: object) => ({ kind: "tool", call_id: "c", name: "bash", input: {}, permission: null, output: null, is_error: false, exit_code: null, started_at: null, ms: null, state: "done", status: "completed", ...over }) as Block;
const blocks: Block[] = [
  { kind: "session", model: "anthropic/claude-opus-5-5", role: "code" },
  { kind: "user", text: "fix", images: [] },
  { kind: "thinking", text: "hm", streaming: false, ms: 10 },
  tool({}),
  tool({ call_id: "f", is_error: true }),
  tool({ call_id: "r", state: "running" }),
  { kind: "text", text: "done", streaming: false },
];

describe("view modes", () => {
  it("answers hide thinking and finished tool calls; thinking adds thinking; all shows all", () => {
    expect(visibleBlocks(blocks, "answers").map((b) => b.kind)).toEqual(["session", "user", "tool", "tool", "text"]);
    expect(visibleBlocks(blocks, "thinking").map((b) => b.kind)).toEqual(["session", "user", "thinking", "tool", "tool", "text"]);
    expect(visibleBlocks(blocks, "all")).toHaveLength(7);
  });
  it("cycles, and reads desktop.view_mode", () => {
    expect([nextViewMode("answers"), nextViewMode("thinking"), nextViewMode("all")]).toEqual(["thinking", "all", "answers"]);
    expect(viewModeOf("thinking")).toBe("thinking");
    expect(viewModeOf(3)).toBe("answers");
  });
});

describe("context meter", () => {
  const models = { default: "anthropic/claude-opus-5-5", models: [{ ref: "anthropic/claude-opus-5-5", label: "Opus", provider: "anthropic", available: true, contextWindow: 200000, effort: true }], modes: [] } as never;
  it("is the share of the model's window", () => {
    const m = contextMeter(152_000, "anthropic/claude-opus-5-5", models)!;
    expect(m).toEqual({ tokens: 152_000, window: 200_000, percent: 76, high: false });
    expect(meterLabel(m)).toBe("context 152k / 200k");
    expect(ringDash({ ...m, percent: 50 }, 6)).toBe("18.85 18.85");
    expect(contextMeter(170_000, "anthropic/claude-opus-5-5", models)?.high).toBe(true);
    expect(contextMeter(1, "unknown", models)).toBeUndefined();
    expect(contextMeter(undefined, "anthropic/claude-opus-5-5", models)).toBeUndefined();
  });
});

describe("thread state", () => {
  it("follows the open thread's notices and ignores the rest", () => {
    let s = openState("/r");
    s = reduce(s, { kind: "preparing", cwd: "/r", step: "creating the worktree" });
    expect(s.preparing).toBe("creating the worktree");
    s = reduce(s, { kind: "started", cwd: "/r", thread: "t-1" });
    expect(s.thread).toBe("t-1");
    s = reduce(s, { kind: "blocks", thread: "t-1", from: 0, blocks: blocks as never, context: 5000, run_cost: 0.1 });
    s = reduce(s, { kind: "blocks", thread: "t-2", from: 0, blocks: [], run_cost: 0 });
    expect(s.view.blocks).toHaveLength(7);
    expect(s.view.context).toBe(5000);
    expect(currentModel(s.view.blocks)).toBe("anthropic/claude-opus-5-5");
    s = reduce(s, { kind: "status", thread: "t-1", status: "working" });
    expect(isRunning(s)).toBe(true);
    s = reduce(s, { kind: "caught", thread: "t-1" });
    expect(s.caught).toBe(true);
    // A second started for the same cwd belongs to another window's prompt.
    expect(reduce(s, { kind: "started", cwd: "/r", thread: "t-9" }).thread).toBe("t-1");
    s = reduce(s, { kind: "error", message: "no" });
    expect(s.error).toBe("no");
    // An error about another thread, or one for the settings window, is not this pane's.
    expect(reduce(s, { kind: "error", message: "other", thread: "t-9" }).error).toBe("no");
    expect(reduce(s, { kind: "error", message: "mcp", settings: true }).error).toBe("no");
    expect(reduce(s, { kind: "error", message: "mine", thread: "t-1" }).error).toBe("mine");
  });

  it("takes the thread's row from the list, with its queue", () => {
    const info = { id: "t-1", status: "working", pending: ["m-2"], messages: [{ id: "m-1", from: "user", text: "old", at: "" }, { id: "m-2", from: "user", text: "next", at: "" }] } as never;
    const s = reduce(openState("/r", "t-1"), { kind: "threads", cwd: "/r", threads: [info] });
    expect(s.status).toBe("working");
    expect(queued(s.info)).toEqual([{ id: "m-2", text: "next" }]);
  });
});
