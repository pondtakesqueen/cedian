#!/usr/bin/env node
// Phase D's exit gate (spec §11): the agent fixes a bug shown in a screen recording, driven
// through the built app.
// 1. A scratch repo holds a small page with a bug: after "Add item" its counter shows one less
//    than the list holds. Nothing in the repo or the prompt says what is wrong.
// 2. Playwright's Chromium records the page while it is used (an MP4 filmed from its screenshots, as a screen recording).
// 3. The recording is pasted into the agent pane's composer (as a pasted video with no file of
//    its own), with "the recording shows a bug; fix it", and sent.
// 4. Once the thread is done, the page is used again in Chromium: after two adds the counter
//    must read 2. The thread must also have been shown the video's frames.
// Also times a streamed answer onto a 10k-block thread in the live pane (scroll.mjs).
// Runs a real model through the person's cedia (its default unless --model), a few cents.
// Prints what it saw and a JSON summary (also to --out); exits 1 on any failure.
// Usage: node test/smoke/gate-d.mjs <Cedian.app> [--model <ref>] [--shots <dir>] [--out file.json]
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./app.mjs";
import { measureScroll } from "./scroll.mjs";

const args = process.argv.slice(2);
const app = args[0];
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!app) {
  console.error("usage: node test/smoke/gate-d.mjs <Cedian.app> [--model <ref>] [--shots <dir>] [--out file.json]");
  process.exit(2);
}
const shots = opt("--shots");
if (shots) mkdirSync(shots, { recursive: true });
const shot = async (window, name) => shots && (await window.screenshot({ path: join(shots, `${name}.png`) }));
const log = (line) => console.log(`gate: ${line}`);

// 1. The page and its bug.
const base = realpathSync(mkdtempSync(join(tmpdir(), "cedian-gate-d-")));
const repo = join(base, "shop");
mkdirSync(repo);
writeFileSync(
  join(repo, "index.html"),
  `<!doctype html>
<meta charset="utf-8">
<title>Basket</title>
<style>body{font:20px system-ui;margin:40px}button{font:inherit;padding:8px 16px}#count{font-weight:700}</style>
<h1>Basket</h1>
<p>Items: <span id="count">0</span></p>
<button id="add">Add item</button>
<ul id="list"></ul>
<script src="basket.js"></script>
`,
);
writeFileSync(
  join(repo, "basket.js"),
  `const items = [];
const count = document.getElementById("count");
const list = document.getElementById("list");

function render(shown) {
  count.textContent = String(shown);
  list.replaceChildren(...items.map((name) => Object.assign(document.createElement("li"), { textContent: name })));
}

document.getElementById("add").addEventListener("click", () => {
  const shown = items.length;
  items.push("Item " + (items.length + 1));
  render(shown);
});
`,
);
writeFileSync(join(repo, "README.md"), "# Basket\n\nOpen index.html in a browser.\n");
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
git("init", "-q", "-b", "main");
git("add", ".");
git("-c", "user.name=gate", "-c", "user.email=gate@cedian.invalid", "commit", "-q", "-m", "init");

const { chromium } = await import("playwright-core").catch(() => import("playwright"));
const browserOpts = process.env.CEDIAN_CHROMIUM ? { executablePath: process.env.CEDIAN_CHROMIUM } : {};

/**
 * The counter after `adds` clicks on the page in `dir`. With `video`, the screen is filmed at 10
 * frames a second into that MP4 (with ffmpeg, which cedia needs for a video too).
 */
async function useThePage(dir, adds, video) {
  const browser = await chromium.launch(browserOpts);
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 500 } });
    const page = await context.newPage();
    const frames = video && mkdtempSync(join(tmpdir(), "cedian-gate-d-frames-"));
    let n = 0;
    const film = async (seconds) => {
      for (let i = 0; i < seconds * 10; i++) {
        if (frames) await page.screenshot({ path: join(frames, `f${String(n++).padStart(4, "0")}.png`) });
        else await page.waitForTimeout(100);
      }
    };
    await page.goto(`file://${join(dir, "index.html")}`);
    await film(1);
    for (let i = 0; i < adds; i++) {
      await page.click("#add");
      await film(1.5);
    }
    if (frames) execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", "10", "-i", join(frames, "f%04d.png"), "-pix_fmt", "yuv420p", video]);
    const shown = await page.textContent("#count");
    const listed = await page.locator("#list li").count();
    await context.close();
    return { shown: Number(shown), listed };
  } finally {
    await browser.close();
  }
}

/** One request to the daemon, answered by the first notice `want` accepts (as gate-c asks). */
function ask(request, want) {
  const state = process.env.CEDIAN_STATE_DIR ?? (process.platform === "darwin" ? join(homedir(), "Library/Application Support/cedian") : join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "cedian"));
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

const summary = { app, at: new Date().toISOString(), repo };
let failed = false;
const fail = (why) => ((failed = true), log(`FAIL ${why}`));

