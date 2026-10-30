// A block (spec §3.3, §4.4): one surface of the window, such as the browser, that the Tern-style
// layer can drag, zoom, park and float. The Browser block is the first; the rest follow its shape.
// A block draws into `root` and owns nothing the daemon cannot rebuild: closing one and opening it
// again shows the same thing.

/** Where a block is (spec §4.4): closed → open → focused → (zoomed | parked | torn-off) → closed. */
export type BlockState = "closed" | "open" | "focused" | "zoomed" | "parked" | "torn-off";

export type BlockMove = "open" | "focus" | "blur" | "zoom" | "park" | "tear-off" | "restore" | "close";

/** The state after `move`, or the same state when the move does not apply there. */
export function moveBlock(state: BlockState, move: BlockMove): BlockState {
  if (move === "close") return "closed";
  switch (state) {
    case "closed":
      return move === "open" ? "open" : state;
    case "open":
      return move === "focus" ? "focused" : state;
    case "focused":
      if (move === "blur") return "open";
      if (move === "zoom") return "zoomed";
      if (move === "park") return "parked";
      if (move === "tear-off") return "torn-off";
      return state;
    case "zoomed":
    case "parked":
    case "torn-off":
      return move === "restore" ? "focused" : state;
  }
}

/** What the window's layer needs of a block. */
export interface Block {
  /** The block's kind, one per surface: "browser". */
  readonly kind: string;
  readonly root: HTMLElement;
  /** What the block's header says now: the page's title, the thread's. */
  title(): string;
  /** Called when the title changes. */
  onTitle(listener: (title: string) => void): () => void;
  /** The space the layer gives it, in CSS pixels. */
  layout(width: number, height: number): void;
  focus(): void;
  dispose(): void;
}
