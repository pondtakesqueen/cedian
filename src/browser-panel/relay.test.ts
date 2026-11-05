import { describe, expect, test } from "vitest";
import { Cdp } from "./cdp.js";
import { agentMay, PageRelay, type BrowserChannel, type CdpMessage } from "./relay.js";

/** A group of one page, as VS Code's CDP proxy answers it. */
class FakeGroup implements BrowserChannel {
  readonly sent: CdpMessage[] = [];
  closed = false;
  private listener: ((m: CdpMessage) => void) | undefined;
  constructor(private readonly targets = [{ targetId: "T1", type: "page" }]) {}
  send(message: CdpMessage): void {
    this.sent.push(message);
    queueMicrotask(() => {
      if (message.method === "Target.getTargets") this.reply({ id: message.id, result: { targetInfos: this.targets } });
      else if (message.method === "Target.attachToTarget") this.reply({ id: message.id, result: { sessionId: "S1" } });
      else if (message.sessionId === "S1") this.reply({ id: message.id, result: { echoed: message.method }, sessionId: "S1" });
    });
  }
  onMessage(listener: (m: CdpMessage) => void): () => void {
    this.listener = listener;
    return () => (this.listener = undefined);
  }
  close(): void {
    this.closed = true;
  }
  reply(message: CdpMessage): void {
    this.listener?.(message);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("a native page as a page-level socket", () => {
  test("attaches to the group's page and speaks to it with its session, which callers never see", async () => {
    const group = new FakeGroup();
    const cdp = new Cdp(new PageRelay(group));
    const result = await cdp.call("Page.navigate", { url: "http://localhost:3000" });
    expect(result).toEqual({ echoed: "Page.navigate" });
    expect(group.sent.map((m) => m.method)).toEqual(["Target.getTargets", "Target.attachToTarget", "Page.navigate"]);
    expect(group.sent[1]!.params).toEqual({ targetId: "T1", flatten: true });
    expect(group.sent[2]).toMatchObject({ sessionId: "S1", params: { url: "http://localhost:3000" } });
  });

  test("passes the page's events on, and nothing from other sessions", async () => {
    const group = new FakeGroup();
    const relay = new PageRelay(group);
    const seen: unknown[] = [];
    relay.addEventListener("message", (e) => seen.push(JSON.parse(String(e.data))));
    await tick();
    group.reply({ method: "Page.loadEventFired", params: { timestamp: 1 }, sessionId: "S1" });
    group.reply({ method: "Page.loadEventFired", params: { timestamp: 2 }, sessionId: "OTHER" });
    group.reply({ method: "Target.targetCreated", params: {} });
    expect(seen).toEqual([{ method: "Page.loadEventFired", params: { timestamp: 1 } }]);
  });

  test("closes when its page detaches, and ends the group when closed", async () => {
    const group = new FakeGroup();
    const relay = new PageRelay(group);
    let closed = 0;
    relay.addEventListener("close", () => closed++);
    await tick();
    group.reply({ method: "Target.detachedFromTarget", params: { sessionId: "S1" } });
    expect([relay.readyState, closed, group.closed]).toEqual([3, 1, true]);
    relay.send(JSON.stringify({ id: 1, method: "Page.reload" }));
    expect(group.sent.some((m) => m.method === "Page.reload")).toBe(false);
  });

  test("a group with no page fails the way a socket that never opened does", async () => {
    const cdp = new Cdp(new PageRelay(new FakeGroup([])));
    await expect(cdp.call("Page.enable")).rejects.toThrow("closed before its page opened");
  });

  test("a run's socket reaches the page and nothing past it", async () => {
    const group = new FakeGroup();
    const cdp = new Cdp(new PageRelay(group, agentMay));
    await expect(cdp.call("Fetch.enable")).resolves.toEqual({ echoed: "Fetch.enable" });
    await expect(cdp.call("Target.createTarget", { url: "about:blank" })).rejects.toThrow("not allowed");
    await expect(cdp.call("Browser.close")).rejects.toThrow("not allowed");
    expect(group.sent.filter((m) => m.sessionId).map((m) => m.method)).toEqual(["Fetch.enable"]);
  });

  test("the methods cedia's browser tool and the block call are allowed", () => {
    for (const method of ["Page.navigate", "Runtime.evaluate", "Input.dispatchMouseEvent", "Fetch.failRequest", "DOM.getNodeForLocation", "Emulation.setDeviceMetricsOverride", "Log.enable", "Overlay.highlightNode"]) {
      expect(agentMay(method), method).toBe(true);
    }
    for (const method of ["Target.attachToTarget", "Browser.getVersion", "Storage.clearDataForOrigin", "SystemInfo.getInfo", "IO.read"]) {
      expect(agentMay(method), method).toBe(false);
    }
  });
});
