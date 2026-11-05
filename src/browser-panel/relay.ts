// One page of a native browser view, as a page-level DevTools socket. VS Code's browser views
// (workbench/contrib/browserView) speak CDP at the browser level: a group of views is one
// connection where a page is reached by attaching to its target and sending with its sessionId.
// cedia's browser tool and the block's `Cdp` speak to one page with no sessionId, so the relay
// attaches to the group's page once (flattened) and adds and strips the sessionId on the way.
// The channel is the group service's in the window; a fake one in tests.

import type { Socket } from "./cdp.js";

/** A CDP message as either side sends it. */
export interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
  sessionId?: string;
}

/** A browser-level CDP connection to a group holding one page: VS Code's `IBrowserViewCDPService`. */
export interface BrowserChannel {
  send(message: CdpMessage): void;
  onMessage(listener: (message: CdpMessage) => void): () => void;
  /** Ends the group; the channel sends nothing after. */
  close(): void;
}

/**
 * The domains a run's browser tool may call on the page: reading it, its console, input, and the
 * request interception that keeps it to the project's sites. Nothing that reaches past the page
 * (`Target`, `Browser`, `Storage`, `SystemInfo`, `IO`) passes, so a run holding the bridge's
 * socket drives that one page and nothing else in the window.
 */
export const AGENT_DOMAINS: ReadonlySet<string> = new Set(["Page", "Runtime", "Log", "Fetch", "Input", "DOM", "Network", "Emulation", "Overlay", "Accessibility"]);

/** Whether a run may call `method` through the bridge. */
export function agentMay(method: string): boolean {
  return AGENT_DOMAINS.has(method.split(".")[0] ?? "");
}

/** The relay's own calls use ids no page-level client reaches. */
const OWN_IDS = 2_000_000_000;

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

type Listener = (e: { data: unknown }) => void;

/**
 * The group's page as a `Socket`: "open" once attached, each message the page sends with its
 * sessionId taken off, and "close" when the page goes or the relay is closed.
 */
export class PageRelay implements Socket {
  readyState = CONNECTING;
  private sessionId: string | undefined;
  private nextOwn = OWN_IDS;
  private readonly waiting = new Map<number, (message: CdpMessage) => void>();
  private readonly queued: string[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly off: () => void;

  /** `allow`: the methods callers may send; any other is answered with an error, not sent. */
  constructor(private readonly channel: BrowserChannel, private readonly allow: (method: string) => boolean = () => true) {
    this.off = channel.onMessage((message) => this.receive(message));
    void this.attach();
  }

  send(data: string): void {
    if (this.readyState === CLOSED) return;
    if (this.readyState === CONNECTING) {
      this.queued.push(data);
      return;
    }
    this.forward(data);
  }

  close(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.off();
    this.channel.close();
    this.emit("close");
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener);
  }

  private async attach(): Promise<void> {
    try {
      const targets = await this.own("Target.getTargets");
      const infos = (targets.result?.targetInfos ?? []) as { targetId: string; type: string }[];
      const page = infos.find((t) => t.type === "page");
      if (!page) throw new Error("the browser view has no page");
      const attached = await this.own("Target.attachToTarget", { targetId: page.targetId, flatten: true });
      const sessionId = attached.result?.sessionId;
      if (typeof sessionId !== "string") throw new Error(attached.error?.message ?? "the page did not attach");
      this.sessionId = sessionId;
    } catch {
      if (this.readyState === CONNECTING) {
        this.emit("error");
        this.close();
      }
      return;
    }
    if (this.readyState !== CONNECTING) return;
    this.readyState = OPEN;
    this.emit("open");
    for (const data of this.queued.splice(0)) this.forward(data);
  }

  private own(method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> {
    const id = this.nextOwn++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.channel.send({ id, method, params });
    });
  }

  private forward(data: string): void {
    let message: CdpMessage;
    try {
      message = JSON.parse(data) as CdpMessage;
    } catch {
      return;
    }
    if (message.method !== undefined && !this.allow(message.method)) {
      const refused = { id: message.id, error: { code: -32601, message: `${message.method} is not allowed on this page` } };
      queueMicrotask(() => this.emit("message", JSON.stringify(refused)));
      return;
    }
    this.channel.send({ ...message, sessionId: this.sessionId });
  }

  private receive(message: CdpMessage): void {
    if (message.id !== undefined && this.waiting.has(message.id)) {
      const resolve = this.waiting.get(message.id)!;
      this.waiting.delete(message.id);
      resolve(message);
      return;
    }
    if (this.readyState !== OPEN) return;
    if (message.method === "Target.detachedFromTarget" && message.params?.sessionId === this.sessionId) {
      this.close();
      return;
    }
    if (message.sessionId !== this.sessionId) return;
    const { sessionId: _, ...page } = message;
    this.emit("message", JSON.stringify(page));
  }

  private emit(type: string, data?: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}
