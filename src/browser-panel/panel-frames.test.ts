// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import type { Notice, Request } from "../protocol/wire.js";
import type { Socket } from "./cdp.js";
import { BrowserPanel, type BrowserHost } from "./panel.js";

/** A tab socket the test feeds CDP events into; every call is answered with an empty result. */
class FakeSocket implements Socket {
  readyState = 1;
  private readonly onMessage: ((e: { data: unknown }) => void)[] = [];
  send(data: string): void {
    const { id } = JSON.parse(data) as { id: number };
    queueMicrotask(() => this.emit({ id, result: {} }));
  }
  close(): void {}
  addEventListener(type: string, listener: (e: { data: unknown }) => void): void {
    if (type === "message") this.onMessage.push(listener);
  }
  emit(message: unknown): void {
    for (const l of this.onMessage) l({ data: JSON.stringify(message) });
  }
}

function open() {
  const socket = new FakeSocket();
  let notify: (n: Notice) => void = () => {};
  const wire = { request: (_: Request) => {}, onAny: (l: (n: Notice) => void) => ((notify = l), () => {}) };
  const host = { cwd: "/p", mac: true, connect: () => socket, notify: () => {}, attach: () => {}, devServers: async () => [], runDevServer: () => {} } as unknown as BrowserHost;
  const panel = new BrowserPanel(document, wire, host);
  notify({ kind: "browser", cwd: "/p", page: { Ok: { endpoint: "http://127.0.0.1:1", socket: "ws://t", tabs: [], active: 0 } } } as unknown as Notice);
  return { panel, socket };
}

afterEach(() => vi.restoreAllMocks());

test("a frame whose pixels disagree with its reported size is laid out by its pixels", async () => {
  // Just after a resize Chromium reports the new width on a JPEG still bounded by the old one.
  vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1490);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(1672);
  const { panel, socket } = open();
  socket.emit({ method: "Page.screencastFrame", params: { sessionId: 1, data: "AA==", metadata: { deviceWidth: 775, deviceHeight: 836 } } });
  await new Promise((r) => setTimeout(r, 20));
  const shown = panel.root.querySelector<HTMLImageElement>("img.screen")!;
  expect([shown.style.width, shown.style.height]).toEqual(["745px", "836px"]);
  panel.dispose();
});

test("a screencast frame is shown at its own size, swapped in whole once decoded", async () => {
  const socket = new FakeSocket();
  let notify: (n: Notice) => void = () => {};
  const wire = { request: (_: Request) => {}, onAny: (l: (n: Notice) => void) => ((notify = l), () => {}) };
  const host = { cwd: "/p", mac: true, connect: () => socket, notify: () => {}, attach: () => {}, devServers: async () => [], runDevServer: () => {} } as unknown as BrowserHost;
  const panel = new BrowserPanel(document, wire, host);
  notify({ kind: "browser", cwd: "/p", page: { Ok: { endpoint: "http://127.0.0.1:1", socket: "ws://t", tabs: [], active: 0 } } } as unknown as Notice);
  const first = panel.root.querySelector<HTMLImageElement>("img.screen")!;

  // Two frames before either is decoded: only the newest is shown, never one under it.
  for (const width of [300, 400]) socket.emit({ method: "Page.screencastFrame", params: { sessionId: 1, data: "AA==", metadata: { deviceWidth: width, deviceHeight: 200 } } });
  await new Promise((r) => setTimeout(r, 20));

  const shown = panel.root.querySelectorAll<HTMLImageElement>("img.screen");
  expect(shown).toHaveLength(1);
  expect(shown[0]).not.toBe(first);
  expect(shown[0]!.style.width).toBe("400px");
  expect(shown[0]!.style.height).toBe("200px");
  expect(shown[0]!.getAttribute("src")).toBe("data:image/jpeg;base64,AA==");
  panel.dispose();
});
