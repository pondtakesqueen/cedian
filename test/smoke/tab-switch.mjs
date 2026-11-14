#!/usr/bin/env node
// What switching tabs costs in a built app, against Chrome's bar: a tab switch shows on the next
// frame after the press (Chrome keeps every tab's page alive and only swaps what is shown).
//   editor   N files open in one group (N = 2, 10, 30): a real click on a tab, from the press's
//            own timestamp to the frame after the new file's text is in the editor. Median, p95.
//   press    what the window does on any press before VS Code sees it: a pointerdown dispatched
//            50 times with N tabs open (tabMove.ts notes every tab of every group on each press).
//   reload   what a project tab switch cost before projects kept their windows: Reload Window,
//            from Enter to the curtain lifted, 3 times.
//   project  a project tab switch through `cedian.showProject` (bound to a key here): to a project
//            with no window (a new one loads, to its curtain lifted), then back and forth between
//            the two (the window picked has the focus), 6 times. Null on a build without it.
//   frames   long animation frames (> 50 ms) seen during the editor clicks, with the scripts in them.
// Prints JSON. Usage: node test/smoke/tab-switch.mjs <app> [--out file.json] [--reduce-motion]
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./app.mjs";

const args = process.argv.slice(2);
const app = args[0];
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!app) {
  console.error("usage: node test/smoke/tab-switch.mjs <app> [--out file.json] [--reduce-motion]");
  process.exit(2);
}
const mod = process.platform === "darwin" ? "Meta" : "Control";
const COUNTS = [2, 10, 30];
const CLICKS = 20;

const stats = (xs) => {
  if (!xs.length) return { median: null, p95: null, max: null, n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { median: +at(0.5).toFixed(1), p95: +at(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1), n: s.length };
};

const settings = { "workbench.editor.enablePreview": false, "workbench.editor.enablePreviewFromQuickOpen": false };
if (args.includes("--reduce-motion")) settings["workbench.reduceMotion"] = "on";
// Two projects, and a key for each that shows it as its project tab does.
const scratch = mkdtempSync(join(tmpdir(), "cedian-tabs-"));
const user = join(scratch, "user");
const folder = join(scratch, "one");
const other = join(scratch, "two");
for (const dir of [join(user, "User"), folder, other]) mkdirSync(dir, { recursive: true });
writeFileSync(join(folder, "README.md"), "# one\n");
writeFileSync(join(other, "README.md"), "# two\n");
writeFileSync(
  join(user, "User", "keybindings.json"),
  JSON.stringify([
    { key: "ctrl+alt+1", command: "cedian.showProject", args: folder },
    { key: "ctrl+alt+2", command: "cedian.showProject", args: other },
  ]),
);
const { electronApp, window } = await launch(app, settings, { user, folder });
const name = (i) => `f${String(i).padStart(2, "0")}.ts`;
// Files written after launch: the window opened the folder already, so it sees them on Quick Open.
{
  const { writeFileSync: write } = await import("node:fs");
  for (let i = 1; i <= COUNTS[COUNTS.length - 1]; i++) {
    const lines = [`// ${name(i)}`];
    for (let l = 0; l < 1500; l++) lines.push(`export const v${l} = ${l} * ${i}; // line ${l}`);
    write(join(folder, name(i)), lines.join("\n"));
  }
}

const curtainUp = (page = window) =>
  page.waitForFunction(() => {
    const w = document.querySelector(".monaco-workbench");
    return !!w && !w.classList.contains("cedian-curtain") && !w.classList.contains("cedian-curtain-lifting") && !!document.querySelector(".part.editor");
  }, null, { timeout: 60_000, polling: 50 });

const install = () =>
  window.evaluate(() => {
    const frames = [];
    window.__cedianFrames = frames;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          frames.push({
            duration: Math.round(e.duration),
            blocking: Math.round(e.blockingDuration ?? 0),
            scripts: (e.scripts ?? []).map((s) => ({
              ms: Math.round(s.duration),
              fn: s.sourceFunctionName,
              invoker: s.invoker,
              at: `${(s.sourceURL || "").split("/").slice(-2).join("/")}:${s.sourceCharPosition}`,
            })),
          });
        }
      }).observe({ type: "long-animation-frame", buffered: false });
    } catch {}
    // A press, to the frame after `want` is the text of the active group's editor.
    window.__cedianSwitch = (want) =>
      new Promise((resolve) => {
        const onDown = (e) => {
          window.removeEventListener("pointerdown", onDown, true);
          const t0 = e.timeStamp;
          const check = () => {
            const lines = document.querySelector(".part.editor .editor-group-container.active .monaco-editor .view-lines");
            // Monaco draws spaces as U+00A0.
            if (lines?.textContent?.replace(/\u00a0/g, " ").includes(want)) requestAnimationFrame(() => resolve(performance.now() - t0));
            else if (performance.now() - t0 > 5000) resolve(-1);
            else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        };
        window.addEventListener("pointerdown", onDown, true);
      });
    // What every press costs before it reaches what was pressed.
    window.__cedianPress = (n) => {
      const target = document.createElement("div");
      target.style.cssText = "position:fixed;left:-10px;top:-10px;width:1px;height:1px";
      document.body.append(target);
      const xs = [];
      for (let i = 0; i < n; i++) {
        const t = performance.now();
        target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
        xs.push(performance.now() - t);
        target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
      }
      target.remove();
      return xs;
    };
  });

