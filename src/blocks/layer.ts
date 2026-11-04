// The window's block layer (spec §3.3, §4.4): blocks floating over the workbench as PiPs. A block
// floats in a corner, drags and flings to another, stashes against a side with a tab left showing,
// expands to fill the frame, and docks back into the editor area. Several in one corner stack.
// It takes any `Block`; the Browser block is the first. Where each rests is the daemon's to keep
// (`desktop.layout`); the layer says when that changed and draws what it is given.
import { button, el } from "../dom/el.js";
import { moveBlock, type Block, type BlockState } from "./block.js";
import type { Floating } from "./layout.js";
import { fit, GAP, place, PIP_SIZE, settle, sideOf, step, velocityOf, type Point, type Rect, type Rest, type Size } from "./pip.js";

/** The height of a floating block's header, where it is dragged from. */
export const HEAD = 30;

/** What the layer needs from the window around it. */
export interface LayerHost {
  /** Puts a block of `kind` back in the editor area. The layer has already closed its own. */
  dock(kind: string): void;
  /** What floats, or where, changed: the host asks the daemon to keep `floating`. */
  changed(floating: Floating[]): void;
  /** A block of `kind` was closed from its header. */
  closed?(kind: string): void;
}

interface Pip {
  block: Block;
  rest: Rest;
  size: Size;
  state: BlockState;
  node: HTMLElement;
  title: HTMLElement;
  expand: HTMLButtonElement;
  tab: HTMLButtonElement;
  offs: (() => void)[];
}

type Arrow = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
const ARROWS: readonly string[] = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

export class BlockLayer {
  readonly root: HTMLElement;
  private readonly pips: Pip[] = [];
  private frame: Size = { width: 0, height: 0 };
  private readonly offs: (() => void)[] = [];

