import { describe, expect, it } from "vitest";
import { keyBytes, pickProject, PUSH_TEXT, pushState, socketUrl, SocketTransport, webHost } from "./main.js";

class FakeSocket {
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: unknown }) => void;
  onclose?: () => void;
  closed = false;
  send(line: string) {
    this.sent.push(line);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
}

describe("remote control page", () => {
  it("opens the socket beside the page, wss behind tailscale serve's HTTPS", () => {
    expect(socketUrl({ protocol: "https:", host: "mac.tail1234.ts.net" })).toBe("wss://mac.tail1234.ts.net/ws");
    expect(socketUrl({ protocol: "http:", host: "127.0.0.1:7421" })).toBe("ws://127.0.0.1:7421/ws");
  });

  it("carries lines both ways and reconnects after a drop, backing off", () => {
    const sockets: FakeSocket[] = [];
    const waits: number[] = [];
    let retry: (() => void) | undefined;
    const t = new SocketTransport(
      "ws://x/ws",
      () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s as unknown as WebSocket;
      },
      (fn, ms) => {
        waits.push(ms);
        retry = fn;
      },
    );
    const lines: string[] = [];
    const states: string[] = [];
    t.onLine((l) => lines.push(l));
    t.onState((s) => states.push(s));
    t.start();
    sockets[0]!.onopen!();
    t.send('{"op":"threads"}');
    sockets[0]!.onmessage!({ data: '{"kind":"welcome"}' });
    expect(sockets[0]!.sent).toEqual(['{"op":"threads"}']);
    expect(lines).toEqual(['{"kind":"welcome"}']);
    sockets[0]!.onclose!();
    retry!();
    sockets[1]!.onclose!();
    expect(waits).toEqual([1000, 2000]);
    retry!();
    sockets[2]!.onopen!();
    expect(states).toEqual(["connecting", "connected", "disconnected", "connecting", "disconnected", "connecting", "connected"]);
    t.stop();
    expect(sockets[2]!.closed).toBe(true);
  });

  it("picks ?cwd=, else the project shown last, else the first", () => {
    const projects = ["/a", "/b"];
    expect(pickProject(projects, "?cwd=%2Fc", "/b")).toBe("/c");
    expect(pickProject(projects, "", "/b")).toBe("/b");
    expect(pickProject(projects, "", "/gone")).toBe("/a");
    expect(pickProject([], "", null)).toBeUndefined();
  });

  it("a browser host finds no files, attaches nothing and opens links in a new tab without an opener", async () => {
    const opened: unknown[][] = [];
    const host = webHost("/repo", { open: (...a: unknown[]) => (opened.push(a), null), alert: () => {} } as never);
    expect(host.cwd).toBe("/repo");
    expect(await host.files("x")).toEqual([]);
    expect(await host.pickImages()).toEqual([]);
    host.openUrl("https://github.com/x");
    expect(opened).toEqual([["https://github.com/x", "_blank", "noopener,noreferrer"]]);
  });

  it("offers notifications where the browser can push, and says how on an iPhone that cannot yet", () => {
    const base = { push: true, ios: false, standalone: false, permission: "default" as const, subscribed: false };
    expect(pushState(base)).toBe("off");
    expect(pushState({ ...base, subscribed: true })).toBe("on");
    expect(pushState({ ...base, permission: "denied" })).toBe("denied");
    expect(pushState({ ...base, push: false, ios: true })).toBe("home-screen");
    expect(pushState({ ...base, push: false })).toBe("unsupported");
    expect(PUSH_TEXT["home-screen"].hint).toContain("Add to Home Screen");
    expect(PUSH_TEXT.unsupported).toEqual({});
  });

  it("reads the daemon's base64url key as the bytes subscribe takes", () => {
    expect([...keyBytes("-_8")]).toEqual([0xfb, 0xff]);
    expect(keyBytes("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4").length).toBe(65);
  });
});