// 2. The recording.
const recording = join(base, "basket-bug.mp4");
const before = await useThePage(repo, 3, recording);
summary.before = before;
log(`recorded ${recording}: after 3 adds the page shows ${before.shown} with ${before.listed} listed`);
if (before.shown === before.listed) fail("the page has no bug to show");

const first = await launch(app, {}, { folder: repo });
try {
  const { window } = first;
  const pane = window.locator(".cedian-agent-pane.live");
  await pane.waitFor({ state: "visible", timeout: 60_000 });
  await pane.locator(".conn").waitFor({ state: "hidden", timeout: 60_000 });
  await pane.getByRole("button", { name: "+ Image/video" }).waitFor({ timeout: 30_000 });
  const model = opt("--model");
  if (model) await pane.locator('select[data-chip="model"]').selectOption(model);

  // 3. Paste the recording, as a video copied with no file of its own.
  const bytes = readFileSync(recording).toString("base64");
  await window.evaluate((b64) => {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([raw], "basket-bug.mp4", { type: "video/mp4" }));
    const textarea = document.querySelector(".cedian-agent-pane.live .composer textarea");
    textarea.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, bytes);
  await pane.locator(".attachments .tag").waitFor({ timeout: 15_000 });
  // A pasted video is saved under a name of the window's own, which its frames are named after.
  const attached = (await pane.locator(".attachments .tag .ell").textContent()) ?? "";
  log(`attached: ${attached}`);
  await pane.locator(".composer textarea").fill("The attached screen recording shows a bug in this page. Find it and fix it.");
  await shot(window, "1-composer");
  await pane.locator(".composer textarea").press("Enter");
  log("sent the recording");

  // The thread, from the daemon's list: started, then settled.
  let thread;
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const listed = await ask({ op: "threads", cwd: repo }, (n) => n.kind === "threads" && n.cwd === repo);
    thread = listed.threads[0];
    if (thread && /done|failed|interrupted|asking/.test(thread.status)) break;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  await shot(window, "2-done");
  summary.thread = thread && { id: thread.id, status: thread.status, cwd: thread.cwd ?? repo };
  log(`thread ${thread?.id}: ${thread?.status}`);
  if (thread?.status !== "done") fail("the thread did not finish");
  // A thread in a worktree changed its own checkout.
  const work = thread?.cwd ?? repo;
  summary.pane = (await pane.locator(".log").textContent())?.slice(-2000);

  // What the writer was shown: the session's user event carries the frames.
  const sessions = join(process.env.CEDIA_HOME ?? join(process.env.HOME, ".cedia"), "sessions");
  const shown = [];
  for (const project of readdirSync(sessions)) {
    for (const file of readdirSync(join(sessions, project))) {
      for (const line of readFileSync(join(sessions, project, file), "utf8").split("\n")) {
        if (!attached || !line.includes(`${attached} @`)) continue;
        const event = JSON.parse(line);
        if (event.kind === "user") shown.push({ file, frames: event.images?.length ?? 0, names: (event.images ?? []).map((i) => i.name) });
      }
    }
  }
  summary.shown = shown;
  log(`the writer was shown ${shown[0]?.frames ?? 0} frames: ${shown[0]?.names.join(", ") ?? "none"}`);
  if (!shown.length || shown[0].frames < 2) fail("the writer was not shown the recording's frames");
  const session = shown[0] && readFileSync(join(sessions, readdirSync(sessions).find((p) => readdirSync(join(sessions, p)).includes(shown[0].file)), shown[0].file), "utf8");
  summary.model = session ? (session.split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.kind === "session")?.model ?? null) : null;
  log(`on ${summary.model}`);

  // 4. Use the page again: the counter must match the list.
  const diff = execFileSync("git", ["-C", work, "diff", "main"], { encoding: "utf8" });
  summary.diff = diff;
  log(`the change:\n${diff}`);
  const after = await useThePage(work, 2);
  summary.after = after;
  log(`after 2 adds the page shows ${after.shown} with ${after.listed} listed`);
  if (after.shown !== 2 || after.listed !== 2) fail("the bug is still there");
  else log("the agent fixed the bug the recording showed");

  // A streamed answer drawn in the live pane, on a thread 10k blocks long.
  summary.scroll = await measureScroll(window, ".cedian-agent-pane.live .log");
  log(`scroll and stream: ${JSON.stringify(summary.scroll)}`);
  if (!summary.scroll.ok) fail("scroll: slower than 60 fps");
} catch (error) {
  fail(error.stack ?? String(error));
} finally {
  await first.electronApp.close();
}
const json = JSON.stringify(summary, null, 2) + "\n";
process.stdout.write(json);
const out = opt("--out");
if (out) writeFileSync(out, json);
console.log(failed ? "gate failed" : "gate ok");
process.exit(failed ? 1 : 0);
