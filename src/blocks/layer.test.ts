// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import type { Block } from "./block.js";
import { BlockLayer, HEAD, outside } from "./layer.js";
import type { Floating } from "./layout.js";
import { GAP, STASH_TAB, type Rect } from "./pip.js";

class FakeBlock implements Block {
  readonly root = document.createElement("div");
  id: string | undefined;
  sizes: [number, number][] = [];
  disposed = false;
  focused = 0;
  left: string[] = [];
  private name = "Basket";
  private readonly listeners = new Set<(t: string) => void>();
  constructor(readonly kind = "browser") {}
  title() { return this.name; }
  rename(name: string) { this.name = name; for (const l of this.listeners) l(name); }
  onTitle(l: (t: string) => void) { this.listeners.add(l); return () => this.listeners.delete(l); }
  layout(w: number, h: number) { this.sizes.push([w, h]); }
  focus() { this.focused++; }
  leaving() { this.left.push(this.disposed ? "after dispose" : "before dispose"); }
  dispose() { this.disposed = true; }
}

function setup() {
  const docked: string[] = [];
  const closed: string[] = [];
  const changes: Floating[][] = [];
  const layer = new BlockLayer(document, { dock: (k) => docked.push(k), changed: (f) => changes.push(f), closed: (k) => closed.push(k) });
  document.body.append(layer.root);
  layer.layout(1200, 800);
  return { layer, docked, closed, changes };
}

const pipOf = (layer: BlockLayer, kind = "browser") => layer.root.querySelector<HTMLElement>(`.cedian-pip[data-kind="${kind}"]`)!;
const translate = (node: HTMLElement) => node.style.transform;
const pointer = (target: HTMLElement, type: string, x: number, y: number) =>
  target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true }));

