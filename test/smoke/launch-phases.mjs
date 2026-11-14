#!/usr/bin/env node
// Where a built Cedian's launch goes, phase by phase: reads the report the window keeps
// (launchTiming.ts: VS Code's startup marks, then the workbench restored, the daemon connected,
// cedia's answer, the first thread list, the curtain lifted). Prints JSON, slowest phase first
// in `order`. Run it a few times: the first launch after a build also pays for code caching.
// Usage: node test/smoke/launch-phases.mjs <Cedian.app> [--runs 3] [--out file.json]
import { writeFileSync } from "node:fs";
import { launch } from "./app.mjs";

const args = process.argv.slice(2);
const app = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!app) {
  console.error("usage: node test/smoke/launch-phases.mjs <Cedian.app> [--runs 3] [--out file.json]");
  process.exit(2);
}
const runs = [];
for (let run = 0; run < Number(opt("--runs", "3")); run++) {
  const { electronApp, window } = await launch(app);
  try {
    await window.waitForSelector(".monaco-workbench", { timeout: 60_000 });
    // The report is written when the last phase is reached, or 45 s in whatever is missing.
    const handle = await window.waitForFunction(() => globalThis.cedianTiming?.find((r) => r.what.startsWith("launch")), undefined, { timeout: 60_000 });
    const report = await handle.jsonValue();
    runs.push({ ...report, order: [...report.phases].sort((a, b) => b.ms - a.ms).map((p) => `${p.name} ${p.ms}`) });
  } finally {
    await electronApp.close();
  }
}
const out = JSON.stringify({ app, runs }, null, 2);
console.log(out);
if (opt("--out")) writeFileSync(opt("--out"), out + "\n");
