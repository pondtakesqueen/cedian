#!/usr/bin/env node
// Phase B's exit gate (spec §11), driven through the built app:
// 1. delegate a task into a new worktree from the agent pane and wait for it to finish;
// 2. quit, reopen, and find the thread intact (its prompt and answer drawn again);
// 3. review its changes and accept them;
// 4. kill the daemon: the window starts another, and the thread rebuilds from cedia's files.
// Runs a real model through the person's cedia (its default model unless --model), so it costs
// a few cents; the account behind that model needs credit. Prints what it saw; exits 1 on any failure.
// Usage: node test/smoke/gate-b.mjs <Cedian.app> [--model <ref>] [--shots <dir>]
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  console.error("usage: node test/smoke/gate-b.mjs <Cedian.app> [--model <ref>] [--shots <dir>]");
  process.exit(2);
}
const shots = opt("--shots");
if (shots) mkdirSync(shots, { recursive: true });
const shot = async (window, name) => shots && (await window.screenshot({ path: join(shots, `${name}.png`) }));
const log = (line) => console.log(`gate: ${line}`);

// A repository of its own, so the worktree and the review touch nothing real.
const repo = join(mkdtempSync(join(tmpdir(), "cedian-gate-")), "repo");
mkdirSync(repo);
writeFileSync(join(repo, "README.md"), "# gate\n");
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
git("init", "-q", "-b", "main");
git("add", ".");
git("-c", "user.name=gate", "-c", "user.email=gate@cedian.invalid", "commit", "-q", "-m", "init");

const PROMPT = "Append the line `hello from the gate` to README.md. Change nothing else.";

async function connected(pane) {
  await pane.waitFor({ state: "visible", timeout: 60_000 });
  await pane.locator(".conn").waitFor({ state: "hidden", timeout: 60_000 });
}

// 1. Delegate into a worktree.
let first = await launch(app, {}, { folder: repo });
const user = first.user;
let threadId;
try {
  const { window } = first;
  const pane = window.locator(".cedian-agent-pane.live");
  await connected(pane);
  const perm = pane.locator('select[data-chip="permission"]');
  await perm.waitFor({ state: "attached", timeout: 30_000 });
  await perm.selectOption("workspace");
  const model = opt("--model");
  if (model) await pane.locator('select[data-chip="model"]').selectOption(model);
  await pane.locator(".chip.check input").check();
  await pane.locator(".composer textarea").fill(PROMPT);
  await pane.locator(".composer textarea").press("Enter");
  // The header (and its select) is drawn again on each notice, so ask the page, not one element.
  await window.waitForFunction(() => document.querySelector(".cedian-agent-pane.live select.threads")?.value, null, { timeout: 120_000 });
  threadId = await pane.locator("select.threads").inputValue();
  log(`started thread ${threadId} in a worktree`);
  await pane.locator(".dot.st-done, .dot.st-failed").waitFor({ timeout: 5 * 60_000 });
  const status = await pane.locator(".dot").getAttribute("class");
  if (!status.includes("st-done")) throw new Error(`the run ended ${status}`);
  await shot(window, "1-done");
  log("the run is done");
} finally {
  await first.electronApp.close();
}

// 2. Reopen: the thread is intact.
let second = await launch(app, {}, { folder: repo, user });
try {
  const { window } = second;
  const pane = window.locator(".cedian-agent-pane.live");
  await connected(pane);
  await pane.locator(`select.threads option[value="${threadId}"]`).waitFor({ state: "attached", timeout: 30_000 });
  await pane.locator("select.threads").selectOption(threadId);
  await pane.locator(".ubub", { hasText: "hello from the gate" }).waitFor({ timeout: 30_000 });
  await pane.locator(".ans").first().waitFor({ timeout: 30_000 });
  if ((await pane.locator(".ubub").count()) !== 1) throw new Error("the prompt is drawn more than once");
  await shot(window, "2-reopened");
  log("reopened: the thread's prompt and answer are drawn again");

  // 3. Review and accept.
  const review = pane.locator(".card.review");
  await review.waitFor({ timeout: 30_000 });
  log(`review: ${(await review.locator(".row").first().textContent()).trim()}`);
  await review.getByRole("button", { name: "Open diff" }).click();
  await window.locator(".monaco-diff-editor, .multiDiffEditor").first().waitFor({ timeout: 30_000 });
  await shot(window, "3-review");
  const all = review.getByRole("button", { name: "Accept all" });
  if (await all.count()) await all.click();
  await pane.locator(".card.review", { hasText: "Accepted" }).waitFor({ timeout: 30_000 });
  log("accepted every hunk");

  // 4. Kill the daemon: the window starts another and the thread rebuilds.
  const lock = JSON.parse(readFileSync(join(process.env.CEDIA_HOME ?? join(homedir(), ".cedia"), "desktop.lock"), "utf8"));
  process.kill(lock.pid, "SIGKILL");
  log(`killed the daemon (pid ${lock.pid})`);
  await pane.locator(".conn").waitFor({ state: "visible", timeout: 15_000 });
  await pane.locator(".conn").waitFor({ state: "hidden", timeout: 60_000 });
  const again = JSON.parse(readFileSync(join(process.env.CEDIA_HOME ?? join(homedir(), ".cedia"), "desktop.lock"), "utf8"));
  if (again.pid === lock.pid) throw new Error("no new daemon holds the lock");
  await pane.locator(".ubub", { hasText: "hello from the gate" }).waitFor({ timeout: 30_000 });
  await pane.locator(".card.review", { hasText: "Accepted" }).waitFor({ timeout: 30_000 });
  await shot(window, "4-rebuilt");
  log(`a new daemon (pid ${again.pid}) rebuilt the thread and its review from cedia's files`);
} finally {
  await second.electronApp.close();
}
console.log("gate ok");
