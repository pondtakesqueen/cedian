// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import type { Notice } from "../protocol/wire.js";
import { AgentBlock } from "./floating.js";
import type { AgentPane } from "./pane.js";

function fake(side?: boolean) {
  const listeners = new Set<(n: Notice) => void>();
  const pane = {
    root: document.createElement("div"),
    thread: undefined as string | undefined,
    name: "New thread",
    disposed: false,
    focused: 0,
    title() { return this.name; },
    focusComposer() { this.focused++; },
    dispose() { this.disposed = true; },
  };
  let released = false;
  const block = new AgentBlock({
    pane: pane as unknown as AgentPane,
    onAny: (l) => { listeners.add(l); return () => listeners.delete(l); },
    release: () => { released = true; },
    ...(side ? { side } : {}),
  });
  const notice = () => { for (const l of listeners) l({ kind: "settings", desktop: {}, path: "" } as Notice); };
  return { pane, block, notice, listeners, released: () => released };
}

describe("the agent pane as a floating block", () => {
  test("its title and thread are the pane's, and it says when either changes", () => {
    const { pane, block, notice } = fake();
    const heard: string[] = [];
    block.onTitle((t) => heard.push(t));
    expect(block.kind).toBe("agent");
    expect(block.id).toBeUndefined();
    expect(block.title()).toBe("New thread");
    notice();
    expect(heard).toEqual([]);
    pane.thread = "t-1";
    pane.name = "Fix the build";
    notice();
    expect(heard).toEqual(["Fix the build"]);
    expect(block.id).toBe("t-1");
    pane.thread = "t-2";
    notice();
    expect(heard).toEqual(["Fix the build", "Fix the build"]);
  });
  test("a side chat is its own kind, thrown away when it closes", () => {
    expect(fake().block.throwaway).toBe(false);
    const { block } = fake(true);
    expect(block.kind).toBe("side");
    expect(block.throwaway).toBe(true);
  });
  test("laid out at the height it is given; focus goes to the composer", () => {
    const { pane, block } = fake();
    block.layout(400, 530);
    expect(pane.root.style.height).toBe("530px");
    block.focus();
    expect(pane.focused).toBe(1);
  });
  test("dispose closes the pane, lets go of its wire and stops listening", () => {
    const { pane, block, listeners, released } = fake();
    document.body.append(pane.root);
    block.dispose();
    expect(pane.disposed).toBe(true);
    expect(released()).toBe(true);
    expect(listeners.size).toBe(0);
    expect(pane.root.isConnected).toBe(false);
  });
});
