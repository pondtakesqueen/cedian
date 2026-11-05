// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { holdScroll } from "./stretch.js";

function tree() {
  const window = document.createElement("div");
  const grid = document.createElement("div");
  const block = document.createElement("div");
  const input = document.createElement("textarea");
  window.append(grid);
  grid.append(block);
  block.append(input);
  document.body.append(window);
  return { window, grid, block, input };
}

const scrolled = (el: HTMLElement, top: number) => {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
};

describe("holdScroll", () => {
  it("puts back a scroll of the boxes around a block drawn outside its own (a focus landing in it)", () => {
    const { window, grid, block } = tree();
    const run = new EventTarget() as Animation;
    holdScroll(block, window, run);
    scrolled(grid, 253);
    expect(grid.scrollTop).toBe(0);
  });

  it("leaves the block's own scrolling, and everything once it is drawn in place", () => {
    const { window, grid, block, input } = tree();
    const run = new EventTarget() as Animation;
    holdScroll(block, window, run);
    scrolled(input, 40);
    expect(input.scrollTop).toBe(40);
    run.dispatchEvent(new Event("finish"));
    scrolled(grid, 30);
    expect(grid.scrollTop).toBe(30);
  });
});
