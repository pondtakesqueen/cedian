// One tab of the daemon's Chromium as the Browser block sees it (spec §3.3, §4.3, §6.3): its
// screencast, its load state, its console, input from the block, and the element picker. Every
// change is a DevTools call on the page; nothing here is kept that the page cannot give again.
import { Cdp, TIMED_OUT } from "./cdp.js";

/** Spec §4.3: idle → loading → loaded → (error). */
export type LoadState = "idle" | "loading" | "loaded" | "error";
/** Spec §4.3: element selection idle → inspecting → selected (→ attached, by the block). */
export type PickState = "idle" | "inspecting" | "selected";

export interface PageView {
  url: string;
  title: string;
  load: LoadState;
  /** Why the page did not load, shown in the block (spec §8.4 inline). */
  error?: string;
  canBack: boolean;
  canForward: boolean;
  pick: PickState;
}

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export interface ConsoleLine {
  level: ConsoleLevel;
  text: string;
  /** Where it came from: `file:line`, when the page says. */
  source?: string;
}

/** A screencast frame: a JPEG, base64, and the CSS size of the page it shows. */
export interface Frame {
  data: string;
  width: number;
  height: number;
}

/** A picked element, for the agent: where it is, what it says and how it is styled. */
export interface PickedElement {
  url: string;
  selector: string;
  tag: string;
  text: string;
  html: string;
  styles: Record<string, string>;
  /** Its box on the page, CSS pixels from the document's top left. */
  box: { x: number; y: number; width: number; height: number };
  /** A PNG of the element, base64; none when it has no size. */
  image?: string;
}

export interface MouseInput {
  type: "mousePressed" | "mouseReleased" | "mouseMoved";
  x: number;
  y: number;
  /** DOM's `button`: 0 left, 1 middle, 2 right. */
  button?: number;
  /** DOM's `buttons` bitmask. */
  buttons?: number;
  clickCount?: number;
  modifiers?: number;
}

