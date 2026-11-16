// The window's block layer (spec §3.3, §4.4): blocks floating over the workbench as PiPs. A block
// floats in a corner, drags and flings to another, stashes against a side with a tab left showing,
// expands to fill the frame, and docks back into the editor area. Several in one corner stack.
// It takes any `Block`; the Browser block is the first. Where each rests is the daemon's to keep
// (`desktop.layout`); the layer says when that changed and draws what it is given.
import { closing, opening } from "./motion.js";
import { button, el } from "../dom/el.js";
import { moveBlock, type Block, type BlockState } from "./block.js";
import type { Floating } from "./layout.js";
import { arrange, fan, fit, GAP, place, PIP_SIZE, resized, settle, sideOf, step, velocityOf, type Point, type Rect, type Rest, type Size } from "./pip.js";

/** The height of a floating block's header, where it is dragged from. */
export const HEAD = 30;

/**
 * How far a card's shadow reaches past it (blocks.css: 0 12px 32px). A card opening or closing is
 * clipped this much wider than itself, so its edge and shadow move with it instead of the card
 * showing flat against the editor and its shadow popping in at the end.
 */
const SHADOW = 48;
/** The whole card and its shadow. */
const CARD = `inset(${-SHADOW}px ${-SHADOW}px ${-SHADOW}px ${-SHADOW}px round 12px)`;

/** What the layer needs from the window around it. */
export interface LayerHost {
  /** Puts a block of `kind` back in the editor area, showing `id` when it showed one (an agent's
   * thread). The layer has already closed its own. */
  dock(kind: string, id?: string): void;
  /** Where a block docked into lands, in the window's CSS pixels, once it is there: the layer's
   * block slides to it. Without it, the block goes where it is. */
  landing?(kind: string): { left: number; top: number; width: number; height: number } | undefined;
  /** Whether the window moves (off with reduced motion). Without it, blocks come and go at once. */
  moving?(): boolean;
  /** What floats, or where, changed: the host asks the daemon to keep `floating`. */
  changed(floating: Floating[]): void;
  /** A block of `kind` was closed from its header. */
  closed?(kind: string): void;
  /**
   * Opens a block of `kind` (showing `id`) in a window of its own at `bounds`, in screen pixels:
   * torn off, by its header's ↗ or let go outside the window. The layer has already closed its
   * own. Without it, blocks are not torn off.
   */
  tearOff?(kind: string, id: string | undefined, bounds: Rect): void;
}

