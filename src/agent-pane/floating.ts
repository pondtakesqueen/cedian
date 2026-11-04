// The agent pane as a block (spec §3.3, §9 Side chat): a thread floating over the window in the
// block layer, its own pane on the window's one daemon connection. Which thread it shows is kept
// with where it floats, so a new window opens the same one.
import type { Block } from "../blocks/block.js";
import type { Notice } from "../protocol/wire.js";
import type { AgentPane } from "./pane.js";

/** What the block needs: the pane, its wire's notices, and what to let go of when it closes. */
export interface AgentBlockParts {
  pane: AgentPane;
  /** Notices on the pane's wire, heard after the pane's own listener. */
  onAny(listener: (notice: Notice) => void): () => void;
  /** Lets go of the pane's wire and anything else drawn with it. */
  release(): void;
}

export class AgentBlock implements Block {
  readonly kind = "agent";
  private readonly listeners = new Set<(title: string) => void>();
  private readonly off: () => void;
  private shown: string;

  constructor(private readonly parts: AgentBlockParts) {
    this.shown = this.said();
    this.off = parts.onAny(() => this.check());
  }

  get root(): HTMLElement {
    return this.parts.pane.root;
  }

  /** The thread it shows; none for a new thread not sent yet. */
  get id(): string | undefined {
    return this.parts.pane.thread;
  }

  title(): string {
    return this.parts.pane.title();
  }

  onTitle(listener: (title: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Tells the listeners when the title or the thread changed: a picked thread, a new one sent. */
  check(): void {
    const now = this.said();
    if (now === this.shown) return;
    this.shown = now;
    for (const l of this.listeners) l(this.title());
  }

  layout(_width: number, height: number): void {
    this.root.style.height = `${height}px`;
  }

  focus(): void {
    this.parts.pane.focusComposer();
  }

  dispose(): void {
    this.off();
    this.parts.pane.dispose();
    this.parts.release();
    this.root.remove();
  }

  private said(): string {
    return `${this.id ?? ""}\n${this.title()}`;
  }
}
