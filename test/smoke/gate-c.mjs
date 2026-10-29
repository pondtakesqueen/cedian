#!/usr/bin/env node
// Phase C's exit gate (spec §11), driven through the built app:
// 1. three threads at once across two repos from one project chat: two scratch repos made one
//    project (`desktop.roots`, put back afterwards), the coordinator asked to open three threads,
//    one in the first repo and two in the second; each must run in a worktree of its own repo,
//    finish, and change its file, and all three must be working at the same moment;
// 2. memory measured while they run: the window's process tree and the daemon's (which holds the
//    cedia runs), sampled every 2 s, peak and median;
// 3. scroll 10k blocks @60fps in the live pane (scroll.mjs).
// Runs a real model through the person's cedia (its default unless --model), so it costs a few
// cents. Prints what it saw and a JSON summary (also to --out); exits 1 on any failure.
// Usage: node test/smoke/gate-c.mjs <Cedian.app> [--model <ref>] [--shots <dir>] [--out file.json]
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { launch, treeRssMb } from "./app.mjs";
import { measureScroll } from "./scroll.mjs";

const args = process.argv.slice(2);
const app = args[0];
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!app) {
  console.error("usage: node test/smoke/gate-c.mjs <Cedian.app> [--model <ref>] [--shots <dir>] [--out file.json]");
  process.exit(2);
}
const shots = opt("--shots");
if (shots) mkdirSync(shots, { recursive: true });
const shot = async (window, name) => shots && (await window.screenshot({ path: join(shots, `${name}.png`) }));
const log = (line) => console.log(`gate: ${line}`);

// Two repositories of their own, real paths (macOS's temp dir is behind a symlink).
const base = realpathSync(mkdtempSync(join(tmpdir(), "cedian-gate-c-")));
const repo = (name) => {
  const dir = join(base, name);
  mkdirSync(dir);
  writeFileSync(join(dir, "README.md"), `# ${name}\n`);
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("-c", "user.name=gate", "-c", "user.email=gate@cedian.invalid", "commit", "-q", "-m", "init");
  return dir;
};
const appRepo = repo("app");
const libRepo = repo("lib");

