// The window's side of `cedian_wire`: requests out, notices in, over whatever carries the lines
// (the app's main process relays them to `daemon.sock`). The daemon owns all state, so after a
// reconnect the client asks again for what it was watching (the project's threads, the open
// thread), and the daemon sends it all again: reconcile is a replay, never a merge.
import type { Notice, Request } from "../protocol/wire.js";

export type ConnectionState = "connecting" | "connected" | "disconnected";

/** What carries the lines; `send` is only called while connected. */
export interface Transport {
  send(line: string): void;
  onLine(listener: (line: string) => void): void;
  onState(listener: (state: ConnectionState) => void): void;
}

export type NoticeKind = Notice["kind"];
export type NoticeOf<K extends NoticeKind> = Extract<Notice, { kind: K }>;

/** Requests that say what a window watches, sent again after a reconnect. */
type Watch = Extract<Request, { op: "threads" | "open" | "background" | "settings" }>;

export class DaemonClient {
  private state: ConnectionState = "connecting";
  private readonly waiting: Request[] = [];
  private readonly watches = new Map<string, Watch>();
  private readonly listeners = new Map<NoticeKind | "*", Set<(notice: Notice) => void>>();
  private readonly stateListeners = new Set<(state: ConnectionState) => void>();
  /** Lines that did not parse, for the log. */
  readonly unreadable: string[] = [];
  /** The daemon's latest welcome, for a listener that starts after it came. */
  welcome?: NoticeOf<"welcome">;

  constructor(private readonly transport: Transport) {
    transport.onLine((line) => this.receive(line));
    transport.onState((state) => this.setState(state));
  }

  get connection(): ConnectionState {
    return this.state;
  }

  /** Sends now when connected, else when the connection comes back. */
  request(request: Request): void {
    this.remember(request);
    if (this.state === "connected") this.transport.send(JSON.stringify(request));
    else if (!isWatch(request)) this.waiting.push(request);
  }

  on<K extends NoticeKind>(kind: K, listener: (notice: NoticeOf<K>) => void): () => void {
    return this.listen(kind, listener as (notice: Notice) => void);
  }

  /** Every notice, in order. */
  onAny(listener: (notice: Notice) => void): () => void {
    return this.listen("*", listener);
  }

  onConnection(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private listen(kind: NoticeKind | "*", listener: (notice: Notice) => void): () => void {
    let set = this.listeners.get(kind);
    if (!set) this.listeners.set(kind, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  private remember(request: Request): void {
    switch (request.op) {
      case "threads":
      case "background":
        this.watches.set(`${request.op}:${request.cwd}`, request);
        break;
      case "settings":
        this.watches.set("settings", request);
        break;
      case "open":
        // One open thread per pane: the latest open replaces the one before.
        this.watches.set(`open:${request.thread}`, request);
        break;
      case "close":
        this.watches.delete(`open:${request.thread}`);
        break;
    }
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    if (state === "connected") {
      for (const watch of this.watches.values()) this.transport.send(JSON.stringify(watch));
      for (const request of this.waiting.splice(0)) this.transport.send(JSON.stringify(request));
    }
    for (const listener of this.stateListeners) listener(state);
  }

  private receive(line: string): void {
    let notice: Notice;
    try {
      notice = JSON.parse(line) as Notice;
    } catch {
      this.unreadable.push(line);
      return;
    }
    if (typeof notice !== "object" || notice === null || typeof notice.kind !== "string") {
      this.unreadable.push(line);
      return;
    }
    if (notice.kind === "welcome") this.welcome = notice;
    for (const listener of this.listeners.get(notice.kind) ?? []) listener(notice);
    for (const listener of this.listeners.get("*") ?? []) listener(notice);
  }
}

function isWatch(request: Request): request is Watch {
  return request.op === "threads" || request.op === "open" || request.op === "background" || request.op === "settings";
}
