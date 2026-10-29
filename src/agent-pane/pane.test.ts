// @vitest-environment happy-dom
// The live pane against a fake daemon: what it asks for, and what it draws from the answers.
import { describe, expect, it } from "vitest";
import type { Notice, Request, Review, ThreadInfo } from "../protocol/wire";
import { AgentPane, CHAT, threadList, threadSearch, type PaneHost } from "./pane";

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
    emit({ kind: "preparing", cwd: "/r", step: "Creating worktree" });
    expect(pane.root.textContent).toContain("Creating worktree");
    emit({ kind: "started", cwd: "/r", thread: "t-9" });
    expect(pane.thread).toBe("t-9");
    expect(last()).toEqual({ op: "threads", cwd: "/r" });
  });

  it("draws a thread, queues while it runs, and reviews when it ends", () => {
    const { pane, emit, last, opened } = setup();
    emit({ kind: "threads", cwd: "/r", threads: [info({ cwd: "/r/.cedian/worktrees/a", status: "working", state: "working" }), info({ id: "t-0", archived: true })] });
    expect(pane.root.querySelectorAll("select.threads option")).toHaveLength(3);
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
    buttons(pane.root, "Send now")[0]!.click();
    expect(last()).toEqual({ op: "stop", thread: "t-1" });
    // The send button stops an empty composer's running thread.
    expect(pane.root.querySelector(".send")?.textContent).toBe("Stop");
    emit({ kind: "status", thread: "t-1", status: "stopped" });
    expect(last()).toEqual({ op: "prompt", cwd: "/r/.cedian/worktrees/a", text: "also docs", thread: "t-1", worktree: false });
    const review: Review = { files: [{ path: "src/a.ts", added: 2, removed: 1, binary: false, hunks: [{ id: "h1", header: "@@ -1 +1,2 @@", lines: ["-a", "+b", "+c"], new_start: 1, path: "src/a.ts", state: "pending" }] }] };
    emit({ kind: "review", thread: "t-1", review });
    expect(pane.root.querySelector(".review")?.textContent).toContain("1 file");
    buttons(pane.root, "Accept all")[0]!.click();
    expect(last()).toEqual({ op: "decide", cwd: "/r/.cedian/worktrees/a", thread: "t-1", hunk: "h1", decision: { decision: "accept" } });
    buttons(pane.root, "src/a.ts")[0]!.click();
    expect(opened).toEqual(["t-1:src/a.ts"]);
  });

  it("/code-review asks the daemon, then the card groups findings by file: walk, fix one, dismiss, fix all", () => {
    const opened: string[] = [];
    const { pane, emit, last } = setup({ openReview: (thread, _cwd, _review, file, line) => opened.push(`${thread}:${file}:${line}`) });
    emit({ kind: "threads", cwd: "/r", threads: [info({})] });
    pane.openThread("t-1");
    const review: Review = { files: [{ path: "src/a.ts", added: 1, removed: 0, binary: false, hunks: [] }] };
    emit({ kind: "review", thread: "t-1", review });
    type(pane, "/code-review");
    // The first Enter takes the completion, the second sends.
    enter(pane);
    enter(pane);
    expect(last()).toEqual({ op: "code_review", cwd: "/r", thread: "t-1" });
    expect(pane.composer.value).toBe("");
    emit({ kind: "notes", thread: "t-1", notes: { comments: [], reviewing: true } });
    expect(pane.root.querySelector(".code-review")?.textContent).toContain("Reviewing");
    const findings = [
      { id: "f1", path: "src/a.ts", line: 4, text: "src/a.ts:4 drops the last item" },
      { id: "f2", path: "src/b.ts", line: 2, text: "src/b.ts:2 never closes" },
      { id: "f3", text: "the tests are gone" },
    ];
    emit({ kind: "notes", thread: "t-1", notes: { comments: [], review: { model: "faux/review", verdict: "changes", summary: "Read both.", files: ["src/a.ts", "src/b.ts"], dropped: [], costUsd: 0, findings } } });
    const card = pane.root.querySelector(".code-review")!;
    expect(card.textContent).toContain("3 findings");
    expect([...card.querySelectorAll(".m.small")].map((e) => e.textContent)).toEqual(["src/a.ts", "src/b.ts", "No file"]);
    buttons(pane.root, "Walk through")[0]!.click();
    buttons(pane.root, "Next (1/2)")[0]!.click();
    expect(opened).toEqual(["t-1:src/a.ts:4", "t-1:src/b.ts:2"]);
    buttons(pane.root, "Fix this one")[1]!.click();
    expect(last()).toEqual({ op: "fix_findings", cwd: "/r", thread: "t-1", findings: ["f2"] });
    buttons(pane.root, "Dismiss")[0]!.click();
    expect(last()).toEqual({ op: "dismiss", thread: "t-1", finding: "f1", dismissed: true });
    emit({ kind: "notes", thread: "t-1", notes: { comments: [], dismissed: ["f1"], review: { model: "faux/review", verdict: "changes", summary: "", files: [], dropped: [], costUsd: 0, findings } } });
    expect(pane.root.querySelector(".code-review")?.textContent).toContain("1 skipped");
    expect(buttons(pane.root, "Restore")).toHaveLength(1);
    buttons(pane.root, "Fix all")[0]!.click();
    expect(last()).toEqual({ op: "fix_findings", cwd: "/r", thread: "t-1", findings: [] });
    emit({ kind: "notes", thread: "t-1", notes: { comments: [], review: { error: "no snapshots" } } });
    expect(pane.root.querySelector(".code-review")?.textContent).toContain("Review failed: no snapshots");
  });

  it("line comments wait in a card until Send all; one can be removed", () => {
    const { pane, emit, last } = setup();
    emit({ kind: "threads", cwd: "/r", threads: [info({})] });
    pane.openThread("t-1");
    const comments = [
      { id: "c1", path: "src/a.ts", line: 3, text: "return y" },
      { id: "c2", path: "src/b.ts", line: 9, text: "why?" },
    ];
    emit({ kind: "notes", thread: "t-1", notes: { comments } });
    expect(pane.root.querySelector(".comments")?.textContent).toContain("2 diff comments");
    buttons(pane.root, "Delete")[0]!.click();
    expect(last()).toEqual({ op: "comments", thread: "t-1", comments: [comments[1]] });
    buttons(pane.root, "Send all")[0]!.click();
    expect(last()).toEqual({ op: "send_comments", cwd: "/r", thread: "t-1" });
  });

  it("/code-review with no thread open says so and sends nothing", () => {
    const { pane, sent } = setup();
    const before = sent.length;
    type(pane, "/code-review");
    enter(pane);
    expect(sent).toHaveLength(before);
    expect(pane.root.textContent).toContain("Open a thread that changed files first");
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
    buttons(pane.root, "Open PR")[0]!.click();
    emit({ kind: "pr_plan", thread: "t-1", plan: { branch: "fix", base: "main" } });
    buttons(pane.root, "Open it")[0]!.click();
    expect(last()).toEqual({ op: "pr", cwd: "/r", thread: "t-1" });
  });

  it("answers a question, shows the todo list, and cycles the view", () => {
    const { pane, emit, last } = setup();
    emit({ kind: "threads", cwd: "/r", threads: [info({ status: "asking", state: "asking", question: { question: "ลบไฟล์เก่าด้วยไหม", options: ["ลบ", "เก็บไว้"] }, todo: [{ state: "done", text: "อ่าน" }, { state: "doing", text: "แก้" }] })] });
    pane.openThread("t-1");
    expect(pane.root.querySelector(".ask .q")?.textContent).toBe("ลบไฟล์เก่าด้วยไหม");
    expect(pane.root.querySelector(".todo")?.textContent).toContain("Steps 1/2");
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
    buttons(pane.root, "+ Image")[0]!.click();
    await tick();
    expect(pane.root.querySelector(".attachments")?.textContent).toContain("shot.png");
    enter(pane);
    expect(last()).toEqual({ op: "prompt", cwd: "/r", text: "look at @src/main.ts", thread: null, worktree: false, images: ["/tmp/shot.png"] });
  });

  it("attaches a pasted screenshot through the host and a copied file by its path", async () => {
    const saved: string[] = [];
    const { pane } = setup({ saveImage: async (bytes, mime) => (saved.push(`${mime}:${bytes.length}`), "/cache/paste-1.png") });
    const shot = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    const copied = Object.assign(new File([new Uint8Array([9])], "a.jpg", { type: "image/jpeg" }), { path: "/Users/p/a.jpg" });
    await pane.paste([shot, copied]);
    expect(saved).toEqual(["image/png:3"]);
    expect([...pane.root.querySelectorAll(".tag .ell")].map((e) => e.textContent)).toEqual(["paste-1.png", "a.jpg"]);
  });

  it("says in the pane when a pasted screenshot can't be saved, and attaches nothing", async () => {
    const { pane } = setup({ saveImage: async () => Promise.reject(new Error("disk full")) });
    await pane.paste([new File([new Uint8Array([1])], "image.png", { type: "image/png" })]);
    expect(pane.root.querySelector(".error")?.textContent).toBe("Couldn't attach the pasted file: disk full");
    expect(pane.root.querySelectorAll(".tag .ell").length).toBe(0);
  });

  it("takes a video once cedia says it can: the chip, the picker and a paste", async () => {
    const asked: (boolean | undefined)[] = [];
    const { pane, emit } = setup({ pickImages: async (video) => (asked.push(video), ["/tmp/bug.mov"]) });
    const welcome = (capabilities: string[]) => emit({ kind: "welcome", daemon: "0", cedia: { Ok: { name: "cedia", version: "1", protocol: "x", capabilities } } } as Notice);
    const paste = (file: File) => {
      const e = new Event("paste", { cancelable: true }) as Event & { clipboardData: { files: File[] } };
      e.clipboardData = { files: [file] };
      pane.composer.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const clip = Object.assign(new File([new Uint8Array([0])], "bug.mp4", { type: "video/mp4" }), { path: "/Users/p/bug.mp4" });
    welcome(["images"]);
    expect(buttons(pane.root, "+ Image")).toHaveLength(1);
    expect(paste(clip)).toBe(false);
    welcome(["images", "video"]);
    buttons(pane.root, "+ Image/video")[0]!.click();
    await tick();
    expect(asked).toEqual([true]);
    expect(paste(clip)).toBe(true);
    await tick();
    expect([...pane.root.querySelectorAll(".tag .ell")].map((e) => e.textContent)).toEqual(["bug.mov", "bug.mp4"]);
  });

  it("⌘0 starts the project chat as the coordinator, then shows a card per thread it opened", () => {
    const { pane, emit, sent, last } = setup();
    emit({ kind: "threads", cwd: "/r", threads: [] });
    pane.projectChat();
    expect(pane.root.textContent).toContain("Project chat");
    type(pane, "fix login and update the docs");
    enter(pane);
    expect(last()).toMatchObject({ op: "prompt", cwd: "/r", text: "fix login and update the docs", profile: "coordinator", worktree: false });
    emit({ kind: "started", cwd: "/r", thread: "c-1" });
    const coordinator = info({ id: "c-1", title: "Project chat", profile: "coordinator", status: "working", state: "working", updated_at: "2026-10-28T11:00:00Z" });
    const login = info({ id: "t-2", title: "Fix login", by: "c-1", status: "working", state: "working", cwd: "/r/.cedian/worktrees/login", todo: [{ state: "done", text: "find" }, { state: "doing", text: "patch the redirect" }] });
    const docs = info({ id: "t-3", title: "Update docs", by: "c-1", status: "asking", state: "asking", question: { question: "Which README?", options: ["root", "packages"] } });
    emit({ kind: "threads", cwd: "/r", threads: [coordinator, login, docs, info({ id: "t-9", title: "Unrelated" })] });
    const cards = [...pane.root.querySelectorAll<HTMLElement>(".thread-card")];
    expect(cards.map((c) => c.dataset.thread)).toEqual(["t-3", "t-2"]);
    expect(cards[1]!.textContent).toContain("1/2");
    expect(cards[1]!.textContent).toContain("patch the redirect");
    // Answering on the card replies to that thread, in its own place.
    buttons(cards[0]!, "root")[0]!.click();
    expect(last()).toEqual({ op: "prompt", cwd: "/r", text: "root", thread: "t-3", worktree: false });
    buttons(cards[1]!, "Open")[0]!.click();
    expect(sent).toContainEqual({ op: "open", cwd: "/r", thread: "t-2" });
    expect(pane.root.querySelector(".thread-card")).toBeNull();
    // ⌘0 goes back to the chat.
    pane.projectChat();
    expect(sent.at(-2)).toEqual({ op: "open", cwd: "/r", thread: "c-1" });
    expect(pane.root.querySelector<HTMLSelectElement>("select.threads")!.value).toBe("@chat");
  });

  it("@ in the chat sends straight to one of the coordinator's threads", async () => {
    const { pane, emit, last } = setup();
    emit({ kind: "threads", cwd: "/r", threads: [] });
    pane.projectChat();
    type(pane, "split the work");
    enter(pane);
    emit({ kind: "started", cwd: "/r", thread: "c-1" });
    const coordinator = info({ id: "c-1", profile: "coordinator", status: "done", updated_at: "2026-10-28T11:00:00Z" });
    const login = info({ id: "t-2", title: "Fix login", by: "c-1", status: "working", state: "working", cwd: "/r/wt/login" });
    const docs = info({ id: "t-3", title: "Update docs", by: "c-1", cwd: "/r/wt/docs", runs: [{ id: "r1", prompt: "docs", permission: "workspace" }] });
    emit({ kind: "threads", cwd: "/r", threads: [coordinator, login, docs, info({ id: "t-9", title: "Unrelated" })] });
    // `@` at the start of the message offers the coordinator's threads before files.
    type(pane, "@upd");
    await tick();
    const options = [...pane.root.querySelectorAll(".opt")].map((o) => o.textContent);
    expect(options[0]).toBe("Update docst-3");
    enter(pane);
    expect(pane.composer.value).toBe("@t-3 ");
    // A thread at rest takes it as its next run, with its own permission; a working one queues it.
    type(pane, "@t-3 use the root README");
    enter(pane);
    expect(last()).toEqual({ op: "prompt", cwd: "/r/wt/docs", text: "use the root README", thread: "t-3", worktree: false, permission: "workspace" });
    type(pane, "@t-2 cover logout too");
    enter(pane);
    expect(last()).toEqual({ op: "send", cwd: "/r/wt/login", thread: "t-2", text: "cover logout too" });
    // Any other `@` is the coordinator's.
    type(pane, "@t-9 hi");
    enter(pane);
    expect(last()).toMatchObject({ op: "prompt", cwd: "/r", text: "@t-9 hi", thread: "c-1" });
  });

  it("keeps an archived thread's card in the chat, last, as finished", () => {
    const { pane, emit } = setup();
    emit({ kind: "threads", cwd: "/r", threads: [] });
    pane.projectChat();
    type(pane, "go");
    enter(pane);
    emit({ kind: "started", cwd: "/r", thread: "c-1" });
    const coordinator = info({ id: "c-1", profile: "coordinator", updated_at: "2026-10-28T11:00:00Z" });
    emit({ kind: "threads", cwd: "/r", threads: [coordinator, info({ id: "t-2", title: "Shipped", by: "c-1", archived: true, updated_at: "2026-10-28T12:00:00Z" }), info({ id: "t-3", title: "Still going", by: "c-1", status: "working", state: "working" })] });
    const cards = [...pane.root.querySelectorAll<HTMLElement>(".thread-card")];
    expect(cards.map((c) => c.dataset.thread)).toEqual(["t-3", "t-2"]);
    expect(cards[1]!.classList.contains("archived")).toBe(true);
    expect(cards[1]!.textContent).toContain("Archived");
  });

  it("a thread's PR shows as a chip on its card and its header, and opens on a click", () => {
    const urls: string[] = [];
    const { pane, emit } = setup({ openUrl: (u) => urls.push(u) });
    emit({ kind: "threads", cwd: "/r", threads: [] });
    pane.projectChat();
    type(pane, "go");
    enter(pane);
    emit({ kind: "started", cwd: "/r", thread: "c-1" });
    const pr = { number: 7, url: "https://github.com/o/r/pull/7", state: "open", ci: "failing", conflict: false, review: null, fixing: true } as const;
    emit({ kind: "threads", cwd: "/r", threads: [info({ id: "c-1", profile: "coordinator" }), info({ id: "t-2", title: "Fix login", by: "c-1", pr })] });
    const chip = pane.root.querySelector<HTMLElement>(".thread-card .chip.pr")!;
    expect(chip.textContent).toBe("#7 · CI failing · fixing");
    expect(chip.classList.contains("pr-bad")).toBe(true);
    chip.click();
    expect(urls).toEqual(["https://github.com/o/r/pull/7"]);
    pane.openThread("t-2");
    expect(pane.root.querySelector(".chip.pr")!.textContent).toBe("#7 · CI failing · fixing");
  });

  it("× stops following an open PR, and Watch PR follows it again", () => {
    const { pane, emit, last } = setup();
    const pr = { number: 7, url: "https://github.com/o/r/pull/7", state: "open", ci: "passing", conflict: false, review: null, fixing: false } as const;
    emit({ kind: "threads", cwd: "/r", threads: [info({ id: "t-2", pr })] });
    pane.openThread("t-2");
    pane.root.querySelector<HTMLElement>(`button[title="Stop watching this thread's PR"]`)!.click();
    expect(last()).toEqual({ op: "pr_watch", cwd: "/r", thread: "t-2", watch: false });
    emit({ kind: "threads", cwd: "/r", threads: [info({ id: "t-2", pr_unwatched: true })] });
    expect(pane.root.querySelector(".chip.pr")).toBeNull();
    buttons(pane.root, "Watch PR")[0]!.click();
    expect(last()).toEqual({ op: "pr_watch", cwd: "/r", thread: "t-2", watch: true });
    // A merged PR is no longer followed: nothing to stop.
    emit({ kind: "threads", cwd: "/r", threads: [info({ id: "t-2", pr: { ...pr, state: "merged" } })] });
    expect(pane.root.querySelector(`button[title="Stop watching this thread's PR"]`)).toBeNull();
  });

  it("a new block draws one element and keeps the rest, with what the person opened", () => {
    const { pane, emit } = setup();
    emit({ kind: "threads", cwd: "/r", threads: [info({})] });
    pane.openThread("t-1");
    const tool = { kind: "tool", id: "c1", name: "read", input: { path: "a.ts" }, result: { text: "x", is_error: false } };
    emit({ kind: "blocks", thread: "t-1", from: 0, blocks: [{ kind: "user", text: "fix", images: [] }, tool, { kind: "text", text: "on", streaming: true }], run_cost: 0 } as Notice);
    const user = pane.root.querySelector(".ubub")!;
    const tools = pane.root.querySelector<HTMLDetailsElement>("details.tools")!;
    tools.open = true;
    emit({ kind: "blocks", thread: "t-1", from: 2, blocks: [{ kind: "text", text: "on it", streaming: true }], run_cost: 0 });
    expect(pane.root.querySelector(".ubub")).toBe(user);
    expect(pane.root.querySelector("details.tools")).toBe(tools);
    expect(tools.open).toBe(true);
    expect(pane.root.querySelector(".ans")!.textContent).toBe("on it");
    // Another thread draws from nothing.
    emit({ kind: "threads", cwd: "/r", threads: [info({}), info({ id: "t-2" })] });
    pane.openThread("t-2");
    emit({ kind: "blocks", thread: "t-2", from: 0, blocks: [{ kind: "user", text: "fix", images: [] }], run_cost: 0 });
    expect(pane.root.querySelector(".ubub")).not.toBe(user);
  });

  it("streamed text arrives as appends: the answer grows, the rest stays drawn, then it settles", () => {
    const { pane, emit } = setup();
    emit({ kind: "threads", cwd: "/r", threads: [info({})] });
    pane.openThread("t-1");
    emit({ kind: "blocks", thread: "t-1", from: 0, blocks: [{ kind: "user", text: "fix", images: [] }, { kind: "thinking", text: "hm", streaming: true, ms: null }, { kind: "text", text: "on", streaming: true }], run_cost: 0 } as Notice);
    const user = pane.root.querySelector(".ubub")!;
    emit({ kind: "text", thread: "t-1", index: 2, append: " it" });
    emit({ kind: "text", thread: "t-2", index: 2, append: "!" });
    expect(pane.root.querySelector(".ubub")).toBe(user);
    const answer = pane.root.querySelector(".ans")!;
    expect(answer.textContent).toBe("on it");
    // The final block replaces it, drawn whole.
    emit({ kind: "blocks", thread: "t-1", from: 1, blocks: [{ kind: "thinking", text: "hmm", streaming: false, ms: 1000 }, { kind: "text", text: "on it", streaming: false }], run_cost: 0 } as Notice);
    expect(pane.root.querySelector(".ans")).not.toBe(answer);
    expect(pane.root.querySelector(".ans")!.className).toBe("ans");
  });

  it("acks each blocks or text notice once its frame is painted", async () => {
    const { pane, emit, sent } = setup();
    emit({ kind: "threads", cwd: "/r", threads: [info({})] });
    pane.openThread("t-1");
    emit({ kind: "blocks", thread: "t-1", from: 0, blocks: [{ kind: "text", text: "on", streaming: true }], run_cost: 0 } as Notice);
    emit({ kind: "text", thread: "t-1", index: 0, append: " it" });
    emit({ kind: "caught", thread: "t-1" });
    const acks = () => sent.filter((r) => r.op === "ack");
    expect(acks()).toEqual([]);
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    await tick();
    expect(acks()).toEqual([{ op: "ack", thread: "t-1" }, { op: "ack", thread: "t-1" }]);
  });

  it("the thread search lists the chat first, then threads newest first, archived last", () => {
    const items = threadSearch([
      info({ id: "c-1", profile: "coordinator", status: "working", state: "working" }),
      info({ id: "t-old", title: "Old", archived: true, updated_at: "2026-10-28T13:00:00Z" }),
      info({ id: "t-a", title: "A", task: "fix the login form", updated_at: "2026-10-28T11:00:00Z", todo: [{ state: "done", text: "x" }, { state: "pending", text: "y" }] }),
      info({ id: "t-b", title: "B", status: "asking", state: "asking", needs_you: true, updated_at: "2026-10-28T12:00:00Z" }),
    ]);
    expect(items.map((i) => i.id)).toEqual([CHAT, "t-b", "t-a", "t-old"]);
    expect(items[0]!.description).toBe("Working");
    expect(items[1]!.description).toBe("Waiting for you · needs you");
    expect(items[2]).toEqual({ id: "t-a", label: "A", description: "Done · 1/2", detail: "fix the login form" });
    expect(items[3]!.description).toBe("Archived");
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
    expect(pane.root.textContent).not.toContain("Loading thread");
  });

  it("shows a later run that goes on with the writer's session after its triage", () => {
    const { pane, emit } = setup();
    emit({ kind: "threads", cwd: "/r", threads: [info({})] });
    pane.openThread("t-1");
    emit({ kind: "blocks", thread: "t-1", from: 0, blocks: [
      { kind: "session", model: "openrouter/h", role: "code" },
      { kind: "user", text: "read sum.js", images: [] },
      { kind: "text", text: "it subtracts", streaming: false },
      // The next run: triage first, then the writer's own session goes on with no session line.
      { kind: "session", model: "openrouter/h", role: "triage" },
      { kind: "user", text: "<message>Your pull request #1 failed CI</message>", images: [] },
      { kind: "text", text: "DIRECT", streaming: false },
      { kind: "user", text: "Your pull request #1 failed CI", images: [] },
      { kind: "text", text: "fixed sum", streaming: false },
    ], run_cost: 0 });
    expect([...pane.root.querySelectorAll(".ubub")].map((b) => b.textContent)).toEqual(["read sum.js", "Your pull request #1 failed CI"]);
    expect(pane.root.textContent).toContain("fixed sum");
    expect(pane.root.textContent).not.toContain("DIRECT");
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

  it("a reopened thread's chips show its writer's model and its last run's permission", () => {
    const { pane, emit, last } = setup();
    emit({ kind: "choices", models: { default: "anthropic/h", models: [{ ref: "anthropic/h", label: "H", provider: "anthropic", available: true, contextWindow: 200000, effort: false }], modes: [] }, permissions: { default: "read-only", modes: [{ mode: "read-only", label: "อ่าน", description: "" }, { mode: "workspace", label: "แก้ได้", description: "" }] } });
    emit({ kind: "settings", desktop: { model: "anthropic/h", permission: "read-only" }, path: "" });
    // The triage helper ran last, on a cheaper model: the chip still names the writer's.
    const sessions = [{ session_id: "s1", model: "openrouter/w", role: "code" }, { session_id: "s2", model: "anthropic/cheap", role: "triage" }];
    emit({ kind: "threads", cwd: "/r", threads: [info({ sessions, runs: [{ id: "r1", prompt: "fix", permission: "workspace" }] })] });
    pane.openThread("t-1");
    const chip = (name: string) => pane.root.querySelector<HTMLSelectElement>(`select[data-chip="${name}"]`)!.value;
    expect(chip("model")).toBe("openrouter/w");
    expect(chip("permission")).toBe("workspace");
    type(pane, "more");
    enter(pane);
    expect(last()).toEqual({ op: "prompt", cwd: "/r", text: "more", thread: "t-1", worktree: false, permission: "workspace" });
  });
});