describe("the block layer (spec §3.3, §4.4)", () => {
  test("a floated block rests bottom right at the default size and is laid out below its header", () => {
    const { layer, changes } = setup();
    const block = new FakeBlock();
    layer.float(block);
    const node = pipOf(layer);
    expect(node.contains(block.root)).toBe(true);
    expect(translate(node)).toBe(`translate(${1200 - GAP - 440}px, ${800 - GAP - 300}px)`);
    expect(block.sizes.at(-1)).toEqual([440, 300 - HEAD]);
    expect(node.getAttribute("aria-label")).toBe("Basket, floating");
    expect(layer.stateOf("browser")).toBe("focused");
    expect(changes.at(-1)).toEqual([{ kind: "browser", corner: "br", width: 440, height: 300 }]);
  });
  test("the header says the block's title as it changes", () => {
    const { layer } = setup();
    const block = new FakeBlock();
    layer.float(block);
    block.rename("localhost");
    expect(pipOf(layer).querySelector(".pip-title")!.textContent).toBe("localhost");
  });
  test("restored from desktop.layout quietly, where it was", () => {
    const { layer, changes } = setup();
    layer.float(new FakeBlock(), { corner: "tl", stash: "left", width: 500, height: 320 }, true);
    expect(changes).toEqual([]);
    expect(translate(pipOf(layer))).toBe(`translate(${STASH_TAB - 500}px, ${GAP}px)`);
    expect(layer.stateOf("browser")).toBe("parked");
  });
  test("stash, then the tab brings it back focused", () => {
    const { layer, changes } = setup();
    const block = new FakeBlock();
    layer.float(block);
    (pipOf(layer).querySelector(".pip-stash") as HTMLButtonElement).click();
    expect(layer.stateOf("browser")).toBe("parked");
    expect(changes.at(-1)![0]).toMatchObject({ corner: "br", stash: "right" });
    const tab = pipOf(layer).querySelector<HTMLButtonElement>(".pip-tab")!;
    expect(tab.hidden).toBe(false);
    expect(tab.getAttribute("aria-label")).toBe("Bring back Basket");
    tab.click();
    expect(layer.stateOf("browser")).toBe("focused");
    expect(changes.at(-1)![0].stash).toBeUndefined();
    expect(block.focused).toBe(1);
    expect(tab.hidden).toBe(true);
  });
  test("expand fills the frame and shrinks back to its corner", () => {
    const { layer } = setup();
    const block = new FakeBlock();
    layer.float(block);
    const expand = pipOf(layer).querySelector<HTMLButtonElement>(".pip-expand")!;
    expand.click();
    expect(layer.stateOf("browser")).toBe("zoomed");
    expect(block.sizes.at(-1)).toEqual([1200 - 2 * GAP, 800 - 2 * GAP - HEAD]);
    expect(expand.getAttribute("aria-pressed")).toBe("true");
    expand.click();
    expect(layer.stateOf("browser")).toBe("focused");
    expect(block.sizes.at(-1)).toEqual([440, 300 - HEAD]);
  });
  test("dock closes it here and hands it back to the editor area; close only closes", () => {
    const { layer, docked, closed, changes } = setup();
    const a = new FakeBlock();
    layer.float(a);
    pipOf(layer).querySelector<HTMLButtonElement>(".pip-dock")!.click();
    expect(docked).toEqual(["browser"]);
    expect(a.disposed).toBe(true);
    expect(layer.root.querySelectorAll(".cedian-pip").length).toBe(0);
    expect(changes.at(-1)).toEqual([]);
    layer.float(new FakeBlock());
    pipOf(layer).querySelector<HTMLButtonElement>(".pip-close")!.click();
    expect(closed).toEqual(["browser"]);
    expect(docked).toEqual(["browser"]);
  });
  test("a block closed or docked is told it is leaving before it goes", () => {
    const { layer } = setup();
    for (const how of ["close", "dock"] as const) {
      const block = new FakeBlock();
      layer.float(block);
      layer[how]("browser");
      expect(block.left).toEqual(["before dispose"]);
    }
  });
  test("a throwaway block (a side chat) has no dock, docks nowhere, and is not kept", () => {
    const { layer, docked, changes } = setup();
    layer.float(new FakeBlock());
    const side = Object.assign(new FakeBlock("side"), { throwaway: true });
    layer.float(side);
    expect(pipOf(layer, "side").querySelector(".pip-dock")).toBeNull();
    expect(pipOf(layer, "side").querySelector(".pip-close")).not.toBeNull();
    layer.dock("side");
    expect(docked).toEqual([]);
    expect(side.disposed).toBe(false);
    expect(layer.floating().map((f) => f.kind)).toEqual(["browser"]);
    expect(changes.at(-1)?.map((f) => f.kind)).toEqual(["browser"]);
    layer.close("side");
    expect(side.disposed).toBe(true);
  });
  test("fanned, every block is a card across the middle, stashed ones too; nothing is kept", () => {
    const { layer, changes } = setup();
    const a = new FakeBlock();
    const b = new FakeBlock("agent");
    layer.float(a);
    layer.float(b, { corner: "tl", width: 400, height: 560 });
    layer.stash("agent");
    const kept = changes.length;
    layer.fan();
    expect(layer.isFanned).toBe(true);
    expect(layer.root.classList.contains("fanned")).toBe(true);
    expect(layer.root.querySelector<HTMLElement>(".pip-scrim")!.hidden).toBe(false);
    for (const kind of ["browser", "agent"]) {
      expect(pipOf(layer, kind).classList.contains("stashed")).toBe(false);
      expect(translate(pipOf(layer, kind))).toMatch(/rotate\(.*scale\(/);
    }
    // Drawn at their own sizes inside the card.
    expect(b.sizes.at(-1)).toEqual([400, 560 - HEAD]);
    // The later card in front, and arrows do nothing while fanned.
    expect(Number(pipOf(layer, "agent").style.zIndex)).toBeGreaterThan(Number(pipOf(layer, "browser").style.zIndex));
    pipOf(layer, "browser").querySelector<HTMLElement>(".pip-head")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(changes.length).toBe(kept);
    layer.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(layer.isFanned).toBe(false);
    expect(layer.stateOf("agent")).toBe("parked");
    expect(pipOf(layer, "agent").classList.contains("stashed")).toBe(true);
    expect(changes.length).toBe(kept);
  });
  test("a card picked from the fan comes back out of its stash, in front and focused", () => {
    const { layer, changes } = setup();
    const a = new FakeBlock();
    const b = new FakeBlock("agent");
    layer.float(a);
    layer.float(b, { corner: "tl" });
    layer.stash("agent");
    layer.fan();
    const focused = b.focused;
    pointer(pipOf(layer, "agent").querySelector<HTMLElement>(".pip-body")!, "pointerdown", 10, 10);
    expect(layer.isFanned).toBe(false);
    expect(layer.stateOf("agent")).toBe("focused");
    expect(changes.at(-1)!.find((f) => f.kind === "agent")!.stash).toBeUndefined();
    expect(b.focused).toBe(focused + 1);
    expect(Number(pipOf(layer, "agent").style.zIndex)).toBeGreaterThan(Number(pipOf(layer, "browser").style.zIndex));
    // Enter on a card's header picks it too; a click beside the cards folds them.
    layer.fan();
    pipOf(layer).querySelector<HTMLElement>(".pip-head")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(layer.isFanned).toBe(false);
    layer.toggleFan();
    pointer(layer.root.querySelector<HTMLElement>(".pip-scrim")!, "pointerdown", 1, 1);
    expect(layer.isFanned).toBe(false);
  });
  test("nothing floating, nothing fans; the last block closed folds the fan", () => {
    const { layer } = setup();
    layer.fan();
    expect(layer.isFanned).toBe(false);
    layer.float(new FakeBlock());
    layer.fan();
    layer.close("browser");
    expect(layer.isFanned).toBe(false);
  });
  test("torn off by ↗, a block closes here and opens in a window of its own where it was", () => {
    const torn: [string, string | undefined, Rect][] = [];
    const changes: Floating[][] = [];
    const layer = new BlockLayer(document, { dock: () => {}, changed: (f) => changes.push(f), tearOff: (k, id, at) => torn.push([k, id, at]) });
    document.body.append(layer.root);
    layer.layout(1200, 800);
    const a = Object.assign(new FakeBlock("agent"), { id: "t-1" });
    layer.float(a, { corner: "tl", width: 400, height: 560 });
    layer.float(Object.assign(new FakeBlock("side"), { throwaway: true }));
    expect(pipOf(layer, "side").querySelector(".pip-tear")).toBeNull();
    pipOf(layer, "agent").querySelector<HTMLButtonElement>(".pip-tear")!.click();
    expect(torn).toEqual([["agent", "t-1", expect.objectContaining({ width: 400, height: 560 })]]);
    expect(a.disposed).toBe(true);
    expect(changes.at(-1)).toEqual([]);
    layer.tearOff("side");
    expect(layer.has("side")).toBe(true);
  });
  test("without a host that tears off, no block offers it", () => {
    const { layer } = setup();
    layer.float(new FakeBlock());
    expect(pipOf(layer).querySelector(".pip-tear")).toBeNull();
  });
  test("a point outside the window is any side past its edge", () => {
    const view = { width: 1200, height: 800 };
    expect(outside({ x: 10, y: 10 }, view)).toBe(false);
    for (const p of [{ x: -1, y: 10 }, { x: 10, y: -1 }, { x: 1200, y: 10 }, { x: 10, y: 800 }]) expect(outside(p, view)).toBe(true);
  });
  test("one block per kind; two kinds in one corner stack", () => {
    const { layer } = setup();
    const first = new FakeBlock();
    layer.float(first);
    layer.float(new FakeBlock());
    expect(first.disposed).toBe(true);
    expect(layer.root.querySelectorAll(".cedian-pip").length).toBe(1);
    layer.float(new FakeBlock("agent"));
    expect(translate(pipOf(layer, "agent"))).toBe(`translate(${1200 - GAP - 440}px, ${800 - 2 * GAP - 600}px)`);
    expect(layer.floating().map((f) => f.kind)).toEqual(["browser", "agent"]);
  });
  test("dragged by the header and let go still, it rests in the nearest corner", () => {
    const { layer, changes } = setup();
    layer.float(new FakeBlock());
    const head = pipOf(layer).querySelector<HTMLElement>(".pip-head")!;
    pointer(head, "pointerdown", 1000, 500);
    pointer(head, "pointermove", 600, 300);
    pointer(head, "pointermove", 200, 100);
    expect(translate(pipOf(layer))).toBe(`translate(${748 - 800}px, ${488 - 400}px)`);
    // Wait out the fling window: a pause before letting go is a drop.
    const later = performance.now() + 200;
    const realNow = performance.now.bind(performance);
    performance.now = () => later;
    pointer(head, "pointerup", 200, 100);
    performance.now = realNow;
    expect(changes.at(-1)![0]).toMatchObject({ corner: "tl" });
    expect(translate(pipOf(layer))).toBe(`translate(${GAP}px, ${GAP}px)`);
  });
  test("let go outside the window, it is torn off there, the side chat is not", () => {
    const torn: string[] = [];
    const layer = new BlockLayer(document, { dock: () => {}, changed: () => {}, tearOff: (k) => torn.push(k) });
    document.body.append(layer.root);
    layer.layout(1200, 800);
    layer.float(new FakeBlock());
    const head = pipOf(layer).querySelector<HTMLElement>(".pip-head")!;
    pointer(head, "pointerdown", 1000, 500);
    pointer(head, "pointermove", 600, 300);
    pointer(head, "pointerup", -30, 300);
    expect(torn).toEqual(["browser"]);
    expect(layer.has("browser")).toBe(false);
    layer.float(Object.assign(new FakeBlock("side"), { throwaway: true }));
    const side = pipOf(layer, "side").querySelector<HTMLElement>(".pip-head")!;
    pointer(side, "pointerdown", 1000, 500);
    pointer(side, "pointermove", 600, 300);
    pointer(side, "pointerup", -30, 300);
    expect(torn).toEqual(["browser"]);
    expect(layer.has("side")).toBe(true);
  });
  test("flung at a side, it stashes there", () => {
    const { layer, changes } = setup();
    layer.float(new FakeBlock(), { corner: "bl" });
    const head = pipOf(layer).querySelector<HTMLElement>(".pip-head")!;
    let t = 1000;
    const realNow = performance.now.bind(performance);
    performance.now = () => t;
    pointer(head, "pointerdown", 200, 600);
    t += 16;
    pointer(head, "pointermove", 400, 600);
    t += 16;
    pointer(head, "pointermove", 700, 600);
    t += 16;
    pointer(head, "pointerup", 1000, 600);
    performance.now = realNow;
    expect(changes.at(-1)![0]).toMatchObject({ corner: "br", stash: "right" });
    expect(layer.stateOf("browser")).toBe("parked");
  });
  test("a click on the header is not a move", () => {
    const { layer, changes } = setup();
    layer.float(new FakeBlock());
    const n = changes.length;
    const head = pipOf(layer).querySelector<HTMLElement>(".pip-head")!;
    pointer(head, "pointerdown", 1000, 500);
    pointer(head, "pointerup", 1001, 501);
    expect(changes.length).toBe(n);
  });
  test("arrow keys on the header move it a corner at a time", () => {
    const { layer, changes } = setup();
    layer.float(new FakeBlock());
    const head = pipOf(layer).querySelector<HTMLElement>(".pip-head")!;
    head.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(changes.at(-1)![0].corner).toBe("tr");
    head.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(changes.at(-1)![0].corner).toBe("tl");
  });
  test("a smaller frame keeps it inside", () => {
    const { layer } = setup();
    const block = new FakeBlock();
    layer.float(block, { corner: "br", width: 900, height: 700 });
    layer.layout(600, 400);
    expect(block.sizes.at(-1)).toEqual([600 - 2 * GAP, 400 - 2 * GAP - HEAD]);
    expect(translate(pipOf(layer))).toBe(`translate(${GAP}px, ${GAP}px)`);
  });
  test("resized by the free edge, the resting corner stays and the size is kept", () => {
    const { layer, changes } = setup();
    const block = new FakeBlock();
    layer.float(block);
    const node = pipOf(layer);
    // Bottom right: the grips are on the left and top edges.
    const grip = node.querySelector<HTMLElement>(".pip-grip.g-xy")!;
    pointer(grip, "pointerdown", 748, 488);
    pointer(grip, "pointermove", 648, 438);
    expect(block.sizes.at(-1)).toEqual([540, 350 - HEAD]);
    pointer(grip, "pointerup", 648, 438);
    expect(changes.at(-1)![0]).toMatchObject({ corner: "br", width: 540, height: 350 });
    expect(translate(node)).toBe(`translate(${1200 - GAP - 540}px, ${800 - GAP - 350}px)`);
    const x = node.querySelector<HTMLElement>(".pip-grip.g-x")!;
    pointer(x, "pointerdown", 648, 600);
    pointer(x, "pointerup", 548, 500);
    expect(changes.at(-1)![0]).toMatchObject({ width: 640, height: 350 });
  });
  test("a grip does nothing while zoomed", () => {
    const { layer, changes } = setup();
    layer.float(new FakeBlock());
    layer.expand("browser");
    const n = changes.length;
    const grip = pipOf(layer).querySelector<HTMLElement>(".pip-grip.g-xy")!;
    pointer(grip, "pointerdown", 100, 100);
    pointer(grip, "pointerup", 50, 50);
    expect(changes.length).toBe(n);
  });
  test("Shift+arrows on the header resize it", () => {
    const { layer, changes } = setup();
    layer.float(new FakeBlock());
    const head = pipOf(layer).querySelector<HTMLElement>(".pip-head")!;
    head.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    expect(changes.at(-1)![0]).toMatchObject({ corner: "br", width: 480, height: 300 });
    head.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true }));
    expect(changes.at(-1)![0]).toMatchObject({ width: 480, height: 260 });
  });
  test("a block showing one of many keeps which, and says when it shows another", () => {
    const { layer, changes } = setup();
    const block = new FakeBlock("agent");
    block.id = "t-1";
    layer.float(block);
    expect(changes.at(-1)![0]).toMatchObject({ kind: "agent", id: "t-1" });
    block.id = "t-2";
    block.rename("Fix the build");
    expect(changes.at(-1)![0]).toMatchObject({ id: "t-2" });
  });
  test("the block in use comes forward; an expanded block is over the others", () => {
    const { layer } = setup();
    layer.float(new FakeBlock());
    layer.float(new FakeBlock("agent"), { corner: "tr" });
    const z = (kind: string) => Number(pipOf(layer, kind).style.zIndex);
    expect(z("agent")).toBeGreaterThan(z("browser"));
    pipOf(layer).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(z("browser")).toBeGreaterThan(z("agent"));
    pipOf(layer, "agent").querySelector<HTMLElement>(".pip-head")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(z("agent")).toBeGreaterThan(z("browser"));
    layer.expand("browser");
    expect(z("browser")).toBeGreaterThan(z("agent"));
  });
  test("in a small frame, blocks in neighbouring corners share it instead of overlapping, keeping their own sizes", () => {
    const { layer } = setup();
    layer.layout(786, 805);
    const browser = new FakeBlock();
    const agent = new FakeBlock("agent");
    layer.float(browser, { corner: "tl", width: 600, height: 400 });
    layer.float(agent, { corner: "tr", width: 400, height: 560 });
    const [bw] = browser.sizes.at(-1)!;
    const [aw] = agent.sizes.at(-1)!;
    expect(bw + aw).toBe(786 - 3 * GAP);
    expect(layer.floating().map((f) => f.width)).toEqual([600, 400]);
  });
  test("dispose closes every block", () => {
    const { layer } = setup();
    const a = new FakeBlock();
    const b = new FakeBlock("agent");
    layer.float(a);
    layer.float(b);
    layer.dispose();
    expect(a.disposed && b.disposed).toBe(true);
    expect(layer.root.isConnected).toBe(false);
  });
});