await window.waitForSelector(".monaco-workbench .part.editor", { timeout: 60_000 });
await curtainUp();
await window.waitForTimeout(1500);
await install();

const open = async (file) => {
  await window.keyboard.press(`${mod}+P`);
  await window.keyboard.type(file);
  await window.waitForTimeout(250);
  await window.keyboard.press("Enter");
  await window.locator(".part.editor .tabs-container > .tab", { hasText: file }).first().waitFor();
};

const result = { app, at: new Date().toISOString(), reduceMotion: args.includes("--reduce-motion"), editor: {}, press: {}, reload: null, project: null, frames: [] };
let opened = 0;
for (const count of COUNTS) {
  while (opened < count) await open(name(++opened));
  await window.waitForTimeout(800);
  result.press[count] = stats(await window.evaluate((n) => window.__cedianPress(n), 50));
  // Two tabs next to each other at the end of the row (in view), one after the other.
  const a = name(count - 1);
  const b = name(count);
  const times = [];
  await window.evaluate(() => (window.__cedianFrames.length = 0));
  for (let i = 0; i < CLICKS; i++) {
    const want = i % 2 ? b : a;
    const tab = window.locator(".part.editor .tabs-container > .tab", { hasText: want }).first();
    await tab.scrollIntoViewIfNeeded();
    const done = window.evaluate((w) => window.__cedianSwitch(`// ${w}`), want);
    await window.waitForTimeout(30);
    await tab.click();
    times.push(await done);
    await window.waitForTimeout(300);
  }
  result.editor[count] = stats(times.filter((t) => t >= 0));
  result.editor[count].missed = times.filter((t) => t < 0).length;
  const frames = await window.evaluate(() => window.__cedianFrames.splice(0));
  result.frames.push(...frames.map((f) => ({ tabs: count, ...f })));
}

// A project tab switch: the window loads again behind the curtain.
const reloads = [];
for (let i = 0; i < 3; i++) {
  await window.keyboard.press(`${mod}+Shift+P`);
  await window.keyboard.type("Reload Window");
  await window.waitForTimeout(300);
  const t0 = performance.now();
  await Promise.all([window.waitForEvent("framenavigated", { timeout: 30_000 }), window.keyboard.press("Enter")]);
  await window.waitForSelector(".monaco-workbench .part.editor", { timeout: 60_000 });
  await curtainUp();
  reloads.push(performance.now() - t0);
  await window.waitForTimeout(1500);
}
result.reload = stats(reloads);

// A project tab switch: to a project with no window, then between the two.
{
  const focused = (page, ms) => page.waitForFunction(() => document.hasFocus(), null, { timeout: ms, polling: 5 });
  await window.bringToFront();
  const t0 = performance.now();
  const opened = electronApp.waitForEvent("window", { timeout: 15_000 }).catch(() => undefined);
  await window.keyboard.press("Control+Alt+2");
  const second = await opened;
  if (second) {
    await second.waitForSelector(".monaco-workbench .part.editor", { timeout: 60_000 });
    await curtainUp(second);
    const cold = performance.now() - t0;
    await second.waitForTimeout(1500);
    const warm = [];
    let from = second;
    let to = window;
    for (let i = 0; i < 6; i++) {
      const t = performance.now();
      await from.keyboard.press(to === window ? "Control+Alt+1" : "Control+Alt+2");
      await focused(to, 10_000);
      warm.push(performance.now() - t);
      await to.waitForTimeout(500);
      [from, to] = [to, from];
    }
    result.project = { cold: +cold.toFixed(1), warm: stats(warm), windows: electronApp.windows().length };
  }
}

const json = JSON.stringify(result, null, 2) + "\n";
process.stdout.write(json);
const out = opt("--out");
if (out) writeFileSync(out, json);
await electronApp.close();
