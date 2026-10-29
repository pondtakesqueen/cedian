// @vitest-environment happy-dom
// The agent pane replays cedia's recorded fixtures: the blocks the daemon's fold makes of each
// (recorded by `daemon/crates/cedian_agent/tests/replay.rs` at the cedia pin), applied as
// `Notice::Blocks`, grouped and drawn.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isBlock, type Block } from "./block";
import { items } from "./items";
import { renderItems } from "./render";
import { applyBlocks, applyText, emptyView } from "./view";

// node:path, not URL: happy-dom puts its own URL in the test's globals.
const dir = join(dirname(fileURLToPath(import.meta.url)), "../../daemon/crates/cedian_agent/tests/replay");
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith(".blocks.json"))
  .map((f) => f.slice(0, -".blocks.json".length))
  .sort();

function load(name: string): Record<string, Block[]> {
  return JSON.parse(readFileSync(join(dir, `${name}.blocks.json`), "utf8"));
}

/** The rendered pane as lines of text, one per drawn element that holds text. */
function outline(root: HTMLElement): string {
  const lines: string[] = [];
  for (const node of root.querySelectorAll(".col > *")) {
    const leaves = [node, ...node.querySelectorAll("*")].filter((e) => e.children.length === 0);
    const texts = leaves.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
    lines.push(`[${node.className}] ${texts.join(" | ")}`);
  }
  return lines.join("\n");
}

describe("agent pane", () => {
  it("has cedia's fixtures", () => {
    expect(fixtures).toEqual(["ask", "denied-call", "edit-and-check", "handoff", "subthread"]);
  });

  for (const name of fixtures) {
    describe(name, () => {
      const view = load(name);

      it("reads every block the daemon sends", () => {
        for (const block of Object.values(view).flat()) expect(isBlock(block), JSON.stringify(block)).toBe(true);
      });

      it("rebuilds the same view from notices sent one block at a time", () => {
        const own = view[""];
        let state = emptyView("t-00000001");
        own.forEach((block, i) => {
          state = applyBlocks(state, { kind: "blocks", thread: "t-00000001", from: i, blocks: [block], run_cost: 0 });
        });
        // A later notice replaces from its index on, as a streamed text block is replaced.
        state = applyBlocks(state, { kind: "blocks", thread: "t-00000001", from: 1, blocks: own.slice(1), run_cost: 0 });
        expect(state.blocks).toEqual(own);
        for (const [sub, blocks] of Object.entries(view).filter(([k]) => k !== "")) {
          state = applyBlocks(state, { kind: "blocks", thread: "t-00000001", sub, from: 0, blocks, run_cost: 0 });
          expect(state.subthreads.get(sub)).toEqual(blocks);
        }
        expect(state.blocks).toEqual(own);
      });

      it("draws", () => {
        const drawn = Object.entries(view)
          .map(([sub, blocks]) => `${sub || "thread"}:\n${outline(renderItems(document, items(blocks)))}`)
          .join("\n");
        expect(drawn).toMatchSnapshot();
      });
    });
  }

  it("an append grows the streaming text or thinking block it names, a sub-thread's too", () => {
    let view = applyBlocks(emptyView("t-1"), { kind: "blocks", thread: "t-1", from: 0, blocks: [{ kind: "thinking", text: "hm", streaming: true, ms: null }, { kind: "text", text: "on", streaming: true }], run_cost: 0 });
    view = applyBlocks(view, { kind: "blocks", thread: "t-1", sub: "t-2", from: 0, blocks: [{ kind: "text", text: "a", streaming: true }], run_cost: 0 });
    view = applyText(view, { kind: "text", thread: "t-1", index: 0, append: "m" });
    view = applyText(view, { kind: "text", thread: "t-1", index: 1, append: " it" });
    view = applyText(view, { kind: "text", thread: "t-1", sub: "t-2", index: 0, append: "b" });
    view = applyText(view, { kind: "text", thread: "t-9", index: 1, append: "x" });
    expect(view.blocks.map((b) => (b as { text: string }).text)).toEqual(["hmm", "on it"]);
    expect(view.subthreads.get("t-2")).toEqual([{ kind: "text", text: "ab", streaming: true }]);
  });

  it("marks a checked success verified and a denial failed", () => {
    const checked = items(load("edit-and-check")[""]);
    expect(checked.find((i) => i.k === "receipt")).toMatchObject({ verified: true, checks: [{ exitCode: 0 }] });
    const denied = items(load("denied-call")[""]).find((i) => i.k === "tools");
    expect(denied).toMatchObject({ failure: expect.stringContaining("denied by deny-list:deploy") });
  });

  it("puts text in as text", () => {
    const root = renderItems(document, [{ k: "answer", text: "<img src=x onerror=alert(1)>", streaming: false }]);
    expect(root.querySelector("img")).toBeNull();
  });
});