/** Whether `point` (in the window's CSS pixels) is outside a window of `view`'s size. */
export function outside(point: Point, view: Size): boolean {
  return point.x < 0 || point.y < 0 || point.x >= view.width || point.y >= view.height;
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
/** How much Shift+arrow grows or shrinks a floating block. */
export const KEY_RESIZE = 40;

export class BlockLayer {
  readonly root: HTMLElement;
  private readonly pips: Pip[] = [];
  private frame: Size = { width: 0, height: 0 };
  /** The z-index of the block brought forward last. */
  private top = 0;
  private readonly offs: (() => void)[] = [];
  /** Fanned out (Tern's deck): every block a card across the middle, until one is picked. */
  private fanned = false;
  /** Behind the fan's cards: a click there folds it. */
  private readonly scrim: HTMLElement;

  constructor(private readonly doc: Document, private readonly host: LayerHost) {
    this.root = el(doc, "div", "cedian-blocks");
    this.scrim = el(doc, "div", "pip-scrim");
    this.scrim.hidden = true;
    this.scrim.setAttribute("aria-hidden", "true");
    this.root.append(this.scrim);
    const fold = () => this.fold();
    const key = (e: KeyboardEvent) => {
      if (this.fanned && e.key === "Escape") {
        e.preventDefault();
        this.fold();
      }
    };
    this.scrim.addEventListener("pointerdown", fold);
    this.root.addEventListener("keydown", key);
    this.offs.push(() => {
      this.scrim.removeEventListener("pointerdown", fold);
      this.root.removeEventListener("keydown", key);
    });
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
    return this.pips.filter((p) => !p.block.throwaway).map((p) => ({ kind: p.block.kind, ...(p.block.id ? { id: p.block.id } : {}), ...p.rest, width: p.size.width, height: p.size.height }));
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
    if (this.fanned) this.fold();
    this.drop(block.kind);
    const d = this.doc;
    const node = el(d, "div", "cedian-pip");
    node.dataset.kind = block.kind;
    node.setAttribute("role", "group");
    const head = el(d, "div", "pip-head");
    head.tabIndex = 0;
    head.title = "Drag to a corner, or fling it at a side to stash it. Arrow keys move it; Shift+arrows resize it.";
    const title = el(d, "span", "pip-title");
    const stash = button(d, "⇥", () => this.stash(block.kind), "ibtn pip-stash");
    stash.setAttribute("aria-label", "Stash against the side");
    stash.title = "Stash against the side";
    const expand = button(d, "⤢", () => this.expand(block.kind), "ibtn pip-expand");
    expand.setAttribute("aria-pressed", "false");
    const dock = button(d, "⧉", () => this.dock(block.kind), "ibtn pip-dock");
    dock.setAttribute("aria-label", "Back into the editor");
    dock.title = "Back into the editor";
    const tearable = !!this.host.tearOff && !block.throwaway;
    const tear = button(d, "↗", () => this.tearOff(block.kind), "ibtn pip-tear");
    tear.setAttribute("aria-label", "Open in a new window");
    tear.title = "Open in a new window (or drag it out of the window)";
    const close = button(d, "×", () => this.close(block.kind), "ibtn pip-close");
    close.setAttribute("aria-label", "Close");
    close.title = "Close";
    head.append(title, stash, expand, ...(block.throwaway ? [] : [dock]), ...(tearable ? [tear] : []), close);
    const body = el(d, "div", "pip-body");
    body.append(block.root);
    const tab = button(d, "", () => this.unstash(block.kind), "pip-tab");
    const grips = (["x", "y", "xy"] as const).map((axes) => {
      const grip = el(d, "div", `pip-grip g-${axes}`);
      grip.dataset.axes = axes;
      grip.setAttribute("aria-hidden", "true");
      return grip;
    });
    node.append(head, body, tab, ...grips);
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
    pip.offs.push(
      block.onTitle(() => {
        this.drawTitle(pip);
        // A block that shows one of many (an agent's thread) may show another now.
        if (block.id !== undefined) this.changed();
      }),
    );
    this.drag(pip, head);
    for (const grip of grips) this.resize(pip, grip);
    head.addEventListener("keydown", (e) => {
      if (this.fanned && (e.key === "Enter" || e.key === " ") && e.target === head) {
        e.preventDefault();
        return this.fold(block.kind);
      }
      if (this.fanned || !ARROWS.includes(e.key) || e.target !== head) return;
      e.preventDefault();
      if (e.shiftKey) this.resizeBy(block.kind, e.key as Arrow);
      else this.moveTo(block.kind, { corner: step(pip.rest.corner, e.key as Arrow) });
    });
    // The block in use comes forward, so its header and buttons are never under another's.
    const forward = () => this.raise(pip);
    // Fanned, a press anywhere on a card picks it: nothing inside it takes the press.
    const pick = (e: PointerEvent) => {
      if (!this.fanned || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.fold(block.kind);
    };
    node.addEventListener("pointerdown", pick, true);
    node.addEventListener("pointerdown", forward, true);
    node.addEventListener("focusin", forward);
    pip.offs.push(() => {
      node.removeEventListener("pointerdown", pick, true);
      node.removeEventListener("pointerdown", forward, true);
      node.removeEventListener("focusin", forward);
    });
    this.pips.push(pip);
    this.root.append(node);
    this.raise(pip);
    this.drawTitle(pip);
    this.draw();
    // Opens from its header down, as a drawer: never scaled, never faded.
    if (!quiet && this.host.moving?.() && typeof node.animate === "function") {
      node.animate([{ clipPath: `inset(${-SHADOW}px ${-SHADOW}px calc(100% - ${HEAD}px) ${-SHADOW}px round 12px)` }, { clipPath: CARD }], opening);
    }
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

  /** Sets the size of the block of `kind`, fitted to the frame, out of a zoom or a stash. */
  resizeTo(kind: string, size: Size): void {
    const pip = this.find(kind);
    if (!pip) return;
    const fitted = this.frame.width && this.frame.height ? fit(size, this.frame) : size;
    pip.size = { width: Math.round(fitted.width), height: Math.round(fitted.height) };
    if (pip.rest.stash) pip.rest = { corner: pip.rest.corner };
    pip.state = this.restored(pip);
    this.draw();
    this.changed();
  }

  /** Shift+arrow: right and down grow the block, left and up shrink it. */
  private resizeBy(kind: string, key: Arrow): void {
    const pip = this.find(kind);
    if (!pip) return;
    const d = key === "ArrowRight" || key === "ArrowDown" ? KEY_RESIZE : -KEY_RESIZE;
    const across = key === "ArrowLeft" || key === "ArrowRight";
    const now = this.frame.width ? fit(pip.size, this.frame) : pip.size;
    this.resizeTo(kind, { width: now.width + (across ? d : 0), height: now.height + (across ? 0 : d) });
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
      this.raise(pip);
    }
    this.draw();
    this.changed();
    pip.block.focus();
  }

  /** Closes the block of `kind` here and puts it back in the editor area. */
  dock(kind: string): void {
    const pip = this.find(kind);
    if (!pip || pip.block.throwaway) return;
    const id = pip.block.id;
    const leaving = this.detach(kind);
    this.changed();
    this.host.dock(kind, id);
    // It slides to the block it lands in and goes into it there.
    if (leaving) this.leave(leaving, this.host.landing?.(kind));
  }

  /**
   * Tears the block of `kind` off into a window of its own: at `bounds` (screen pixels) when
   * given, else where it is drawn now. A throwaway block (a side chat) stays.
   */
  tearOff(kind: string, bounds?: Rect): void {
    const pip = this.find(kind);
    if (!pip || pip.block.throwaway || !this.host.tearOff) return;
    const id = pip.block.id;
    const at = bounds ?? this.onScreen(pip);
    const leaving = this.detach(kind);
    this.changed();
    this.host.tearOff(kind, id, at);
    if (leaving) this.leave(leaving);
  }

  /** Where `pip` is drawn, in screen pixels. */
  private onScreen(pip: Pip): Rect {
    const view = this.doc.defaultView;
    const r = pip.node.getBoundingClientRect();
    const shown = this.rectOf(pip);
    return { x: Math.round((view?.screenX ?? 0) + r.left), y: Math.round((view?.screenY ?? 0) + r.top), width: Math.round(shown.width), height: Math.round(shown.height) };
  }

  close(kind: string): void {
    const leaving = this.detach(kind);
    if (!leaving) return;
    this.changed();
    this.host.closed?.(kind);
    this.leave(leaving);
  }

  get isFanned(): boolean {
    return this.fanned;
  }

  /**
   * Fans the floating blocks out (Tern's deck of PiPs): each, stashed ones too, a card at its own
   * shape across the middle of the frame, to see them all at once. A click on one (or Enter on its
   * header) brings it back to its corner, out of a stash, in front; Escape or a click beside the
   * cards folds them back as they were. Nothing about where they rest changes.
   */
  fan(): void {
    if (this.fanned || this.pips.length === 0) return;
    this.fanned = true;
    this.root.classList.add("fanned");
    this.scrim.hidden = false;
    this.draw();
    const last = this.pips.reduce((a, b) => (Number(b.node.style.zIndex) > Number(a.node.style.zIndex) ? b : a));
    last.node.querySelector<HTMLElement>(".pip-head")?.focus();
  }

  /** Folds the fan back; `pick` comes out in front, focused, out of its stash or zoom. */
  fold(pick?: string): void {
    if (!this.fanned) return;
    this.fanned = false;
    this.root.classList.remove("fanned");
    this.scrim.hidden = true;
    for (const p of this.pips) {
      p.node.style.zIndex = p.node.dataset.z ?? p.node.style.zIndex;
      delete p.node.dataset.z;
    }
    const pip = pick ? this.find(pick) : undefined;
    if (!pip) return this.draw();
    if (pip.state === "parked" || pip.state === "zoomed") this.moveTo(pip.block.kind, { corner: pip.rest.corner });
    else this.draw();
    this.raise(pip);
    pip.block.focus();
  }

  toggleFan(): void {
    if (this.fanned) this.fold();
    else this.fan();
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
    const pip = this.detach(kind);
    if (!pip) return;
    pip.block.dispose();
    pip.node.remove();
  }

  /** Takes the block of `kind` out of the layer; its node stays until `leave` or `drop` takes it. */
  private detach(kind: string): Pip | undefined {
    const at = this.pips.findIndex((p) => p.block.kind === kind);
    if (at < 0) return undefined;
    const [pip] = this.pips.splice(at, 1);
    for (const off of pip.offs) off();
    if (this.fanned && this.pips.length === 0) this.fold();
    this.draw();
    return pip;
  }

  /**
   * Shows a block that went leaving, then disposes of it: it collapses into its header's top edge
   * (closed, torn off), or slides to `to` (window CSS pixels) and is clipped to it there (docked).
   * On the closing timing, never scaled, never faded.
   */
  private leave(pip: Pip, to?: { left: number; top: number; width: number; height: number }): void {
    const node = pip.node;
    const gone = () => {
      pip.block.dispose();
      node.remove();
    };
    pip.block.leaving?.();
    if (!this.host.moving?.() || typeof node.animate !== "function") return gone();
    node.style.transition = "none";
    node.style.pointerEvents = "none";
    const from = node.getBoundingClientRect();
    const at = node.style.transform || "none";
    const frames: Keyframe[] = to
      ? [
          { transform: at, clipPath: CARD },
          {
            transform: `translate(${Math.round(to.left - from.left)}px, ${Math.round(to.top - from.top)}px) ${at === "none" ? "" : at}`.trim(),
            clipPath: `inset(0px ${Math.max(0, Math.round(from.width - to.width))}px ${Math.max(0, Math.round(from.height - to.height))}px 0px round 12px)`,
          },
        ]
      : [{ clipPath: CARD }, { clipPath: `inset(${-SHADOW}px ${-SHADOW}px calc(100% + ${SHADOW}px) ${-SHADOW}px round 12px)` }];
    const run = node.animate(frames, { ...closing, fill: "forwards" });
    run.onfinish = gone;
    run.oncancel = gone;
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

  /**
   * The place of each block: zoomed fills the frame, else its corner, stacked after the ones before
   * it there, sharing the frame with blocks in other corners (`arrange`). `sized` draws one block
   * at another size, as while its grip is held.
   */
  private rects(sized?: { pip: Pip; size: Size }): Map<Pip, Rect> {
    const out = new Map<Pip, Rect>();
    const resting = this.pips.filter((p) => p.state !== "zoomed");
    const placed = arrange(resting.map((p) => ({ rest: p.rest, size: sized?.pip === p ? sized.size : p.size })), this.frame);
    resting.forEach((p, i) => out.set(p, placed[i]));
    for (const p of this.pips) {
      if (p.state === "zoomed") out.set(p, { x: GAP, y: GAP, width: Math.max(0, this.frame.width - 2 * GAP), height: Math.max(0, this.frame.height - 2 * GAP) });
    }
    return out;
  }

  private rectOf(pip: Pip): Rect {
    return this.rects().get(pip)!;
  }

  private draw(sized?: { pip: Pip; size: Size }): void {
    if (!this.frame.width || !this.frame.height) return;
    if (this.fanned) return this.drawFan();
    for (const [pip, rect] of this.rects(sized)) this.put(pip, rect);
  }

  /** Each block a card at its own size, scaled and tilted into the fan, later ones in front. */
  private drawFan(): void {
    const sizes = this.pips.map((p) => fit(p.size, this.frame));
    const cards = fan(sizes, this.frame);
    this.pips.forEach((pip, i) => {
      const { width, height } = sizes[i];
      const card = cards[i];
      const n = pip.node;
      n.dataset.z ??= n.style.zIndex;
      n.style.zIndex = String(this.top + 1 + i);
      n.style.transform = `translate(${card.x}px, ${card.y}px) rotate(${card.angle}deg) scale(${card.scale.toFixed(4)})`;
      n.style.width = `${Math.round(width)}px`;
      n.style.height = `${Math.round(height)}px`;
      n.classList.remove("zoomed", "stashed");
      pip.tab.hidden = true;
      pip.block.layout(Math.round(width), Math.max(0, Math.round(height) - HEAD));
    });
  }

  /** Brings `pip` over the other floating blocks: the one in use, or the one just expanded. */
  private raise(pip: Pip): void {
    // Fanned, the cards keep their order; the one picked comes forward when the fan folds.
    if (this.fanned) return;
    if (pip.node.style.zIndex === String(this.top)) return;
    pip.node.style.zIndex = String(++this.top);
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

  // ---- resizing ----

  /**
   * Resizes by a grip on the edges toward the frame's middle; the corner it rests in stays put.
   * Live while held, kept when let go.
   */
  private resize(pip: Pip, grip: HTMLElement): void {
    const axes = grip.dataset.axes as "x" | "y" | "xy";
    let grab: { from: Point; size: Size; id: number } | undefined;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || this.fanned || pip.state !== "focused") return;
      e.preventDefault();
      e.stopPropagation();
      const shown = this.rectOf(pip);
      grab = { from: { x: e.clientX, y: e.clientY }, size: { width: shown.width, height: shown.height }, id: e.pointerId };
      grip.setPointerCapture?.(e.pointerId);
      pip.node.classList.add("resizing");
    };
    const sizeAt = (e: PointerEvent, g: NonNullable<typeof grab>) => resized(g.size, pip.rest.corner, e.clientX - g.from.x, e.clientY - g.from.y, this.frame, axes);
    const move = (e: PointerEvent) => {
      if (!grab || e.pointerId !== grab.id) return;
      this.draw({ pip, size: sizeAt(e, grab) });
    };
    const up = (e: PointerEvent) => {
      if (!grab || e.pointerId !== grab.id) return;
      const g = grab;
      grab = undefined;
      grip.releasePointerCapture?.(e.pointerId);
      pip.node.classList.remove("resizing");
      this.resizeTo(pip.block.kind, sizeAt(e, g));
    };
    grip.addEventListener("pointerdown", down);
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
    pip.offs.push(() => {
      grip.removeEventListener("pointerdown", down);
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
    });
  }

  // ---- dragging ----

  /** Drags by the header; let go, the block settles in a corner or a stash, flung on at its speed. */
  private drag(pip: Pip, head: HTMLElement): void {
    let grab: { from: Point; at: Rect; samples: (Point & { t: number })[]; id: number } | undefined;
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || this.fanned || (e.target as HTMLElement).closest("button") || pip.state === "zoomed") return;
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
      // Let go outside the window: torn off into one of its own there, its header under the pointer.
      const view = this.doc.defaultView;
      if (view && this.host.tearOff && !pip.block.throwaway && outside({ x: e.clientX, y: e.clientY }, { width: view.innerWidth, height: view.innerHeight })) {
        const frameAt = this.root.getBoundingClientRect();
        const grabX = g.from.x - frameAt.left - g.at.x;
        const grabY = g.from.y - frameAt.top - g.at.y;
        return this.tearOff(pip.block.kind, { x: Math.round(e.screenX - grabX), y: Math.round(e.screenY - grabY), width: Math.round(g.at.width), height: Math.round(g.at.height) });
      }
      // At the size it was drawn at while dragged (it may be sharing the frame), and judged by
      // where the pointer let it go.
      const frameAt = this.root.getBoundingClientRect();
      const pointer = { x: e.clientX - frameAt.left, y: e.clientY - frameAt.top };
      const rest = settle({ x: g.at.x + dx, y: g.at.y + dy, width: g.at.width, height: g.at.height }, velocityOf(g.samples), this.frame, pointer);
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
