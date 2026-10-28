// @vitest-environment happy-dom
// The live pane against a fake daemon: what it asks for, and what it draws from the answers.
import { describe, expect, it } from "vitest";
import type { Notice, Request, Review, ThreadInfo } from "../protocol/wire";
import { AgentPane, threadList, type PaneHost } from "./pane";

function setup(over: Partial<PaneHost> = {}) {
  const sent: Request[] = [];
  let listener: (n: Notice) => void = () => {};
  const opened: string[] = [];
  const host: PaneHost = {
    cwd: "/r",
    files: async () => ["src/main.ts", "README.md"],
    pickImages: async () => ["/tmp/shot.png"],
    openReview: (thread, _cwd, _review, file) => opened.push(`${thread}:${file ?? "*"}`),
    openUrl: () => {},
    ...over,
  };
  const pane = new AgentPane(document, { request: (r) => sent.push(r), onAny: (l) => ((listener = l), () => {}) }, host);
  document.body.replaceChildren(pane.root);
  return { pane, sent, emit: (n: Notice) => listener(n), opened, last: () => sent.at(-1) };
}

const info = (over: Partial<ThreadInfo>): ThreadInfo => ({ id: "t-1", title: "Fix sum", task: "fix", archived: false, messages: [], pending: [], sessions: [], state: "done", status: "done", updated_at: "2026-10-28T10:00:00Z", ...over }) as ThreadInfo;
const type = (pane: AgentPane, text: string) => {
  pane.composer.value = text;
  pane.composer.setSelectionRange(text.length, text.length);
  pane.composer.dispatchEvent(new Event("input"));
};
const enter = (pane: AgentPane) => pane.composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
const tick = () => new Promise((r) => setTimeout(r, 0));
const buttons = (root: HTMLElement, text: string) => [...root.querySelectorAll("button")].filter((b) => b.textContent === text);

