import { describe, expect, test } from "vitest";
import { floatingIn, withFloating } from "./layout.js";
import { projectSlug as projectSlugFor } from "../settings/desktop.js";
import { layoutName, layoutsIn, MAX_LAYOUTS, STARTERS, withCurrent, withLayout, withoutLayout } from "./layouts.js";

const browser = { kind: "browser", corner: "br" as const, width: 440, height: 300 };
const groups = { orientation: 1, groups: [{ size: 0.3 }, { size: 0.7 }] };

describe("named layouts in desktop.layout", () => {
  test("a project with none saved has the starters, and no current one", () => {
    expect(layoutsIn({}, "/r/main")).toEqual({ layouts: [...STARTERS] });
    expect(STARTERS.map((l) => l.name)).toEqual(["Focus", "Code", "Preview", "Review"]);
  });
  test("saved, a layout joins the starters, made current; the same name saves over it", () => {
    let desktop = { layout: withLayout({}, "/r/main", { name: "  Debug \n", pip: [browser], groups }) };
    let read = layoutsIn(desktop, "/r/main");
    expect(read.layouts.map((l) => l.name)).toEqual([...STARTERS.map((l) => l.name), "Debug"]);
    expect(read.current).toBe("Debug");
    expect(read.layouts.at(-1)).toEqual({ name: "Debug", pip: [browser], groups });
    desktop = { layout: withLayout(desktop, "/r/main", { name: "Focus", pip: [] }) };
    read = layoutsIn(desktop, "/r/main");
    expect(read.layouts.map((l) => l.name)).toEqual([...STARTERS.map((l) => l.name), "Debug"]);
    expect(read.layouts[0]).toEqual({ name: "Focus", pip: [] });
    expect(read.current).toBe("Focus");
  });
  test("keeps what floats now (pip) and other projects as they are", () => {
    const desktop = { layout: { ...withFloating({}, "/r/main", [browser]), "r-else": { pip: [browser] } } };
    const layout = withLayout(desktop, "/r/main", { name: "A", pip: [] });
    expect(floatingIn({ layout }, "/r/main")).toEqual([browser]);
    expect(layout["r-else"]).toEqual({ pip: [browser] });
  });
  test("deleted, a layout goes, and is current no longer", () => {
    let desktop = { layout: withLayout({}, "/r/main", { name: "A", pip: [] }) };
    desktop = { layout: withoutLayout(desktop, "/r/main", "A") };
    expect(layoutsIn(desktop, "/r/main")).toEqual({ layouts: [...STARTERS] });
    desktop = { layout: withoutLayout(desktop, "/r/main", "Focus") };
    expect(layoutsIn(desktop, "/r/main").layouts.map((l) => l.name)).toEqual(["Code", "Preview", "Review"]);
    // Every one deleted is none, not the starters back.
    for (const name of ["Code", "Preview", "Review"]) desktop = { layout: withoutLayout(desktop, "/r/main", name) };
    expect(layoutsIn(desktop, "/r/main").layouts).toEqual([]);
  });
  test("switching sets the current one; a current name with no layout is none", () => {
    const desktop = { layout: withCurrent({}, "/r/main", "Preview") };
    expect(layoutsIn(desktop, "/r/main").current).toBe("Preview");
    expect(layoutsIn({ layout: withCurrent({}, "/r/main", "gone") }, "/r/main").current).toBeUndefined();
  });
  test("leaves out what is malformed, a second of one name, and past the most", () => {
    const layout = { "r-main": { layouts: [{ name: "" }, "x", { name: "A", pip: [browser, { ...browser, corner: "tl" }, { kind: "x" }], groups: "no" }, { name: "A", pip: [] }, ...Array.from({ length: 30 }, (_, i) => ({ name: `L${i}`, pip: [] }))] } };
    const read = layoutsIn({ layout }, "/r/main").layouts;
    expect(read[0]).toEqual({ name: "A", pip: [browser] });
    expect(read).toHaveLength(MAX_LAYOUTS);
  });
  test("a name is one trimmed line of at most 40 characters", () => {
    expect(layoutName("  a\n b  ")).toBe("a b");
    expect(layoutName("x".repeat(50))).toHaveLength(40);
    expect(layoutName("   ")).toBe("");
  });

  test("a project saved with the starters' old Thai names reads them back in English, its own names kept", () => {
    const desktop = { layout: { [projectSlugFor("/r/main")]: { layouts: [{ name: "\u0e42\u0e1f\u0e01\u0e31\u0e2a", pip: [] }, { name: "\u0e23\u0e35\u0e27\u0e34\u0e27", pip: [] }, { name: "ของฉัน", pip: [] }], current: "\u0e23\u0e35\u0e27\u0e34\u0e27" } } };
    const read = layoutsIn(desktop, "/r/main");
    expect(read.layouts.map((l) => l.name)).toEqual(["Focus", "Review", "ของฉัน"]);
    expect(read.current).toBe("Review");
  });
});
