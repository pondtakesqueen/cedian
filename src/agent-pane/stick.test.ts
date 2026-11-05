// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { dockUnder, stickToBottom } from "./stick";

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

describe("dockUnder", () => {
  /** A pane whose log runs under a floating dock of a height the test sets. */
  function dock() {
    const root = document.createElement("div");
    const log = document.createElement("div");
    const bar = document.createElement("div");
    const box = { scrollHeight: 1000, clientHeight: 400, dock: 120 };
    Object.defineProperty(log, "scrollHeight", { get: () => box.scrollHeight });
    Object.defineProperty(log, "clientHeight", { get: () => box.clientHeight });
    Object.defineProperty(bar, "offsetHeight", { get: () => box.dock });
    let fire: () => void = () => {};
    class Observer {
      constructor(cb: () => void) {
        fire = cb;
      }
      observe() {}
      disconnect() {
        fire = () => {};
      }
    }
    const stop = dockUnder(root, log, bar, Observer as unknown as typeof ResizeObserver);
    return { root, log, box, resize: () => fire(), stop };
  }

  it("gives the log room for the dock, so its last message ends above it", () => {
    const { root, resize } = dock();
    resize();
    expect(root.style.getPropertyValue("--dock-h")).toBe("120px");
  });

  it("keeps a log at its end there as the dock grows", () => {
    const { log, box, resize } = dock();
    log.scrollTop = 600;
    log.dispatchEvent(new Event("scroll"));
    box.dock = 200;
    box.scrollHeight = 1080;
    resize();
    expect(log.scrollTop).toBe(1080);
  });

  it("leaves a log the person scrolled up where it is", () => {
    const { log, box, resize } = dock();
    log.scrollTop = 100;
    log.dispatchEvent(new Event("scroll"));
    box.dock = 200;
    resize();
    expect(log.scrollTop).toBe(100);
  });

  it("does nothing where there is no ResizeObserver", () => {
    const el = document.createElement("div");
    expect(() => dockUnder(el, el, el, undefined)()).not.toThrow();
  });
});
