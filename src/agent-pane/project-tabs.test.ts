import { describe, expect, it } from "vitest";
import type { ThreadInfo } from "../protocol/wire.js";
import { counts, isScratch, nextAfterClose, projectName, projectsOf, projectTabs, withoutProject, withProject } from "./project-tabs.js";

const thread = (id: string, status: ThreadInfo["status"], extra: Partial<ThreadInfo> = {}): ThreadInfo =>
  ({ id, status, archived: false, messages: [], pending: [], title: id, task: "", updated_at: "2026-11-04T00:00:00Z", ...extra }) as unknown as ThreadInfo;

describe("project tabs", () => {
  it("names a project by its folder", () => {
    expect(projectName("/Users/p/code/cedian")).toBe("cedian");
    expect(projectName("C:\\work\\api\\")).toBe("api");
  });

  it("counts what needs the person and what is at work, as the Threads list groups them", () => {
    const threads = [thread("a", "asking"), thread("b", "working"), thread("c", "queued"), thread("d", "done"), thread("e", "done", { needs_you: true }), thread("f", "working", { parent: "b" }), thread("g", "failed", { archived: true })];
    expect(counts(threads)).toEqual({ needs: 2, working: 2 });
  });

  it("shows the person's projects in their order, this window's first while it is not listed", () => {
    const tabs = projectTabs("/a", ["/b", "/a", "/c"], new Map([["/c", [thread("x", "asking")]]]));
    expect(tabs.map((t) => t.root)).toEqual(["/b", "/a", "/c"]);
    expect(tabs.find((t) => t.on)?.root).toBe("/a");
    expect(tabs[2]).toMatchObject({ name: "c", needs: 1, working: 0, on: false });
    expect(projectTabs("/z", ["/b"], new Map()).map((t) => t.root)).toEqual(["/z", "/b"]);
  });

  it("starts from this window's project alone: no recently opened folders", () => {
    expect(projectTabs("/Users/p/cedian", projectsOf({}), new Map()).map((t) => t.name)).toEqual(["cedian"]);
  });

  it("reads desktop.projects leniently", () => {
    expect(projectsOf({ projects: ["/a/", "/b", "/a", 3, "", "/c"] as unknown as string[] })).toEqual(["/a", "/b", "/c"]);
    expect(projectsOf({ projects: "nope" as unknown as string[] })).toEqual([]);
  });

  it("adds a project once, never a temporary folder, and takes one off", () => {
    expect(withProject(["/a"], "/b/")).toEqual(["/a", "/b"]);
    expect(withProject(["/a", "/b"], "/b")).toBeUndefined();
    expect(withProject(["/a"], "/var/folders/r7/x/T/cedian-smoke-a/folder")).toBeUndefined();
    expect(withoutProject(["/a", "/b", "/c"], "/b")).toEqual(["/a", "/c"]);
  });

  it("moves to the next tab, else the one before, when this window's tab closes", () => {
    const tabs = projectTabs("/b", ["/a", "/b", "/c"], new Map());
    expect(nextAfterClose(tabs, "/b")).toBe("/c");
    expect(nextAfterClose(tabs, "/c")).toBe("/b");
    expect(nextAfterClose(projectTabs("/a", [], new Map()), "/a")).toBeUndefined();
  });

  it("leaves temporary folders out, but not the window's own", () => {
    const smoke = "/var/folders/r7/x/T/cedian-smoke-a/folder";
    expect(projectTabs(smoke, [], new Map()).map((t) => t.root)).toEqual([smoke]);
    expect(isScratch("/private/tmp/b")).toBe(true);
    expect(isScratch("C:\\Users\\p\\AppData\\Local\\Temp\\x")).toBe(true);
    expect(isScratch("/Users/p/tmp/x")).toBe(false);
  });
});

describe("project tabs in the title bar", () => {
  // VS Code's .titlebar-drag-region is an absolutely placed layer over the whole title bar; a row
  // without a z-index of its own sits under it, so a click on a tab drags the window instead.
  it("sit above VS Code's drag region, as its menubar does", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../../vscode/contrib/cedian/browser/media/workbench.css", import.meta.url), "utf8");
    const rule = css.match(/\.part\.titlebar \.cedian-project-tabs \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/position:\s*relative/);
    expect(rule).toMatch(/z-index:\s*2500/);
    expect(rule).toMatch(/-webkit-app-region:\s*no-drag/);
  });
});