describe("agent pane", () => {
  it("watches the project's threads and starts a new one in a worktree", () => {
    const { pane, sent, emit, last } = setup();
    expect(sent).toEqual([{ op: "threads", cwd: "/r" }, { op: "commands", cwd: "/r" }]);
    emit({ kind: "choices", models: { default: "anthropic/claude-opus-5-5", models: [{ ref: "anthropic/claude-opus-5-5", label: "Opus", provider: "anthropic", available: true, contextWindow: 200000, effort: true, effortLevels: ["low", "high"] }], modes: [] }, permissions: { default: "workspace", modes: [{ mode: "read-only", label: "อ่าน", description: "" }, { mode: "workspace", label: "แก้ได้", description: "" }, { mode: "auto", label: "auto", description: "" }, { mode: "plan", label: "plan", description: "" }] } });
    const perm = pane.root.querySelector<HTMLSelectElement>('select[data-chip="permission"]')!;
    expect([...perm.options].map((o) => o.value)).toEqual(["read-only", "workspace", "auto", "plan"]);
    perm.value = "auto";
    perm.dispatchEvent(new Event("change"));
    const worktree = pane.root.querySelector<HTMLInputElement>(".chip.check input")!;
    worktree.checked = true;
    worktree.dispatchEvent(new Event("change"));
    type(pane, "add a test");
    enter(pane);
    expect(last()).toEqual({ op: "prompt", cwd: "/r", text: "add a test", thread: null, worktree: true, permission: "auto" });
    expect(pane.composer.value).toBe("");
    emit({ kind: "preparing", cwd: "/r", step: "กำลังสร้าง worktree" });
    expect(pane.root.textContent).toContain("กำลังสร้าง worktree");
    emit({ kind: "started", cwd: "/r", thread: "t-9" });
    expect(pane.thread).toBe("t-9");
    expect(last()).toEqual({ op: "threads", cwd: "/r" });
  });

  it("draws a thread, queues while it runs, and reviews when it ends", () => {
    const { pane, emit, last, opened } = setup();
    emit({ kind: "threads", cwd: "/r", threads: [info({ cwd: "/r/.cedian/worktrees/a", status: "working", state: "working" }), info({ id: "t-0", archived: true })] });
    expect(pane.root.querySelectorAll("select.threads option")).toHaveLength(2);
    pane.openThread("t-1");
    expect(last()).toEqual({ op: "review", cwd: "/r/.cedian/worktrees/a", thread: "t-1" });
    emit({ kind: "blocks", thread: "t-1", from: 0, blocks: [{ kind: "user", text: "fix", images: [] }, { kind: "text", text: "on it", streaming: true }], run_cost: 0.12 });
    emit({ kind: "caught", thread: "t-1" });
    expect(pane.root.querySelector(".ans")?.textContent).toBe("on it");
    expect(pane.root.textContent).toContain("$0.12");
    type(pane, "also docs");
    enter(pane);
    expect(last()).toEqual({ op: "send", cwd: "/r/.cedian/worktrees/a", thread: "t-1", text: "also docs" });
    emit({ kind: "threads", cwd: "/r", threads: [info({ cwd: "/r/.cedian/worktrees/a", status: "working", state: "working", pending: ["m-1"], messages: [{ id: "m-1", from: "user", text: "also docs", at: "" }] })] });
    expect(pane.root.querySelector(".queued")?.textContent).toContain("also docs");
    buttons(pane.root, "ส่งเลย")[0]!.click();
    expect(last()).toEqual({ op: "stop", thread: "t-1" });
    // The send button stops an empty composer's running thread.
    expect(pane.root.querySelector(".send")?.textContent).toBe("หยุด");
    emit({ kind: "status", thread: "t-1", status: "stopped" });
    expect(last()).toEqual({ op: "prompt", cwd: "/r/.cedian/worktrees/a", text: "also docs", thread: "t-1", worktree: false });
    const review: Review = { files: [{ path: "src/a.ts", added: 2, removed: 1, binary: false, hunks: [{ id: "h1", header: "@@ -1 +1,2 @@", lines: ["-a", "+b", "+c"], new_start: 1, path: "src/a.ts", state: "pending" }] }] };
    emit({ kind: "review", thread: "t-1", review });
    expect(pane.root.querySelector(".review")?.textContent).toContain("1 ไฟล์");
    buttons(pane.root, "รับทั้งหมด")[0]!.click();
    expect(last()).toEqual({ op: "decide", cwd: "/r/.cedian/worktrees/a", thread: "t-1", hunk: "h1", decision: { decision: "accept" } });
    buttons(pane.root, "src/a.ts")[0]!.click();
    expect(opened).toEqual(["t-1:src/a.ts"]);
  });

  it("commits and opens a PR from the receipt", () => {
    const { pane, emit, last } = setup();
    emit({ kind: "threads", cwd: "/r", threads: [info({})] });
    pane.openThread("t-1");
    emit({ kind: "review", thread: "t-1", review: { files: [{ path: "a", added: 1, removed: 0, binary: false, hunks: [] }] } });
    buttons(pane.root, "Commit")[0]!.click();
    expect(last()).toEqual({ op: "commit_draft", cwd: "/r", thread: "t-1" });
    emit({ kind: "commit_draft", thread: "t-1", draft: { message: "Fix sum", files: ["a"] } });
    expect(pane.root.querySelector<HTMLTextAreaElement>(".msg")!.value).toBe("Fix sum");
    buttons(pane.root, "Commit")[0]!.click();
    expect(last()).toEqual({ op: "commit", cwd: "/r", thread: "t-1", message: "Fix sum", files: ["a"] });
    emit({ kind: "committed", thread: "t-1", result: { commit: "abcdef123", subject: "Fix sum", files: ["a"] } });
    expect(pane.root.textContent).toContain("abcdef1 Fix sum");
    buttons(pane.root, "เปิด PR")[0]!.click();
    emit({ kind: "pr_plan", thread: "t-1", plan: { branch: "fix", base: "main" } });
    buttons(pane.root, "เปิดเลย")[0]!.click();
    expect(last()).toEqual({ op: "pr", cwd: "/r", thread: "t-1" });
  });

  it("answers a question, shows the todo list, and cycles the view", () => {
    const { pane, emit, last } = setup();
    emit({ kind: "threads", cwd: "/r", threads: [info({ status: "asking", state: "asking", question: { question: "ลบไฟล์เก่าด้วยไหม", options: ["ลบ", "เก็บไว้"] }, todo: [{ state: "done", text: "อ่าน" }, { state: "doing", text: "แก้" }] })] });
    pane.openThread("t-1");
    expect(pane.root.querySelector(".ask .q")?.textContent).toBe("ลบไฟล์เก่าด้วยไหม");
    expect(pane.root.querySelector(".todo")?.textContent).toContain("ขั้นตอน 1/2");
    buttons(pane.root, "เก็บไว้")[0]!.click();
    expect(last()).toEqual({ op: "prompt", cwd: "/r", text: "เก็บไว้", thread: "t-1", worktree: false });
    emit({ kind: "blocks", thread: "t-1", from: 0, blocks: [{ kind: "thinking", text: "hmm", streaming: false, ms: 1000 }, { kind: "text", text: "ok", streaming: false }], run_cost: 0 });
    expect(pane.root.querySelector(".think")).toBeNull();
    pane.cycleViewMode();
    expect(pane.root.querySelector(".think")).not.toBeNull();
    emit({ kind: "settings", desktop: { view_mode: "answers" }, path: "" });
    expect(pane.root.querySelector(".think")).not.toBeNull();
  });

  it("completes @ files and / commands, and attaches images", async () => {
    const { pane, emit, last } = setup();
    emit({ kind: "commands", cwd: "/r", commands: [{ name: "review", description: "Review the diff", kind: "skill", source: "user" }] });
    type(pane, "/rev");
    expect(pane.root.querySelector(".popup .opt")?.textContent).toContain("/review");
    pane.composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(pane.composer.value).toBe("/review ");
    type(pane, "look at @mai");
    await tick();
    expect(pane.root.querySelector(".popup .opt")?.textContent).toBe("src/main.ts");
    enter(pane);
    expect(pane.composer.value).toBe("look at @src/main.ts ");
    buttons(pane.root, "+ รูป")[0]!.click();
    await tick();
    expect(pane.root.querySelector(".attachments")?.textContent).toContain("shot.png");
    enter(pane);
    expect(last()).toEqual({ op: "prompt", cwd: "/r", text: "look at @src/main.ts", thread: null, worktree: false, images: ["/tmp/shot.png"] });
  });

  it("lists threads newest first without archived ones", () => {
    expect(threadList([info({ id: "a", updated_at: "1" }), info({ id: "b", updated_at: "2" }), info({ id: "c", archived: true })]).map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("agent pane, from the Mac gate", () => {
  it("leaves cedia's triage session out and the loading line goes once the run streams", () => {
    const { pane, emit } = setup();
    type(pane, "hi");
    enter(pane);
    emit({ kind: "started", cwd: "/r", thread: "t-2" });
    emit({ kind: "blocks", thread: "t-2", from: 0, blocks: [
      { kind: "session", model: "anthropic/h", role: "triage" },
      { kind: "user", text: "<message>hi</message>", images: [] },
      { kind: "text", text: "DIRECT", streaming: false },
      { kind: "session", model: "openrouter/h", role: "code" },
      { kind: "user", text: "hi", images: [] },
      { kind: "text", text: "hello", streaming: false },
    ], run_cost: 0 });
    expect([...pane.root.querySelectorAll(".ubub")].map((b) => b.textContent)).toEqual(["hi"]);
    expect(pane.root.textContent).not.toContain("DIRECT");
    expect(pane.root.textContent).not.toContain("triage");
    expect(pane.root.textContent).not.toContain("กำลังโหลดเธรด");
  });

  it("shows the thread's own model and keeps it unless the person picks another", () => {
    const { pane, emit, last } = setup();
    emit({ kind: "choices", models: { default: "anthropic/h", models: [{ ref: "anthropic/h", label: "H", provider: "anthropic", available: true, contextWindow: 200000, effort: false }], modes: [] } });
    emit({ kind: "settings", desktop: { model: "anthropic/h" }, path: "" });
    emit({ kind: "threads", cwd: "/r", threads: [info({})] });
    pane.openThread("t-1");
    emit({ kind: "blocks", thread: "t-1", from: 0, blocks: [{ kind: "session", model: "openrouter/h", role: "code" }], run_cost: 0 });
    expect(pane.root.querySelector<HTMLSelectElement>('select[data-chip="model"]')!.value).toBe("openrouter/h");
    type(pane, "more");
    enter(pane);
    expect(last()).toEqual({ op: "prompt", cwd: "/r", text: "more", thread: "t-1", worktree: false });
  });
});
