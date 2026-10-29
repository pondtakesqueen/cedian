#!/usr/bin/env node
// The /code-review card and line comments in the review diff (spec §3.7), driven through the
// built app.
// 1. A scratch repo holds a small file with an obvious bug; the agent is asked to fix it and to
//    add a median that does not sort, so the thread has a change to review with a flaw in it.
// 2. `/code-review` in the composer: the `.code-review` card shows findings (or none). With
//    findings, Walk through opens the diff at one, and Dismiss turns into Restore.
// 3. In the review diff, the `+` beside a line opens a comment box; Enter adds the comment (under
//    the line and on the pane's card), Cmd+Enter adds another and sends them all as the
//    thread's next run.
// Runs a real model through the person's cedia (its default unless --model), a few cents.
// Prints what it saw and a JSON summary (also to --out); exits 1 on any failure.
// Usage: node test/smoke/code-review.mjs <Cedian.app> [--model <ref>] [--shots <dir>] [--out file.json]
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./app.mjs";

const args = process.argv.slice(2);
const app = args[0];
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!app) {
  console.error("usage: node test/smoke/code-review.mjs <Cedian.app> [--model <ref>] [--shots <dir>] [--out file.json]");
  process.exit(2);
}
const shots = opt("--shots");
if (shots) mkdirSync(shots, { recursive: true });
const shot = async (window, name) => shots && (await window.screenshot({ path: join(shots, `${name}.png`) }));
const log = (line) => console.log(`code-review: ${line}`);

// 1. The file and its bug.
const base = realpathSync(mkdtempSync(join(tmpdir(), "cedian-code-review-")));
const repo = join(base, "stats");
mkdirSync(repo);
writeFileSync(
  join(repo, "stats.js"),
  `// Small helpers over arrays of numbers.

/** The average of \`xs\`, 0 for an empty array. */
export function average(xs) {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (let i = 1; i < xs.length; i++) sum += xs[i];
  return sum / xs.length;
}

/** The largest of \`xs\`. */
export function largest(xs) {
  return Math.max(...xs);
}
`,
);
writeFileSync(join(repo, "README.md"), "# stats\n\n`average([1, 2, 3])` should be 2.\n");
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
git("init", "-q", "-b", "main");
git("add", ".");
git("-c", "user.name=smoke", "-c", "user.email=smoke@cedian.invalid", "commit", "-q", "-m", "init");

