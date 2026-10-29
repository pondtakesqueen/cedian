import { describe, expect, it } from "vitest";
import { DaemonClient, type ConnectionState, type Transport } from "./client.js";
import { LineSplitter } from "./lines.js";

class FakeTransport implements Transport {
  sent: unknown[] = [];
  private line?: (line: string) => void;
  private state?: (state: ConnectionState) => void;
  send(line: string) {
    this.sent.push(JSON.parse(line));
  }
  onLine(listener: (line: string) => void) {
    this.line = listener;
  }
  onState(listener: (state: ConnectionState) => void) {
    this.state = listener;
  }
  emit(line: string) {
    this.line?.(line);
  }
  set(state: ConnectionState) {
    this.state?.(state);
  }
}

describe("LineSplitter", () => {
  it("keeps a line cut across reads whole", () => {
    const split = new LineSplitter();
    expect(split.push('{"kind":"caught","thr')).toEqual([]);
    expect(split.push('ead":"t-1"}\n{"kind":')).toEqual(['{"kind":"caught","thread":"t-1"}']);
    expect(split.push('"error","message":"x"}\n\n')).toEqual(['{"kind":"error","message":"x"}']);
    expect(split.end()).toEqual([]);
    split.push("tail");
    expect(split.end()).toEqual(["tail"]);
  });
});

describe("DaemonClient", () => {
  it("holds requests until connected, then sends watches first", () => {
    const t = new FakeTransport();
    const client = new DaemonClient(t);
    client.request({ op: "threads", cwd: "/repo" });
    client.request({ op: "stop", thread: "t-1" });
    expect(t.sent).toEqual([]);
    t.set("connected");
    expect(t.sent).toEqual([{ op: "threads", cwd: "/repo" }, { op: "stop", thread: "t-1" }]);
  });

  it("asks again for what it watches after a reconnect, and not for what it closed", () => {
    const t = new FakeTransport();
    const client = new DaemonClient(t);
    t.set("connected");
    client.request({ op: "threads", cwd: "/repo" });
    client.request({ op: "open", cwd: "/repo", thread: "t-1" });
    client.request({ op: "open", cwd: "/repo", thread: "t-2" });
    client.request({ op: "close", thread: "t-1" });
    client.request({ op: "stop", thread: "t-2" });
    t.sent = [];
    t.set("disconnected");
    t.set("connected");
    expect(t.sent).toEqual([{ op: "threads", cwd: "/repo" }, { op: "open", cwd: "/repo", thread: "t-2" }]);
  });

  it("routes notices by kind and to every-notice listeners, and keeps lines it cannot read", () => {
    const t = new FakeTransport();
    const client = new DaemonClient(t);
    const caught: string[] = [];
    const all: string[] = [];
    const off = client.on("caught", (n) => caught.push(n.thread));
    client.onAny((n) => all.push(n.kind));
    t.emit('{"kind":"caught","thread":"t-1"}');
    t.emit('{"kind":"error","message":"no"}');
    t.emit("not json");
    t.emit("[1]");
    off();
    t.emit('{"kind":"caught","thread":"t-2"}');
    expect(caught).toEqual(["t-1"]);
    expect(all).toEqual(["caught", "error", "caught"]);
    expect(client.unreadable).toEqual(["not json", "[1]"]);
  });

  it("keeps the latest welcome for a listener that starts after it", () => {
    const t = new FakeTransport();
    const client = new DaemonClient(t);
    expect(client.welcome).toBeUndefined();
    t.emit('{"kind":"welcome","daemon":"0.1","cedia":{"Err":"none"},"protocol":"a294"}');
    expect(client.welcome?.protocol).toBe("a294");
  });

  it("reports the connection", () => {
    const t = new FakeTransport();
    const client = new DaemonClient(t);
    const seen: ConnectionState[] = [];
    client.onConnection((s) => seen.push(s));
    expect(client.connection).toBe("connecting");
    t.set("connected");
    t.set("disconnected");
    expect(seen).toEqual(["connected", "disconnected"]);
    expect(client.connection).toBe("disconnected");
  });
});
