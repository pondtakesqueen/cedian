// A DevTools protocol connection to one page of the daemon's Chromium, over a WebSocket the
// window opens to it (the daemon hands out the page's socket in `Notice::Browser`). The window's
// own WebSocket in the app, Node's in tests: both fit `Socket`.

/** The part of a WebSocket the connection uses. */
export interface Socket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (e: { data: unknown }) => void): void;
}

/** §8.1: what a transient browser failure says. */
export const TIMED_OUT = "the connection timed out";

const CALL_TIMEOUT_MS = 15_000;
const OPEN = 1;

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

export class Cdp {
  private next = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<(params: any) => void>>();
  private readonly closeListeners = new Set<() => void>();
  private readonly opened: Promise<void>;
  private closed = false;

  constructor(private readonly socket: Socket, private readonly timeoutMs = CALL_TIMEOUT_MS) {
    this.opened = new Promise((resolve, reject) => {
      if (socket.readyState === OPEN) return resolve();
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error("the browser block closed before its page opened")));
    });
    // A socket that fails before it opens has no listener for the rejection yet.
    this.opened.catch(() => {});
    socket.addEventListener("message", (e) => this.receive(e.data));
    socket.addEventListener("close", () => this.end());
  }

  /** Whether the socket went away. */
  get isClosed(): boolean {
    return this.closed;
  }

  async call<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.opened;
    if (this.closed) throw new Error("the browser block closed before its page opened");
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(TIMED_OUT));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event: string, listener: (params: any) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): void {
    this.socket.close();
    this.end();
  }

  private receive(data: unknown): void {
    let message: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const call = this.pending.get(message.id);
      if (!call) return;
      this.pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error) call.reject(new Error(message.error.message ?? "the browser refused the call"));
      else call.resolve(message.result);
    } else if (message.method) {
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
    }
  }

  private end(): void {
    if (this.closed) return;
    this.closed = true;
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error("the browser block closed before its page opened"));
    }
    this.pending.clear();
    for (const listener of this.closeListeners) listener();
  }
}