const stateDir = () => process.env.CEDIAN_STATE_DIR ?? (process.platform === "darwin" ? join(homedir(), "Library/Application Support/cedian") : join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "cedian"));
/** One request to the daemon, answered by the first notice `want` accepts (as gate-d asks). */
function ask(request, want) {
  const state = stateDir();
  return new Promise((resolve, reject) => {
    const socket = connect(join(state, "daemon.sock"));
    let buffer = "";
    const timer = setTimeout(() => (socket.destroy(), reject(new Error(`no answer to ${request.op}`))), 15_000);
    socket.on("error", reject);
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const notice = JSON.parse(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
        if (notice.kind === "error") return clearTimeout(timer), socket.destroy(), reject(new Error(notice.message));
        if (want(notice)) return clearTimeout(timer), socket.destroy(), resolve(notice);
      }
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The repo's newest thread from the daemon's list, once `settled` accepts it. */
async function threadWhen(settled, minutes = 10) {
  let thread;
  const deadline = Date.now() + minutes * 60_000;
  while (Date.now() < deadline) {
    const listed = await ask({ op: "threads", cwd: repo }, (n) => n.kind === "threads" && n.cwd === repo);
    thread = listed.threads[0];
    if (thread && settled(thread)) return thread;
    await sleep(3_000);
  }
  return thread;
}
const atRest = (t) => /done|failed|interrupted|asking/.test(t.status);

/** What cedia's session files in `cwd` hold: the user messages, the models and what the runs cost. */
function sessionsIn(cwd) {
  const sessions = join(process.env.CEDIA_HOME ?? join(homedir(), ".cedia"), "sessions");
  const out = { texts: [], models: new Set(), costUsd: 0 };
  for (const project of readdirSync(sessions)) {
    for (const file of readdirSync(join(sessions, project))) {
      const events = readFileSync(join(sessions, project, file), "utf8").split("\n").filter(Boolean).flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
      if (events.find((e) => e.kind === "session")?.cwd !== cwd) continue;
      for (const event of events) {
        if (event.kind === "session" && event.model) out.models.add(event.model);
        if (event.kind === "user" && typeof event.text === "string") out.texts.push(event.text);
        if (event.kind === "result") out.costUsd += event.result?.costUsd ?? 0;
      }
    }
  }
  return { ...out, models: [...out.models] };
}

const summary = { app, at: new Date().toISOString(), repo, steps: {} };
let failed = false;
const fail = (why) => ((failed = true), log(`FAIL ${why}`));
const step = (name, ok, detail) => {
  summary.steps[name] = { ok, ...detail };
  log(`${ok ? "ok" : "FAIL"} ${name} ${JSON.stringify(detail)}`);
  if (!ok) failed = true;
};

const first = await launch(app, {}, { folder: repo });
try {
  const { window } = first;
  const pane = window.locator(".cedian-agent-pane.live");
  const composer = pane.locator(".composer textarea");
  await pane.waitFor({ state: "visible", timeout: 60_000 });
  await pane.locator(".conn").waitFor({ state: "hidden", timeout: 60_000 });
  const model = opt("--model");
  if (model) await pane.locator('select[data-chip="model"]').selectOption(model);

  // a. The agent edits the file.
  // The median added as written is wrong (it does not sort), so the review has something to find.
  await composer.fill(
    "average() in stats.js gives the wrong answer. Fix that bug. Then add this function to the end of stats.js exactly as written, without changing it:\n\n/** The median of `xs`. */\nexport function median(xs) {\n  return xs[Math.floor(xs.length / 2)];\n}\n\nChange nothing else.",
  );
  await composer.press("Enter");
  log("sent the fix request");
  let thread = await threadWhen(atRest);
  await shot(window, "a-edited");
  const work = thread?.cwd ?? repo;
  const diff = execFileSync("git", ["-C", work, "diff"], { encoding: "utf8" });
  summary.thread = thread && { id: thread.id, status: thread.status, cwd: work };
  summary.diff = diff;
  step("a.edit", thread?.status === "done" && diff.includes("stats.js"), { thread: thread?.id, status: thread?.status, diff });
  if (thread?.status !== "done") throw new Error("the thread did not finish");
  await pane.locator(".card.review").waitFor({ timeout: 30_000 });

  // b. /code-review.
  await composer.fill("/code-review");
  await composer.press("Enter");
  // The first Enter may take the completion; the second sends.
  if ((await composer.inputValue()).trim()) await composer.press("Enter");
  const card = pane.locator(".card.code-review");
  await card.waitFor({ timeout: 15_000 });
  await shot(window, "b1-reviewing");
  await window.waitForFunction(() => {
    const c = document.querySelector(".cedian-agent-pane.live .card.code-review");
    return c && !c.textContent.includes("กำลังรีวิว");
  }, null, { timeout: 5 * 60_000 });
  await shot(window, "b2-reviewed");
  const cardText = (await card.textContent()) ?? "";
  const findings = await card.locator(".finding").count();
  const none = cardText.includes("ไม่พบปัญหา");
  // The daemon keeps the review it showed (cedian_daemon notes.rs), with what it cost.
  const kept = (() => {
    try {
      return JSON.parse(readFileSync(join(stateDir(), "notes", `${thread.id.replace(/[^A-Za-z0-9-]/g, "_")}.json`), "utf8")).review;
    } catch {
      return undefined;
    }
  })();
  summary.review = { text: cardText, findings, model: kept?.model, costUsd: kept?.costUsd, kept: kept?.findings };
  step("b.review", (findings > 0 || none) && !cardText.includes("รีวิวไม่สำเร็จ"), { findings, none, text: cardText.slice(0, 400) });
  if (findings > 0) {
    const walk = card.getByRole("button", { name: "ไล่ดูใน diff" });
    if (await walk.count()) {
      await walk.click();
      const tab = window.locator(".tab.active", { hasText: "(รีวิว)" });
      await tab.waitFor({ timeout: 15_000 });
      await window.locator(".monaco-diff-editor").first().waitFor({ timeout: 15_000 });
      const label = (await tab.textContent()) ?? "";
      // The open findings show under their lines, drawn once the diff has rendered.
      const findingNote = window.locator(".monaco-diff-editor .cedian-line-note.finding");
      await findingNote.first().waitFor({ timeout: 10_000 }).catch(() => {});
      const findingNotes = await findingNote.count();
      await shot(window, "b3-walk");
      step("b.walk", label.includes("stats.js") && findingNotes > 0, { tab: label.trim(), findingNotes });
    } else {
      summary.steps["b.walk"] = { ok: true, skipped: "no finding names a line" };
    }
    await card.getByRole("button", { name: "ข้าม" }).first().click();
    const restore = card.getByRole("button", { name: "เอากลับ" });
    await restore.first().waitFor({ timeout: 15_000 });
    await shot(window, "b4-dismissed");
    step("b.dismiss", (await restore.count()) === 1, { restore: await restore.count() });
  }

  // c. Line comments in the review diff.
  await pane.locator(".card.review .file button.link").first().click();
  const right = window.locator(".monaco-diff-editor .editor.modified").first();
  await right.waitFor({ timeout: 15_000 });
  await sleep(1_000);
  const lines = right.locator(".view-lines .view-line");
  /** Hovers the right side's `n`th rendered line and clicks the `+` that shows beside it. */
  const commentOn = async (n, text, keys, name) => {
    const box = await lines.nth(n).boundingBox();
    if (!box) throw new Error(`line ${n} is not drawn`);
    await window.mouse.move(box.x + 40, box.y + box.height / 2);
    const plus = right.locator(".margin .cedian-comment-add");
    await plus.waitFor({ timeout: 5_000 });
    await shot(window, `${name}-plus`);
    await plus.click();
    const input = window.locator(".cedian-comment-box textarea");
    await input.waitFor({ timeout: 5_000 });
    await input.fill(text);
    await shot(window, `${name}-box`);
    await input.press(keys);
  };
  await commentOn(2, "Name this function's argument something clearer than xs.", "Enter", "c1");
  const note = window.locator(".monaco-diff-editor .cedian-line-note.comment");
  await note.first().waitFor({ timeout: 10_000 });
  const comments = pane.locator(".card.comments");
  await comments.waitFor({ timeout: 10_000 });
  await shot(window, "c1-added");
  step("c.comment", true, { note: (await note.first().textContent())?.trim(), card: (await comments.textContent())?.trim() });

  await commentOn(5, "Add a comment saying why the loop starts where it does.", "Meta+Enter", "c2");
  await comments.waitFor({ state: "detached", timeout: 15_000 });
  await shot(window, "c2-sent");
  // The comments go as the thread's next run.
  await threadWhen((t) => !atRest(t), 1).catch(() => undefined);
  thread = await threadWhen(atRest);
  await shot(window, "c3-done");
  const runs = sessionsIn(work);
  summary.runs = runs;
  const sent = runs.texts.find((t) => t.startsWith("I left comments on lines of your diff"));
  summary.sent = sent;
  step("c.send", Boolean(sent) && (await comments.count()) === 0, { status: thread.status, message: sent });
  summary.after = execFileSync("git", ["-C", work, "diff"], { encoding: "utf8" });
} catch (error) {
  fail(error.stack ?? String(error));
  await shot(first.window, "z-failed").catch(() => {});
} finally {
  await first.electronApp.close();
}
const json = JSON.stringify(summary, null, 2) + "\n";
process.stdout.write(json);
const out = opt("--out");
if (out) writeFileSync(out, json);
console.log(failed ? "code-review failed" : "code-review ok");
process.exit(failed ? 1 : 0);
