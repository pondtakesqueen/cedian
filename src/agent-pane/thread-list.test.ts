// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import type { Notice, Request, ThreadInfo } from "../protocol/wire.js";
import { dayOf, groupOf, ThreadList, threadSections } from "./thread-list.js";

const info = (over: Partial<ThreadInfo>): ThreadInfo => ({ id: "t-1", title: "Fix sum", task: "fix", archived: false, messages: [], pending: [], sessions: [], state: "done", status: "done", updated_at: "2026-11-04T10:00:00Z", ...over }) as ThreadInfo;

describe("the Threads list", () => {
  test("by what each needs: the person first, then work going on, then what is finished", () => {
    expect(groupOf(info({ status: "asking" }))).toBe("needs");
    expect(groupOf(info({ status: "done", needs_you: true }))).toBe("needs");
    expect(groupOf(info({ status: "failed" }))).toBe("needs");
    expect(groupOf(info({ status: "working" }))).toBe("working");
    expect(groupOf(info({ status: "queued" }))).toBe("working");
    expect(groupOf(info({ status: "stopped" }))).toBe("done");
    const sections = threadSections([
      info({ id: "a", status: "done", updated_at: "1" }),
      info({ id: "b", status: "working", todo: [{ text: "x", state: "done" }, { text: "y", state: "doing" }] as ThreadInfo["todo"] }),
      info({ id: "c", status: "asking" }),
      info({ id: "d", status: "done", updated_at: "2" }),
    ]);
    expect(sections.map((s) => [s.label, s.rows.map((r) => r.id)])).toEqual([["Needs you", ["c"]], ["Working", ["b"]], ["Earlier", ["d", "a"]]]);
    expect(sections[0].rows[0].note).toBe("asking");
    expect(sections[1].rows[0].note).toBe("1/2");
  });
  test("puts finished threads under the day they ended, and a thread's PR and worktree under its title", () => {
    const now = new Date(2026, 10, 15, 10, 0).getTime();
    const at = (d: number, h: number) => new Date(2026, 10, d, h, 0).toISOString();
    expect(dayOf(at(15, 1), now)).toBe("today");
    expect(dayOf(at(14, 23), now)).toBe("yesterday");
    expect(dayOf(at(13, 23), now)).toBe("earlier");
    expect(dayOf(undefined, now)).toBe("earlier");
    const sections = threadSections(
      [
        info({ id: "a", updated_at: at(15, 9), cwd: "/r/.claude/worktrees/fix-export", pr: { number: 128 } as ThreadInfo["pr"] }),
        info({ id: "b", updated_at: at(14, 9), cwd: "/r" }),
        info({ id: "c", updated_at: at(2, 9) }),
      ],
      "",
      now,
      "/r",
    );
    expect(sections.map((s) => [s.label, s.rows.map((r) => r.id)])).toEqual([["Today", ["a"]], ["Yesterday", ["b"]], ["Earlier", ["c"]]]);
    expect(sections[0].rows[0].meta).toBe("#128 · fix-export");
    expect(sections[1].rows[0].meta).toBeUndefined();
  });
  test("leaves out the project chat, archived threads and sub-threads; search keeps what matches", () => {
    const threads = [info({ id: "chat", profile: "coordinator" }), info({ id: "old", archived: true }), info({ id: "sub", parent: "a" }), info({ id: "a", title: "Roots in Settings" }), info({ id: "b", title: "", task: "Browser allowlist" })];
    expect(threadSections(threads).flatMap((s) => s.rows.map((r) => r.id))).toEqual(["a", "b"]);
    expect(threadSections(threads, "ALLOW").flatMap((s) => s.rows.map((r) => r.title))).toEqual(["Browser allowlist"]);
  });
  test("draws the sections, marks the thread the agent shows, and opens what is clicked", () => {
    const sent: Request[] = [];
    let listener: (n: Notice) => void = () => {};
    const opened: string[] = [];
    let current: string | undefined = "b";
    const calls: string[] = [];
    const list = new ThreadList(document, { request: (r) => sent.push(r), onAny: (l) => ((listener = l), () => {}) }, { cwd: "/r", open: (t) => opened.push(t), newThread: () => calls.push("new"), projectChat: () => calls.push("chat"), current: () => current });
    document.body.replaceChildren(list.root);
    expect(sent).toEqual([{ op: "threads", cwd: "/r" }]);
    expect(list.root.textContent).toContain("No threads yet");
    listener({ kind: "threads", cwd: "/r", threads: [info({ id: "a", status: "asking", title: "Ask" }), info({ id: "b", status: "working", title: "Work" })] });
    expect([...list.root.querySelectorAll(".group-head .label")].map((n) => n.textContent)).toEqual(["Needs you", "Working"]);
    expect(list.root.querySelector(".thread-row.on")?.textContent).toContain("Work");
    list.root.querySelector<HTMLButtonElement>(".g-needs .thread-row")!.click();
    expect(opened).toEqual(["a"]);
    current = "a";
    list.refresh();
    expect(list.root.querySelector(".thread-row.on")?.textContent).toContain("Ask");
    list.root.querySelector<HTMLButtonElement>(".new")!.click();
    list.root.querySelector<HTMLButtonElement>(".chat")!.click();
    expect(calls).toEqual(["new", "chat"]);
    const search = list.root.querySelector<HTMLInputElement>(".search")!;
    search.value = "wor";
    search.dispatchEvent(new Event("input"));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(opened).toEqual(["a", "b"]);
    search.value = "zzz";
    search.dispatchEvent(new Event("input"));
    expect(list.root.textContent).toContain("No thread matches");
  });
});