/** The keys of a DOM KeyboardEvent the block passes on. */
export interface KeyInput {
  key: string;
  code: string;
  keyCode: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** How long the console keeps: the newest lines. */
export const CONSOLE_LINES = 500;
const MAX_LINE = 2_000;

/** The CDP modifiers bitmask of a DOM event: Alt 1, Ctrl 2, Meta 4, Shift 8. */
export function modifiersOf(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

/** Editing shortcuts headless Chromium only takes as named commands (Cmd on macOS, Ctrl elsewhere). */
const COMMANDS: Record<string, string> = { a: "selectAll", c: "copy", x: "cut", z: "undo" };

/** `Input.dispatchKeyEvent`'s params for a DOM key event. */
export function keyParams(type: "keyDown" | "keyUp", e: KeyInput, mac = true): Record<string, unknown> {
  const modifiers = modifiersOf(e);
  const shortcut = mac ? e.metaKey : e.ctrlKey;
  const text = type === "keyDown" && !e.ctrlKey && !e.metaKey ? (e.key.length === 1 ? e.key : e.key === "Enter" ? "\r" : undefined) : undefined;
  const command = type === "keyDown" && shortcut && !e.altKey ? COMMANDS[e.key.toLowerCase()] : undefined;
  return {
    type: type === "keyDown" && text === undefined ? "rawKeyDown" : type,
    key: e.key,
    code: e.code,
    windowsVirtualKeyCode: e.keyCode,
    nativeVirtualKeyCode: e.keyCode,
    modifiers,
    ...(text !== undefined ? { text, unmodifiedText: text } : {}),
    ...(command ? { commands: [command] } : {}),
  };
}

/**
 * A failed load as the block says it (spec §8): the network and a timeout are transient, a
 * notification; anything else stays in the block. A load another one replaced says nothing.
 */
export function loadError(errorText: string): { message: string; transient: boolean } | undefined {
  if (/ERR_ABORTED/.test(errorText)) return undefined;
  if (/ERR_(INTERNET_DISCONNECTED|NETWORK_CHANGED|NETWORK_IO_SUSPENDED|NAME_NOT_RESOLVED_OFFLINE)/.test(errorText)) return { message: "the network went away", transient: true };
  if (/ERR_(TIMED_OUT|CONNECTION_TIMED_OUT)/.test(errorText)) return { message: TIMED_OUT, transient: true };
  if (/ERR_CONNECTION_REFUSED/.test(errorText)) return { message: `Nothing answers there (${errorText}). Is the dev server running?`, transient: false };
  return { message: `This page didn't load (${errorText})`, transient: false };
}

/** A console call's arguments as one line. */
function argsText(args: { type?: string; value?: unknown; description?: string; unserializableValue?: string }[]): string {
  return args
    .map((a) => (a.value !== undefined ? (typeof a.value === "string" ? a.value : JSON.stringify(a.value)) : a.unserializableValue ?? a.description ?? a.type ?? ""))
    .join(" ");
}

const LEVELS: Record<string, ConsoleLevel> = { warning: "warn", warn: "warn", error: "error", assert: "error", info: "info", debug: "debug", verbose: "debug" };

/** Runs in the page on the picked element: a selector for it, its text, markup, box and styles. */
const DESCRIBE = `function () {
  const el = this;
  const path = [];
  for (let n = el; n && n.nodeType === 1 && path.length < 6; n = n.parentElement) {
    let part = n.localName;
    if (n.id) { path.unshift(part + "#" + CSS.escape(n.id)); break; }
    part += [...n.classList].slice(0, 2).map((c) => "." + CSS.escape(c)).join("");
    const parent = n.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.localName === n.localName);
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(n) + 1) + ")";
    }
    path.unshift(part);
  }
  const cs = getComputedStyle(el);
  const keys = ["display", "position", "width", "height", "margin", "padding", "color", "background-color", "font-family", "font-size", "font-weight", "line-height", "border", "border-radius", "gap", "flex-direction", "justify-content", "align-items"];
  const styles = {};
  for (const k of keys) styles[k] = cs.getPropertyValue(k);
  const r = el.getBoundingClientRect();
  return { selector: path.join(" > "), tag: el.localName, text: (el.innerText || el.textContent || "").trim().slice(0, 300), html: el.outerHTML.slice(0, 1500), styles, box: { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } };
}`;

const HIGHLIGHT = { contentColor: { r: 111, g: 168, b: 220, a: 0.35 }, borderColor: { r: 111, g: 168, b: 220, a: 0.9 }, showInfo: true };

export class PageSession {
  view: PageView = { url: "", title: "", load: "idle", canBack: false, canForward: false, pick: "idle" };
  readonly console: ConsoleLine[] = [];
  private mainFrame = "";
  private size = { width: 0, height: 0, scale: 1 };
  private hovered: number | undefined;
  private readonly changeListeners = new Set<(view: PageView) => void>();
  private readonly frameListeners = new Set<(frame: Frame) => void>();
  private readonly consoleListeners = new Set<(line: ConsoleLine | undefined) => void>();
  private readonly pickListeners = new Set<(picked: PickedElement) => void>();
  private readonly noticeListeners = new Set<(message: string) => void>();
  private readonly closeListeners = new Set<(beforeLoad: boolean) => void>();
  private everLoaded = false;

  constructor(private readonly cdp: Cdp) {
    cdp.on("Page.screencastFrame", (p) => {
      cdp.call("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
      for (const l of this.frameListeners) l({ data: p.data, width: p.metadata?.deviceWidth ?? this.size.width, height: p.metadata?.deviceHeight ?? this.size.height });
    });
    cdp.on("Page.frameStartedLoading", (p) => {
      if (p.frameId === this.mainFrame) this.set({ load: "loading", error: undefined });
    });
    cdp.on("Page.frameNavigated", (p) => {
      if (p.frame?.parentId) return;
      this.mainFrame = p.frame.id;
      const failed = String(p.frame.url).startsWith("chrome-error://");
      this.set({ url: failed ? p.frame.unreachableUrl ?? this.view.url : p.frame.url });
      this.history();
    });
    cdp.on("Page.navigatedWithinDocument", (p) => {
      if (p.frameId === this.mainFrame) {
        this.set({ url: p.url });
        this.history();
      }
    });
    cdp.on("Page.loadEventFired", () => {
      if (this.view.load !== "error") this.set({ load: "loaded" });
      this.everLoaded = true;
      this.history();
    });
    cdp.on("Page.frameStoppedLoading", (p) => {
      if (p.frameId === this.mainFrame && this.view.load === "loading") this.set({ load: "loaded" });
    });
    cdp.on("Network.loadingFailed", (p) => {
      if (p.type === "Document" && !p.canceled) this.failed(String(p.errorText));
    });
    cdp.on("Runtime.consoleAPICalled", (p) => {
      const frame = p.stackTrace?.callFrames?.[0];
      this.log({ level: LEVELS[p.type] ?? "log", text: argsText(p.args ?? []), ...(frame?.url ? { source: `${frame.url}:${frame.lineNumber + 1}` } : {}) });
    });
    cdp.on("Runtime.exceptionThrown", (p) => {
      const d = p.exceptionDetails ?? {};
      this.log({ level: "error", text: d.exception?.description ?? d.text ?? "Uncaught exception", ...(d.url ? { source: `${d.url}:${(d.lineNumber ?? 0) + 1}` } : {}) });
    });
    cdp.on("Log.entryAdded", (p) => {
      const e = p.entry ?? {};
      this.log({ level: LEVELS[e.level] ?? "log", text: e.text ?? "", ...(e.url ? { source: e.url } : {}) });
    });
    cdp.on("Inspector.detached", () => cdp.close());
    cdp.onClose(() => {
      for (const l of this.closeListeners) l(!this.everLoaded);
    });
  }

  onChange(listener: (view: PageView) => void): () => void {
    return add(this.changeListeners, listener);
  }
  onFrame(listener: (frame: Frame) => void): () => void {
    return add(this.frameListeners, listener);
  }
  /** A line added, or none when the console was cleared. */
  onConsole(listener: (line: ConsoleLine | undefined) => void): () => void {
    return add(this.consoleListeners, listener);
  }
  onPicked(listener: (picked: PickedElement) => void): () => void {
    return add(this.pickListeners, listener);
  }
  /** Transient failures, for a notification (spec §8.4). */
  onNotice(listener: (message: string) => void): () => void {
    return add(this.noticeListeners, listener);
  }
  /** The page's socket closed; `beforeLoad` when no page ever loaded on it. */
  onClose(listener: (beforeLoad: boolean) => void): () => void {
    return add(this.closeListeners, listener);
  }

  /** Turns on what the block shows and starts the screencast at the block's size. */
  async start(width: number, height: number, scale: number): Promise<void> {
    await Promise.all(["Page.enable", "Runtime.enable", "Network.enable", "Log.enable", "DOM.enable"].map((m) => this.cdp.call(m)));
    await this.cdp.call("Overlay.enable");
    const tree = await this.cdp.call("Page.getFrameTree");
    this.mainFrame = tree.frameTree.frame.id;
    this.set({ url: tree.frameTree.frame.url, load: tree.frameTree.frame.url === "about:blank" ? "idle" : "loaded" });
    if (this.view.load === "loaded") this.everLoaded = true;
    await this.history();
    await this.resize(width, height, scale);
  }

  /** The page laid out at the block's size, its frames sent at the screen's pixels. */
  async resize(width: number, height: number, scale: number): Promise<void> {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.size.width && h === this.size.height && scale === this.size.scale) return;
    this.size = { width: w, height: h, scale };
    await this.cdp.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 0, mobile: false });
    await this.cdp.call("Page.stopScreencast").catch(() => {});
    await this.cdp.call("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: Math.round(w * scale), maxHeight: Math.round(h * scale), everyNthFrame: 1 });
  }

  async navigate(url: string): Promise<void> {
    this.set({ load: "loading", error: undefined, url });
    const result = await this.cdp.call("Page.navigate", { url });
    if (result.errorText) this.failed(result.errorText);
  }

  back(): Promise<void> {
    return this.step(-1);
  }
  forward(): Promise<void> {
    return this.step(1);
  }
  reload(): Promise<void> {
    this.set({ error: undefined });
    return this.cdp.call("Page.reload");
  }
  stop(): Promise<void> {
    return this.cdp.call("Page.stopLoading");
  }

  async mouse(input: MouseInput): Promise<void> {
    if (this.view.pick === "inspecting") return this.pickAt(input);
    await this.cdp.call("Input.dispatchMouseEvent", {
      type: input.type,
      x: input.x,
      y: input.y,
      modifiers: input.modifiers ?? 0,
      button: input.type === "mouseMoved" && !input.buttons ? "none" : (["left", "middle", "right"][input.button ?? 0] ?? "left"),
      buttons: input.buttons ?? 0,
      clickCount: input.clickCount ?? (input.type === "mouseMoved" ? 0 : 1),
    });
  }

  wheel(x: number, y: number, deltaX: number, deltaY: number, modifiers = 0): Promise<void> {
    return this.cdp.call("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX, deltaY, modifiers });
  }

  async key(type: "keyDown" | "keyUp", e: KeyInput, mac = true): Promise<void> {
    if (this.view.pick === "inspecting" && e.key === "Escape") return this.cancelPick();
    await this.cdp.call("Input.dispatchKeyEvent", keyParams(type, e, mac));
  }

  /** Text pasted into the block, typed into the page's focused field. */
  insertText(text: string): Promise<void> {
    return this.cdp.call("Input.insertText", { text });
  }

  /** Element selection: the next click picks the element under it instead of clicking it. */
  pick(): void {
    this.set({ pick: "inspecting" });
  }

  async cancelPick(): Promise<void> {
    this.hovered = undefined;
    this.set({ pick: "idle" });
    await this.cdp.call("Overlay.hideHighlight").catch(() => {});
  }

  clearConsole(): void {
    this.console.length = 0;
    for (const l of this.consoleListeners) l(undefined);
  }

  /** The tab's title and address, for a tab the block does not show. */
  async info(): Promise<{ url: string; title: string }> {
    const info = await this.cdp.call("Target.getTargetInfo");
    return { url: info.targetInfo.url, title: info.targetInfo.title };
  }

  dispose(): void {
    this.cdp.call("Page.stopScreencast").catch(() => {});
    this.cdp.close();
  }

  private async pickAt(input: MouseInput): Promise<void> {
    const at = await this.cdp.call("DOM.getNodeForLocation", { x: Math.round(input.x), y: Math.round(input.y), includeUserAgentShadowDOM: false }).catch(() => undefined);
    const node: number | undefined = at?.backendNodeId;
    if (input.type === "mouseMoved") {
      if (node !== undefined && node !== this.hovered) {
        this.hovered = node;
        await this.cdp.call("Overlay.highlightNode", { backendNodeId: node, highlightConfig: HIGHLIGHT }).catch(() => {});
      }
      return;
    }
    if (input.type !== "mousePressed" || node === undefined) return;
    await this.cdp.call("Overlay.hideHighlight").catch(() => {});
    this.hovered = undefined;
    const picked = await this.describe(node);
    this.set({ pick: "selected" });
    for (const l of this.pickListeners) l(picked);
    this.set({ pick: "idle" });
  }

  private async describe(backendNodeId: number): Promise<PickedElement> {
    const { object } = await this.cdp.call("DOM.resolveNode", { backendNodeId });
    const { result } = await this.cdp.call("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: DESCRIBE, returnByValue: true });
    this.cdp.call("Runtime.releaseObject", { objectId: object.objectId }).catch(() => {});
    const d = result.value as Omit<PickedElement, "url" | "image">;
    let image: string | undefined;
    if (d.box.width >= 1 && d.box.height >= 1) {
      const shot = await this.cdp
        .call("Page.captureScreenshot", { format: "png", clip: { ...d.box, scale: 1 }, captureBeyondViewport: true })
        .catch(() => undefined);
      image = shot?.data;
    }
    return { url: this.view.url, ...d, ...(image ? { image } : {}) };
  }

  private async step(by: -1 | 1): Promise<void> {
    const h = await this.cdp.call("Page.getNavigationHistory");
    const entry = h.entries[h.currentIndex + by];
    if (entry) await this.cdp.call("Page.navigateToHistoryEntry", { entryId: entry.id });
  }

  private async history(): Promise<void> {
    try {
      const h = await this.cdp.call("Page.getNavigationHistory");
      const entry = h.entries[h.currentIndex];
      this.set({ canBack: h.currentIndex > 0, canForward: h.currentIndex < h.entries.length - 1, title: entry?.title ?? "" });
    } catch {
      // A page closing mid-call: the close listener says so.
    }
  }

  private failed(errorText: string): void {
    const error = loadError(errorText);
    if (!error) return;
    this.set({ load: "error", error: error.message });
    if (error.transient) for (const l of this.noticeListeners) l(error.message);
  }

  private log(line: ConsoleLine): void {
    const kept = line.text.length > MAX_LINE ? { ...line, text: `${line.text.slice(0, MAX_LINE)}…` } : line;
    this.console.push(kept);
    if (this.console.length > CONSOLE_LINES) this.console.splice(0, this.console.length - CONSOLE_LINES);
    for (const l of this.consoleListeners) l(kept);
  }

  private set(change: Partial<PageView>): void {
    const next = { ...this.view, ...change };
    if (JSON.stringify(next) === JSON.stringify(this.view)) return;
    this.view = next;
    for (const l of this.changeListeners) l(next);
  }
}

function add<T>(set: Set<T>, listener: T): () => void {
  set.add(listener);
  return () => set.delete(listener);
}

/** What the composer gets for a picked element: the agent reads it as the person's pointer. */
export function elementContext(picked: PickedElement): string {
  const styles = Object.entries(picked.styles)
    .filter(([, v]) => v && v !== "none" && v !== "normal" && v !== "0px" && v !== "auto")
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  const text = picked.text ? ` "${picked.text.replace(/\s+/g, " ").slice(0, 120)}"` : "";
  return [
    `Element on ${picked.url}: <${picked.tag}>${text}`,
    `selector: ${picked.selector}`,
    `box: ${Math.round(picked.box.width)}×${Math.round(picked.box.height)} at ${Math.round(picked.box.x)},${Math.round(picked.box.y)}`,
    ...(styles ? [`styles: ${styles}`] : []),
    "html:",
    "```html",
    picked.html,
    "```",
  ].join("\n");
}
