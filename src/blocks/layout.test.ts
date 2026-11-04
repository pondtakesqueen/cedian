import { describe, expect, test } from "vitest";
import { floatingIn, sameFloating, withFloating } from "./layout.js";

const browser = { kind: "browser", corner: "br" as const, width: 440, height: 300 };

describe("floating blocks in desktop.layout (spec §5.5)", () => {
  test("per project slug, written and read back", () => {
    const layout = withFloating({}, "/r/main", [browser]);
    expect(layout).toEqual({ "r-main": { pip: [browser] } });
    expect(floatingIn({ layout }, "/r/main")).toEqual([browser]);
    expect(floatingIn({ layout }, "/r/else")).toEqual([]);
  });
  test("keeps other projects and other keys of the project", () => {
    const desktop = { layout: { "r-main": { tree: 1, pip: [browser] }, "r-else": { pip: [browser] } } };
    expect(withFloating(desktop, "/r/main", [])).toEqual({ "r-main": { tree: 1 }, "r-else": { pip: [browser] } });
    expect(withFloating({ layout: { "r-main": { pip: [browser] } } }, "/r/main", [])).toEqual({});
  });
  test("leaves out what is malformed, and a second block of one kind", () => {
    const layout = { "r-main": { pip: [{ kind: "browser", corner: "middle", width: 1, height: 1 }, { kind: "x", corner: "tl", width: -4, height: 9 }, "no", { ...browser, stash: "up" }, { ...browser, corner: "tl" }] } };
    expect(floatingIn({ layout }, "/r/main")).toEqual([browser]);
    expect(floatingIn({ layout: "no" }, "/r/main")).toEqual([]);
    expect(floatingIn({ layout: { "r-main": { pip: { kind: "browser" } } } }, "/r/main")).toEqual([]);
  });
  test("a stash is kept", () => {
    const stashed = { ...browser, stash: "right" as const };
    expect(floatingIn({ layout: withFloating({}, "/r/main", [stashed]) }, "/r/main")).toEqual([stashed]);
  });
  test("which one a block shows is kept", () => {
    const agent = { kind: "agent", id: "t-42", corner: "tl" as const, width: 380, height: 520 };
    expect(floatingIn({ layout: withFloating({}, "/r/main", [browser, agent]) }, "/r/main")).toEqual([browser, agent]);
    expect(sameFloating([agent], [{ ...agent, id: "t-43" }])).toBe(false);
  });
  test("same", () => {
    expect(sameFloating([browser], [{ ...browser }])).toBe(true);
    expect(sameFloating([browser], [{ ...browser, corner: "tl" }])).toBe(false);
    expect(sameFloating([], [browser])).toBe(false);
  });
});
