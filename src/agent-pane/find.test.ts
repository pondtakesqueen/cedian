// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { findIn, FindBar, step } from "./find.js";

const dom = (html: string) => {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
};

describe("findIn", () => {
  it("finds every match in the text, any case, in reading order, and never inside the bar itself", () => {
    const root = dom(`<p>Fix the Parser</p><div class="find">parser</div><p>the parser tests: <b>PARSER</b> ok</p>`);
    const hits = findIn(root, "parser");
    expect(hits.map((h) => [h.node.textContent, h.start, h.end])).toEqual([
      ["Fix the Parser", 8, 14],
      ["the parser tests: ", 4, 10],
      ["PARSER", 0, 6],
    ]);
  });

  it("finds nothing for an empty query, and several matches in one text", () => {
    const root = dom(`<p>aXa a</p>`);
    expect(findIn(root, "")).toEqual([]);
    expect(findIn(root, "  ")).toEqual([]);
    expect(findIn(root, "a").map((h) => h.start)).toEqual([0, 2, 4]);
  });

  it("steps around the ends", () => {
    expect(step(0, 3, 1)).toBe(1);
    expect(step(2, 3, 1)).toBe(0);
    expect(step(0, 3, -1)).toBe(2);
    expect(step(0, 0, 1)).toBe(0);
  });
});

describe("FindBar", () => {
  it("opens over the log, counts as you type, Enter and Shift+Enter move, Escape closes", () => {
    const pane = dom(`<div class="log"><p>one two</p><p>two three two</p></div>`);
    const log = pane.querySelector<HTMLElement>(".log")!;
    const closed: number[] = [];
    const bar = new FindBar(document, pane, log, () => closed.push(1));
    expect(pane.querySelector(".find")).toBeNull();
    bar.open();
    const input = pane.querySelector<HTMLInputElement>(".find input")!;
    const count = () => pane.querySelector(".find .count")!.textContent;
    expect(document.activeElement).toBe(input);
    expect(count()).toBe("");
    input.value = "two";
    input.dispatchEvent(new Event("input"));
    expect(count()).toBe("1/3");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(count()).toBe("2/3");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }));
    expect(count()).toBe("3/3");
    // The thread grew while the bar was open: the count follows, the place is kept.
    log.append(Object.assign(document.createElement("p"), { textContent: "and two more" }));
    bar.refresh();
    expect(count()).toBe("3/4");
    input.value = "nothing here";
    input.dispatchEvent(new Event("input"));
    expect(count()).toBe("No results");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(pane.querySelector(".find")).toBeNull();
    expect(closed).toEqual([1]);
    expect(bar.isOpen).toBe(false);
  });
});
