import { describe, expect, it } from "vitest";
import type { ThreadInfo } from "../protocol/wire.js";
import { cacheText, coldWindows, counts, isScratch, nextAfterClose, recentFrom, tabsFromCache, projectName, projectsOf, projectTabs, touched, withoutProject, withProject } from "./project-tabs.js";

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

describe("the title bar's window title", () => {
  it("is hidden: the tabs name the project", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../../vscode/contrib/cedian/browser/media/workbench.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.titlebar-center > \.window-title \{ visibility: hidden; \}/);
  });
});

describe("the tabs a loading window draws first", () => {
  it("are the last window's tabs, with this window's marked", () => {
    const last = projectTabs("/a", ["/a", "/b"], new Map([["/b", [thread("x", "asking")]]]));
    const tabs = tabsFromCache(cacheText(last), "/b");
    expect(tabs?.map((t) => [t.root, t.on, t.needs])).toEqual([["/a", false, 0], ["/b", true, 1]]);
  });

  it("put this window's project first when the cache doesn't list it", () => {
    expect(tabsFromCache(cacheText(projectTabs("/a", [], new Map())), "/z")?.map((t) => t.root)).toEqual(["/z", "/a"]);
  });

  it("are nothing when the cache is missing or not a tab list", () => {
    expect(tabsFromCache(undefined, "/a")).toBeUndefined();
    expect(tabsFromCache("{", "/a")).toBeUndefined();
    expect(tabsFromCache("{}", "/a")).toBeUndefined();
    expect(tabsFromCache('[{"root":3},{"root":"/b","needs":-1}]', "/b")).toEqual([{ root: "/b", name: "b", on: true, needs: 0, working: 0 }]);
  });
});

describe("warm project windows", () => {
  const win = (id: number, root?: string, dirty = false) => ({ id, root, dirty });

  it("keeps the shown project first in the recent list, each once", () => {
    expect(touched(["/a", "/b", "/c"], "/c/")).toEqual(["/c", "/a", "/b"]);
    expect(touched([], "/a")).toEqual(["/a"]);
    expect(touched(Array.from({ length: 25 }, (_, i) => `/p${i}`), "/x")).toHaveLength(20);
  });

  it("reads back only a list of folders", () => {
    expect(recentFrom('["/a","/b"]')).toEqual(["/a", "/b"]);
    expect(recentFrom('["/a",3,""]')).toEqual(["/a"]);
    expect(recentFrom("{")).toEqual([]);
    expect(recentFrom(undefined)).toEqual([]);
  });

  it("closes nothing while three projects or fewer have windows", () => {
    expect(coldWindows([win(1, "/a"), win(2, "/b"), win(3, "/c")], ["/a", "/b"], "/c")).toEqual([]);
  });

  it("closes the windows of projects shown longest ago, past the three kept", () => {
    const windows = [win(1, "/a"), win(2, "/b"), win(3, "/c"), win(4, "/d")];
    // /d is shown now; /c and /a were before it; /b longest ago.
    expect(coldWindows(windows, ["/c", "/a", "/b"], "/d")).toEqual([2]);
  });

  it("closes a window the recent list never saw before one it did", () => {
    const windows = [win(1, "/a"), win(2, "/b"), win(3, "/c"), win(4, "/old")];
    expect(coldWindows(windows, ["/a", "/b"], "/c")).toEqual([4]);
  });

  it("never closes the target's window, an empty window or one with unsaved changes", () => {
    const windows = [win(1, "/a"), win(2, "/b", true), win(3, "/c"), win(4, "/d"), win(5)];
    expect(coldWindows(windows, ["/d", "/c", "/a", "/b"], "/a", 1)).toEqual([4, 3]);
  });

  it("counts a project with two windows once", () => {
    expect(coldWindows([win(1, "/a"), win(2, "/a"), win(3, "/b"), win(4, "/c")], ["/a", "/b", "/c"], "/a")).toEqual([]);
  });
});