  constructor(private readonly doc: Document, private readonly host: LayerHost) {
    this.root = el(doc, "div", "cedian-blocks");
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => this.layout(this.root.clientWidth, this.root.clientHeight));
      observer.observe(this.root);
      this.offs.push(() => observer.disconnect());
    }
  }

  /** The frame's size: the space the blocks float in. */
  layout(width: number, height: number): void {
    if (width === this.frame.width && height === this.frame.height) return;
    this.frame = { width, height };
    this.draw();
  }

  /** The blocks floating now, in the order they were floated, as `desktop.layout` keeps them. */
  floating(): Floating[] {
    return this.pips.map((p) => ({ kind: p.block.kind, ...p.rest, width: p.size.width, height: p.size.height }));
  }

  has(kind: string): boolean {
    return this.pips.some((p) => p.block.kind === kind);
  }

  /** The state of the block of `kind` floating here (spec §4.4), or closed. */
  stateOf(kind: string): BlockState {
    return this.find(kind)?.state ?? "closed";
  }

  /**
   * Floats `block` resting at `at` (else the bottom-right corner) at its size (else the default).
   * A block of the same kind already floating is closed first: one per kind.
   */
  float(block: Block, at?: Partial<Floating>, quiet = false): void {
    this.drop(block.kind);
    const d = this.doc;
    const node = el(d, "div", "cedian-pip");
    node.dataset.kind = block.kind;
    node.setAttribute("role", "group");
    const head = el(d, "div", "pip-head");
    head.tabIndex = 0;
    head.title = "Drag to a corner, or fling it at a side to stash it. Arrow keys move it.";
    const title = el(d, "span", "pip-title");
    const stash = button(d, "⇥", () => this.stash(block.kind), "ibtn pip-stash");
    stash.setAttribute("aria-label", "Stash against the side");
    stash.title = "Stash against the side";
    const expand = button(d, "⤢", () => this.expand(block.kind), "ibtn pip-expand");
    expand.setAttribute("aria-pressed", "false");
    const dock = button(d, "⧉", () => this.dock(block.kind), "ibtn pip-dock");
    dock.setAttribute("aria-label", "Back into the editor");
    dock.title = "Back into the editor";
    const close = button(d, "×", () => this.close(block.kind), "ibtn pip-close");
    close.setAttribute("aria-label", "Close");
    close.title = "Close";
    head.append(title, stash, expand, dock, close);
    const body = el(d, "div", "pip-body");
    body.append(block.root);
    const tab = button(d, "", () => this.unstash(block.kind), "pip-tab");
    node.append(head, body, tab);
    const pip: Pip = {
      block,
      rest: { corner: at?.corner ?? "br", ...(at?.stash ? { stash: at.stash } : {}) },
      size: { width: at?.width ?? PIP_SIZE.width, height: at?.height ?? PIP_SIZE.height },
      state: moveBlock(moveBlock("closed", "open"), "focus"),
      node,
      title,
      expand,
      tab,
      offs: [],
    };
    if (pip.rest.stash) pip.state = moveBlock(pip.state, "park");
    pip.offs.push(block.onTitle(() => this.drawTitle(pip)));
    this.drag(pip, head);
    head.addEventListener("keydown", (e) => {
      if (ARROWS.includes(e.key) && e.target === head) {
        e.preventDefault();
        this.moveTo(block.kind, { corner: step(pip.rest.corner, e.key as Arrow) });
      }
    });
    this.pips.push(pip);
    this.root.append(node);
    this.drawTitle(pip);
    this.draw();
    if (!quiet) this.changed();
  }

  /** Rests the block of `kind` at `rest`, out of the stash and back to its size. */
  moveTo(kind: string, rest: Rest): void {
    const pip = this.find(kind);
    if (!pip) return;
    pip.rest = rest.stash ? { corner: rest.corner, stash: rest.stash } : { corner: rest.corner };
    pip.state = rest.stash ? moveBlock(this.restored(pip), "park") : this.restored(pip);
    this.draw();
    this.changed();
  }

  /** Stashes the block of `kind` against its corner's side, a tab left showing. */
  stash(kind: string): void {
    const pip = this.find(kind);
    if (pip) this.moveTo(kind, { corner: pip.rest.corner, stash: sideOf(pip.rest.corner) });
  }

  unstash(kind: string): void {
    const pip = this.find(kind);
    if (!pip) return;
    this.moveTo(kind, { corner: pip.rest.corner });
    pip.block.focus();
  }

  /** Expands the block of `kind` to fill the frame, or shrinks it back to its corner. */
  expand(kind: string): void {
    const pip = this.find(kind);
    if (!pip) return;
    if (pip.state === "zoomed") pip.state = moveBlock(pip.state, "restore");
    else {
      if (pip.rest.stash) pip.rest = { corner: pip.rest.corner };
      pip.state = moveBlock(this.restored(pip), "zoom");
    }
    this.draw();
    this.changed();
    pip.block.focus();
  }

  /** Closes the block of `kind` here and puts it back in the editor area. */
  dock(kind: string): void {
    if (!this.find(kind)) return;
    this.drop(kind);
    this.changed();
    this.host.dock(kind);
  }

  close(kind: string): void {
    if (!this.find(kind)) return;
    this.drop(kind);
    this.changed();
    this.host.closed?.(kind);
  }

  dispose(): void {
    for (const pip of [...this.pips]) this.drop(pip.block.kind);
    for (const off of this.offs) off();
    this.root.remove();
  }

  // ---- drawing ----

  private find(kind: string): Pip | undefined {
    return this.pips.find((p) => p.block.kind === kind);
  }

  /** The state out of a zoom or a stash, focused. */
  private restored(pip: Pip): BlockState {
    return pip.state === "zoomed" || pip.state === "parked" ? moveBlock(pip.state, "restore") : pip.state;
  }

  private drop(kind: string): void {
    const at = this.pips.findIndex((p) => p.block.kind === kind);
    if (at < 0) return;
    const [pip] = this.pips.splice(at, 1);
    for (const off of pip.offs) off();
    pip.block.dispose();
    pip.node.remove();
    this.draw();
  }

  private changed(): void {
    this.host.changed(this.floating());
  }

  private drawTitle(pip: Pip): void {
    const title = pip.block.title();
    pip.title.textContent = title;
    pip.node.setAttribute("aria-label", `${title}, floating`);
    pip.tab.setAttribute("aria-label", `Bring back ${title}`);
    pip.tab.title = `Bring back ${title}`;
  }

  /** The place of each block: zoomed fills the frame, else its corner and its place in the stack. */
  private rectOf(pip: Pip): Rect {
    if (pip.state === "zoomed") return { x: GAP, y: GAP, width: Math.max(0, this.frame.width - 2 * GAP), height: Math.max(0, this.frame.height - 2 * GAP) };
    const same = this.pips.filter((p) => p.state !== "zoomed" && p.rest.corner === pip.rest.corner && p.rest.stash === pip.rest.stash);
    return place(pip.rest, pip.size, this.frame, same.indexOf(pip));
  }

  private draw(): void {
    if (!this.frame.width || !this.frame.height) return;
    for (const pip of this.pips) this.put(pip, this.rectOf(pip));
  }

  private put(pip: Pip, rect: Rect): void {
    const n = pip.node;
    n.style.transform = `translate(${Math.round(rect.x)}px, ${Math.round(rect.y)}px)`;
    n.style.width = `${Math.round(rect.width)}px`;
    n.style.height = `${Math.round(rect.height)}px`;
    n.classList.toggle("zoomed", pip.state === "zoomed");
    n.classList.toggle("stashed", pip.state === "parked");
    n.dataset.corner = pip.rest.corner;
    if (pip.rest.stash) n.dataset.stash = pip.rest.stash;
    else delete n.dataset.stash;
    pip.tab.hidden = pip.state !== "parked";
    pip.expand.setAttribute("aria-pressed", String(pip.state === "zoomed"));
    const label = pip.state === "zoomed" ? "Shrink back to its corner" : "Expand to fill the window";
    pip.expand.setAttribute("aria-label", label);
    pip.expand.title = label;
    pip.block.layout(Math.round(rect.width), Math.max(0, Math.round(rect.height) - HEAD));
  }

  // ---- dragging ----

  /** Drags by the header; let go, the block settles in a corner or a stash, flung on at its speed. */
  private drag(pip: Pip, head: HTMLElement): void {
    let grab: { from: Point; at: Rect; samples: (Point & { t: number })[]; id: number } | undefined;
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button") || pip.state === "zoomed") return;
      e.preventDefault();
      const at = pip.state === "parked" ? place({ corner: pip.rest.corner }, pip.size, this.frame) : this.rectOf(pip);
      grab = { from: { x: e.clientX, y: e.clientY }, at, samples: [{ x: e.clientX, y: e.clientY, t: now() }], id: e.pointerId };
      head.setPointerCapture?.(e.pointerId);
      pip.node.classList.add("dragging");
    };
    const move = (e: PointerEvent) => {
      if (!grab || e.pointerId !== grab.id) return;
      grab.samples.push({ x: e.clientX, y: e.clientY, t: now() });
      if (grab.samples.length > 8) grab.samples.shift();
      const dx = e.clientX - grab.from.x;
      const dy = e.clientY - grab.from.y;
      pip.node.style.transform = `translate(${Math.round(grab.at.x + dx)}px, ${Math.round(grab.at.y + dy)}px)`;
    };
    const up = (e: PointerEvent) => {
      if (!grab || e.pointerId !== grab.id) return;
      const g = grab;
      grab = undefined;
      // Where and when it was let go: held still a moment first, it is dropped, not flung.
      g.samples.push({ x: e.clientX, y: e.clientY, t: now() });
      head.releasePointerCapture?.(e.pointerId);
      pip.node.classList.remove("dragging");
      const dx = e.clientX - g.from.x;
      const dy = e.clientY - g.from.y;
      // A click on the header is not a move.
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        this.draw();
        if (pip.state === "parked") this.unstash(pip.block.kind);
        return;
      }
      const size = fit(pip.size, this.frame);
      const rest = settle({ x: g.at.x + dx, y: g.at.y + dy, ...size }, velocityOf(g.samples), this.frame);
      this.moveTo(pip.block.kind, rest);
    };
    head.addEventListener("pointerdown", down);
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up);
    head.addEventListener("pointercancel", up);
    pip.offs.push(() => {
      head.removeEventListener("pointerdown", down);
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", up);
      head.removeEventListener("pointercancel", up);
    });
  }
}
