import { describe, expect, it } from "vitest";
import type { Notice, Request } from "../protocol/wire.js";
import { ThreadShare } from "./thread-share.js";

function setup() {
  const sent: Request[] = [];
  const listeners = new Set<(n: Notice) => void>();
  const share = new ThreadShare({ request: (r) => sent.push(r), onAny: (l) => (listeners.add(l), () => listeners.delete(l)) });
  return { share, sent, emit: (n: Notice) => listeners.forEach((l) => l(n)) };
}

describe("thread share", () => {
  it("closes a thread only when no pane has it open", () => {
    const { share, sent } = setup();
    const side = share.view();
    const popped = share.view();
    side.request({ op: "open", cwd: "/r", thread: "t-1" });
    popped.request({ op: "open", cwd: "/r", thread: "t-1" });
    // Each pane gets the thread drawn from its start.
    expect(sent).toEqual([{ op: "open", cwd: "/r", thread: "t-1" }, { op: "open", cwd: "/r", thread: "t-1" }]);
    side.request({ op: "close", thread: "t-1" });
    expect(sent).toHaveLength(2);
    expect(share.isOpen("t-1")).toBe(true);
    popped.request({ op: "close", thread: "t-1" });
    expect(sent.at(-1)).toEqual({ op: "close", thread: "t-1" });
    expect(share.isOpen("t-1")).toBe(false);
  });

  it("counts a pane once however often it opens a thread, and ignores a close it never opened", () => {
    const { share, sent } = setup();
    const a = share.view();
    const b = share.view();
    a.request({ op: "open", cwd: "/r", thread: "t-1" });
    a.request({ op: "open", cwd: "/r", thread: "t-1" });
    b.request({ op: "close", thread: "t-1" });
    expect(sent.filter((r) => r.op === "close")).toEqual([]);
    a.request({ op: "close", thread: "t-1" });
    expect(sent.at(-1)).toEqual({ op: "close", thread: "t-1" });
  });

  it("closes what a disposed pane left open and passes everything else through", () => {
    const { share, sent, emit } = setup();
    const a = share.view();
    const b = share.view();
    a.request({ op: "open", cwd: "/r", thread: "t-1" });
    a.request({ op: "open", cwd: "/r", thread: "t-2" });
    b.request({ op: "open", cwd: "/r", thread: "t-2" });
    a.request({ op: "ack", thread: "t-1" });
    expect(sent.at(-1)).toEqual({ op: "ack", thread: "t-1" });
    a.dispose();
    expect(sent.slice(-1)).toEqual([{ op: "close", thread: "t-1" }]);
    expect(share.isOpen("t-2")).toBe(true);
    const seen: Notice[] = [];
    const off = b.onAny((n) => seen.push(n));
    emit({ kind: "caught", thread: "t-2" });
    off();
    emit({ kind: "caught", thread: "t-2" });
    expect(seen).toEqual([{ kind: "caught", thread: "t-2" }]);
  });
});
