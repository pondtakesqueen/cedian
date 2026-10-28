#!/usr/bin/env node
// Measures what spec §9 budgets on a built app: cold start (process start to the workbench
// drawn), keystroke (a key pressed in an editor to its character in the DOM, median of 40),
// and idle memory (RSS of the app's process tree after 15 s idle). Prints JSON; with --out
// also writes it. Run it on stock VS Code 1.143.1 and on Cedian.app, on the same Mac.
// These are Playwright-side timings; the §13 gate's HID-event + pixel-polling harness is
// separate and still to come.
// Usage: node test/smoke/budgets.mjs <app> [--runs 5] [--out file.json]
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { launch } from "./app.mjs";

const args = process.argv.slice(2);
const app = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!app) {
  console.error("usage: node test/smoke/budgets.mjs <app> [--runs 5] [--out file.json]");
  process.exit(2);
}
const runs = Number(opt("--runs", "5"));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** RSS in MB of `pid` and every process under it. */
function treeRssMb(pid) {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map();
  for (const [p, pp] of rows) kids.set(pp, [...(kids.get(pp) ?? []), p]);
  const rss = new Map(rows.map(([p, , r]) => [p, r]));
  let total = 0;
  const stack = [pid];
  while (stack.length) {
    const p = stack.pop();
    total += rss.get(p) ?? 0;
    stack.push(...(kids.get(p) ?? []));
  }
  return Math.round(total / 1024);
}

const coldStarts = [];
const idle = [];
let keystroke = null;
for (let run = 0; run < runs; run++) {
  const { electronApp, window, startedAt } = await launch(app);
  try {
    await window.waitForSelector(".monaco-workbench .part.editor", { timeout: 60_000 });
    coldStarts.push(Math.round(performance.now() - startedAt));
    if (run === 0) {
      await window.keyboard.press(process.platform === "darwin" ? "Meta+N" : "Control+N");
      const editor = window.locator(".monaco-editor .view-lines").first();
      await editor.waitFor({ state: "visible" });
      await window.locator(".monaco-editor textarea").first().focus();
      const times = [];
      for (let i = 0; i < 40; i++) {
        const want = "x".repeat(i + 1);
        const t0 = performance.now();
        await window.keyboard.press("x");
        await window.waitForFunction(
          (w) => document.querySelector(".monaco-editor .view-lines")?.textContent?.includes(w),
          want,
          { polling: "raf" },
        );
        times.push(performance.now() - t0);
      }
      keystroke = Math.round(median(times) * 10) / 10;
    }
    await window.waitForTimeout(15_000);
    const pid = electronApp.process().pid;
    idle.push(treeRssMb(pid));
  } finally {
    await electronApp.close();
  }
}

const result = {
  app,
  at: new Date().toISOString(),
  host: { platform: process.platform, arch: process.arch, release: execFileSync("uname", ["-r"], { encoding: "utf8" }).trim() },
  runs,
  coldStartMs: { median: median(coldStarts), all: coldStarts },
  keystrokeMs: { median: keystroke, samples: 40 },
  idleMemoryMb: { median: median(idle), all: idle },
};
const json = JSON.stringify(result, null, 2) + "\n";
process.stdout.write(json);
const out = opt("--out");
if (out) writeFileSync(out, json);
