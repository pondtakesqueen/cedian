import { describe, expect, it } from "vitest";
import type { ThreadInfo } from "../protocol/wire.js";
import { counts, isScratch, MAX_TABS, projectName, projectTabs } from "./project-tabs.js";

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

  it("puts this window's project first, then the recent ones, each once and no more than the bar holds", () => {
    const recent = ["/b", "/a", "/c", "/b", "/d", "/e", "/f"];
    const tabs = projectTabs("/a", recent, new Map([["/c", [thread("x", "asking")]]]));
    expect(tabs.map((t) => t.root)).toEqual(["/a", "/b", "/c", "/d", "/e"]);
    expect(tabs).toHaveLength(MAX_TABS);
    expect(tabs[0]?.on).toBe(true);
    expect(tabs[2]).toMatchObject({ name: "c", needs: 1, working: 0, on: false });
  });
  it("leaves temporary folders out of the recent ones, but not the window's own", () => {
    const smoke = "/var/folders/r7/x/T/cedian-smoke-a/folder";
    expect(projectTabs("/Users/p/cedian", [smoke, "/private/tmp/b", "/Users/p/site"], new Map()).map((t) => t.name)).toEqual(["cedian", "site"]);
    expect(projectTabs(smoke, [], new Map()).map((t) => t.root)).toEqual([smoke]);
    expect(isScratch("C:\\Users\\p\\AppData\\Local\\Temp\\x")).toBe(true);
    expect(isScratch("/Users/p/tmp/x")).toBe(false);
  });
});
