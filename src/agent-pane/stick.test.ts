// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { stickToBottom } from "./stick";

/** A log whose heights the test sets, and a ResizeObserver the test fires. */
function setup() {
  const log = document.createElement("div");
  const box = { scrollHeight: 1000, clientHeight: 400 };
  Object.defineProperty(log, "scrollHeight", { get: () => box.scrollHeight });
  Object.defineProperty(log, "clientHeight", { get: () => box.clientHeight });
  let fire: () => void = () => {};
  const watched: Element[] = [];
  class Observer {
    constructor(cb: () => void) {
      fire = cb;
    }
    observe(el: Element) {
      watched.push(el);
    }
    disconnect() {
      fire = () => {};
    }
  }
  const stop = stickToBottom(log, Observer as unknown as typeof ResizeObserver);
  const scrollTo = (top: number) => {
    log.scrollTop = top;
    log.dispatchEvent(new Event("scroll"));
  };
  return { log, box, resize: () => fire(), stop, scrollTo, watched };
}

describe("stickToBottom", () => {
  it("keeps a log at its bottom when a resize rewraps its text", () => {
    const { log, box, resize, scrollTo } = setup();
    scrollTo(600);
    // Narrower: the same messages wrap onto more lines.
    box.scrollHeight = 1199;
    resize();
    expect(log.scrollTop).toBe(1199);
  });

  it("leaves a log the person scrolled up where it is", () => {
    const { log, box, resize, scrollTo } = setup();
    scrollTo(100);
    box.scrollHeight = 1199;
    resize();
    expect(log.scrollTop).toBe(100);
  });

  it("counts a log within 40 px of its end as at the bottom, as a redraw does", () => {
    const { log, box, resize, scrollTo } = setup();
    scrollTo(570);
    box.scrollHeight = 1100;
    resize();
    expect(log.scrollTop).toBe(1100);
  });

  it("stops following once disposed", () => {
    const { log, box, resize, scrollTo, stop } = setup();
    scrollTo(600);
    stop();
    box.scrollHeight = 1300;
    resize();
    expect(log.scrollTop).toBe(600);
  });

  it("does nothing where there is no ResizeObserver", () => {
    const log = document.createElement("div");
    expect(() => stickToBottom(log, undefined)()).not.toThrow();
  });
});
