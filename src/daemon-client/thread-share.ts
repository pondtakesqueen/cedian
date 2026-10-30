// Several agent panes in one window (the side pane and those popped out into windows of their
// own) share the window's one connection. The daemon keeps which threads a connection has open
// as a set, so one pane closing a thread would stop the notices another pane still draws. Each
// pane talks through a view of this share instead: an `open` always goes through (the pane that
// asked needs the thread drawn from the start), and a `close` only once no pane has it open.
import type { Wire } from "../dom/el.js";
import type { Notice, Request } from "../protocol/wire.js";

export interface PaneWire extends Wire<Request, Notice> {
  /** Closes what this pane still has open, as `close` would one by one. */
  dispose(): void;
}

export class ThreadShare {
  /** How many panes have each thread open. */
  private readonly counts = new Map<string, number>();

  constructor(private readonly wire: Wire<Request, Notice>) {}

  /** Whether any pane has `thread` open. */
  isOpen(thread: string): boolean {
    return (this.counts.get(thread) ?? 0) > 0;
  }

  /** A pane's own wire. */
  view(): PaneWire {
    const mine = new Set<string>();
    const close = (thread: string) => {
      if (!mine.delete(thread)) return;
      const left = (this.counts.get(thread) ?? 1) - 1;
      if (left > 0) this.counts.set(thread, left);
      else {
        this.counts.delete(thread);
        this.wire.request({ op: "close", thread });
      }
    };
    return {
      request: (request) => {
        if (request.op === "open") {
          if (!mine.has(request.thread)) {
            mine.add(request.thread);
            this.counts.set(request.thread, (this.counts.get(request.thread) ?? 0) + 1);
          }
          this.wire.request(request);
        } else if (request.op === "close") close(request.thread);
        else this.wire.request(request);
      },
      onAny: (listener) => this.wire.onAny(listener),
      dispose: () => [...mine].forEach(close),
    };
  }
}
