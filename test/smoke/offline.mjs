#!/usr/bin/env node
// §13 Telemetry gate (spec §9): the built app sends nothing on its own. Launches it with VS
// Code's own defaults for telemetry and updates (none of the smoke launch's "off" settings),
// opens a file, types and idles, and lists every connection the app's processes hold to a
// host that is not this machine, sampled with lsof. No model is asked, so none is expected.
// Also checks that crash reporting points at ~/Library/Logs/Cedian (patch 0004).
// Prints what it saw and a JSON summary (also to --out); exits 1 on any outside connection.
// Usage: node test/smoke/offline.mjs <Cedian.app> [--seconds 60] [--out file.json]
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
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
  console.error("usage: node test/smoke/offline.mjs <Cedian.app> [--seconds 60] [--out file.json]");
  process.exit(2);
}
const seconds = Number(opt("--seconds") ?? 60);
const log = (line) => console.log(`offline: ${line}`);

/** `pid` and every process under it. */
function tree(pid) {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map();
  for (const [p, pp] of rows) kids.set(pp, [...(kids.get(pp) ?? []), p]);
  const all = [];
  const stack = [pid];
  while (stack.length) {
    const p = stack.pop();
    all.push(p);
    stack.push(...(kids.get(p) ?? []));
  }
  return all;
}

const local = (host) => /^(127\.|\[?::1\]?$|\[?::ffff:127\.|localhost$|\*$)/.test(host);

/** The outside endpoints the processes hold now, as "host:port". */
function outside(pids) {
  let out = "";
  try {
    out = execFileSync("lsof", ["-nP", "-a", "-p", pids.join(","), "-i", "-F", "n"], { encoding: "utf8" });
  } catch (e) {
    // lsof exits 1 when it finds nothing.
    out = e.stdout ?? "";
  }
  const seen = [];
  for (const line of out.split("\n")) {
    if (!line.startsWith("n") || !line.includes("->")) continue;
    const remote = line.slice(line.indexOf("->") + 2);
    const host = remote.slice(0, remote.lastIndexOf(":"));
    if (!local(host)) seen.push(remote);
  }
  return seen;
}

// A state dir of its own, so the app starts its own daemon inside the watched process tree
// (a daemon already running would be outside it, with its cedia children).
process.env.CEDIAN_STATE_DIR = mkdtempSync(join(tmpdir(), "cedian-offline-state-"));
const { electronApp, window } = await launch(app, { "telemetry.telemetryLevel": undefined, "update.mode": undefined, "extensions.autoCheckUpdates": undefined });
const pid = electronApp.process().pid;
const endpoints = new Map();
const sample = () => {
  for (const e of outside(tree(pid))) endpoints.set(e, (endpoints.get(e) ?? 0) + 1);
};

// Open a file and type in it, then idle; sample all the while.
const until = Date.now() + seconds * 1000;
const sampling = (async () => {
  while (Date.now() < until) {
    sample();
    await new Promise((r) => setTimeout(r, 500));
  }
})();
// Opened from the Explorer and typed into only once the editor has focus: Cmd+P is a menu
// accelerator a synthetic key never reaches, and the agent pane's composer, which has focus at
// launch, would send the text as a prompt (a real model call, and outside connections).
await window.locator(".explorer-folders-view .monaco-list-row", { hasText: "README.md" }).click({ timeout: 30_000 });
const editor = window.locator(".editor-instance .monaco-editor").first();
await editor.locator(".view-lines").click({ timeout: 15_000 });
if (!(await editor.evaluate((e) => e.contains(document.activeElement)))) throw new Error("the editor does not have focus; not typing");
await window.keyboard.type("hello from the offline gate\n");
await sampling;
// Closing can wait on the daemon the app started; the summary does not depend on it.
await Promise.race([electronApp.close(), new Promise((r) => setTimeout(r, 15_000))]);

const crashDir = join(homedir(), "Library", "Logs", "Cedian");
const summary = {
  seconds,
  outside: [...endpoints].map(([endpoint, samples]) => ({ endpoint, samples })),
  crashReportsLocal: existsSync(crashDir),
};
for (const { endpoint, samples } of summary.outside) log(`connection to ${endpoint} (${samples} samples)`);
log(summary.outside.length ? `${summary.outside.length} outside endpoints` : `no outside connections in ${seconds} s`);
log(`crash reports in ${crashDir}: ${summary.crashReportsLocal ? "yes" : "no"}`);
console.log(JSON.stringify(summary));
if (opt("--out")) writeFileSync(opt("--out"), JSON.stringify(summary, null, 2));
process.exit(summary.outside.length || !summary.crashReportsLocal ? 1 : 0);