/** cedia's project key for a root (`project_slug`). */
const slug = (root) => root.replace(/^\//, "").replace(/[^A-Za-z0-9._-]+/g, "-") || "root";

/** One request to the daemon, answered by the first notice `want` accepts. */
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

const PROMPT = [
  "Open three threads now with open_thread, so they run at the same time, and do none of the work yourself:",
  `1. title "App one", root ${appRepo}: append the line \`one\` to README.md and commit it.`,
  `2. title "Lib two", root ${libRepo}: append the line \`two\` to README.md and commit it.`,
  `3. title "Lib three", root ${libRepo}: create NOTES.md containing the line \`three\` and commit it.`,
  "Each thread changes nothing else. Then say which threads you opened.",
].join("\n");

const summary = { app, at: new Date().toISOString(), repos: [appRepo, libRepo] };
let failed = false;
let rootsBefore;
const first = await launch(app, {}, { folder: appRepo });
try {
  const { window, electronApp } = first;
  const pane = window.locator(".cedian-agent-pane.live");
  await pane.waitFor({ state: "visible", timeout: 60_000 });
  await pane.locator(".conn").waitFor({ state: "hidden", timeout: 60_000 });

  // One project, two roots, through the daemon as the settings window writes it.
  const settings = await ask({ op: "settings" }, (n) => n.kind === "settings");
  rootsBefore = settings.desktop?.roots ?? null;
  await ask({ op: "set_desktop", key: "roots", value: { ...(rootsBefore ?? {}), [slug(appRepo)]: [appRepo, libRepo] } }, (n) => n.kind === "settings");
  log(`one project: ${appRepo} (primary) and ${libRepo}`);

  // 1. The coordinator opens three threads.
  await window.waitForFunction(() => document.querySelector(".cedian-agent-pane.live select.threads option[value='@chat']"), null, { timeout: 30_000 });
  await pane.locator("select.threads").selectOption("@chat");
  const model = opt("--model");
  if (model) await pane.locator('select[data-chip="model"]').selectOption(model);
  await pane.locator(".composer textarea").fill(PROMPT);
  await pane.locator(".composer textarea").press("Enter");
  log("asked the coordinator for three threads");

  const daemonPid = () => JSON.parse(readFileSync(join(process.env.CEDIA_HOME ?? join(homedir(), ".cedia"), "desktop.lock"), "utf8")).pid;
  const samples = [];
  let together = 0;
  let cards = [];
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    cards = await pane.locator(".thread-card").evaluateAll((els) => els.map((e) => ({ id: e.dataset.thread, cls: e.className })));
    const working = cards.filter((c) => c.cls.includes("st-working")).length;
    together = Math.max(together, working);
    samples.push({ t: Date.now(), working, windowMb: treeRssMb(electronApp.process().pid), daemonMb: treeRssMb(daemonPid()) });
    if (working === 3 && !summary.shotTogether) {
      summary.shotTogether = true;
      await shot(window, "1-three-working");
    }
    if (cards.length >= 3 && cards.every((c) => /st-(done|failed|interrupted|asking)/.test(c.cls))) break;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  await shot(window, "2-cards-settled");
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const busy = samples.filter((s) => s.working > 0);
  summary.memory = {
    samples: samples.length,
    windowMb: { peak: Math.max(...samples.map((s) => s.windowMb)), median: median(samples.map((s) => s.windowMb)) },
    daemonAndRunsMb: { peak: Math.max(...samples.map((s) => s.daemonMb)), median: median(samples.map((s) => s.daemonMb)) },
    whileWorkingMb: busy.length ? { peak: Math.max(...busy.map((s) => s.windowMb + s.daemonMb)) } : null,
  };
  summary.together = together;
  log(`cards: ${cards.map((c) => c.cls.replace("thread-card ", "")).join(", ")}; at most ${together} working at once`);
  log(`memory: window peak ${summary.memory.windowMb.peak} MB, daemon and its runs peak ${summary.memory.daemonAndRunsMb.peak} MB`);

  // Where each thread ran and what it changed, from the daemon's own list.
  const listed = await ask({ op: "threads", cwd: appRepo }, (n) => n.kind === "threads" && n.cwd === appRepo);
  const opened = listed.threads.filter((t) => cards.some((c) => c.id === t.id));
  summary.threads = opened.map((t) => {
    const common = t.cwd ? execFileSync("git", ["-C", t.cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim() : "";
    const repoOf = common.startsWith(libRepo) ? "lib" : common.startsWith(appRepo) ? "app" : "?";
    const changed = t.cwd ? execFileSync("git", ["-C", t.cwd, "log", "--name-only", "--format=", "main..HEAD"], { encoding: "utf8" }).trim().split("\n").filter(Boolean) : [];
    const dirty = t.cwd ? execFileSync("git", ["-C", t.cwd, "status", "--porcelain"], { encoding: "utf8" }).trim().split("\n").filter(Boolean) : [];
    return { id: t.id, title: t.title, status: t.status, root: t.root ?? null, cwd: t.cwd, repo: repoOf, committed: changed, uncommitted: dirty };
  });
  for (const t of summary.threads) log(`${t.title}: ${t.status} in ${t.repo} (${t.cwd}); committed ${t.committed.join(" ") || "nothing"}${t.uncommitted.length ? `; uncommitted ${t.uncommitted.join(" ")}` : ""}`);
  const problems = [];
  if (summary.threads.length !== 3) problems.push(`${summary.threads.length} threads, not 3`);
  if (summary.threads.some((t) => t.status !== "done")) problems.push("not every thread finished");
  if (!summary.threads.some((t) => t.repo === "app") || summary.threads.filter((t) => t.repo === "lib").length < 2) problems.push("the threads are not one in app and two in lib");
  if (summary.threads.some((t) => t.committed.length === 0 && t.uncommitted.length === 0)) problems.push("a thread changed nothing");
  if (together < 3) problems.push(`at most ${together} threads worked at once`);
  if (problems.length) {
    failed = true;
    log(`FAIL three threads: ${problems.join("; ")}`);
  } else log("three threads across two repos ran at once and finished");

  // 3. Scroll 10k blocks in the live pane.
  await pane.locator("select.threads").selectOption(summary.threads[0]?.id ?? "");
  await pane.locator(".log").waitFor({ timeout: 30_000 });
  summary.scroll = await measureScroll(window, ".cedian-agent-pane.live .log");
  await shot(window, "3-scrolled");
  log(`scroll: ${JSON.stringify(summary.scroll)}`);
  if (!summary.scroll.ok) {
    failed = true;
    log("FAIL scroll: slower than 60 fps");
  }
} catch (error) {
  failed = true;
  log(`FAIL ${error.stack ?? error}`);
} finally {
  if (rootsBefore !== undefined) {
    await ask({ op: "set_desktop", key: "roots", value: rootsBefore }, (n) => n.kind === "settings").catch((e) => log(`could not put desktop.roots back: ${e}`));
    log("desktop.roots put back");
  }
  await first.electronApp.close();
}
const json = JSON.stringify(summary, null, 2) + "\n";
process.stdout.write(json);
const out = opt("--out");
if (out) writeFileSync(out, json);
console.log(failed ? "gate failed" : "gate ok");
process.exit(failed ? 1 : 0);
