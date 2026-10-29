// The wire recording's reader (test/smoke/replay.mjs): which window it plays and what that
// window was sent, without a browser.
import { describe, expect, it } from "vitest";
import { playback } from "./replay.mjs";

const lines = (...entries) => entries.map((e) => JSON.stringify(e)).join("\n") + "\n";

describe("wire replay", () => {
  it("plays the first window that was sent blocks, from its first notice, with its thread", () => {
    const text = lines(
      { ms: 0, client: 1, notice: { kind: "welcome" } },
      { ms: 3, client: 2, notice: { kind: "welcome" } },
      { ms: 10, client: 2, request: { op: "open", cwd: "/r", thread: "t-7" } },
      { ms: 12, client: 2, notice: { kind: "blocks", thread: "t-7", from: 0, blocks: [], run_cost: 0 } },
      { ms: 40, client: 2, request: { op: "ack", thread: "t-7" } },
      { ms: 50, client: 2, notice: { kind: "text", thread: "t-7", index: 0, append: "x" } },
    );
    expect(playback(text)).toEqual({
      client: 2,
      cwd: "/r",
      thread: "t-7",
      notices: [
        { ms: 0, notice: { kind: "welcome" } },
        { ms: 9, notice: { kind: "blocks", thread: "t-7", from: 0, blocks: [], run_cost: 0 } },
        { ms: 47, notice: { kind: "text", thread: "t-7", index: 0, append: "x" } },
      ],
    });
    expect(playback(text, 1).notices).toHaveLength(1);
  });

  it("a prompt with no thread gets its thread from the started notice it plays", () => {
    const text = lines(
      { ms: 0, client: 5, request: { op: "prompt", cwd: "/r", text: "hi", thread: null } },
      { ms: 1, client: 5, notice: { kind: "started", cwd: "/r", thread: "t-1" } },
      { ms: 2, client: 5, notice: { kind: "blocks", thread: "t-1", from: 0, blocks: [], run_cost: 0 } },
    );
    expect(playback(text)).toMatchObject({ client: 5, cwd: "/r", thread: null });
    expect(() => playback(lines({ ms: 0, client: 1, notice: { kind: "welcome" } }))).toThrow("no window");
  });
});
