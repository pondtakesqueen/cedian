#!/usr/bin/env node
// Phase C's "scroll 10k blocks @60fps" (spec §11): draws 10,000 blocks with the agent pane's own
// renderer (cedia's recorded fixtures, repeated) into a pane's log, scrolls it top to bottom one
// step per animation frame, and times the frames. In the app (gate-c.mjs) it draws into the live
// pane, so the workbench's CSS and DOM are the real ones; run alone it draws into a bare page in
// Playwright's Chromium with agentPane.css, which is quicker to iterate on.
// Passes when the median frame is within a 60 Hz frame and at most 5% of frames take longer
// than 25 ms (a dropped frame at 60 Hz). Prints JSON.
// Usage: node test/smoke/scroll.mjs [--blocks 10000] [--frames 600]
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** `count` blocks from cedia's fixtures, repeated in order. */
export function blocks(count) {
  const dir = join(root, "daemon/crates/cedian_agent/tests/replay");
  const all = readdirSync(dir)
    .filter((f) => f.endsWith(".blocks.json"))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8"))[""]);
  return Array.from({ length: count }, (_, i) => all[i % all.length]);
}

/** The pane's renderer as one script that defines `globalThis.cedianScroll`. */
export function bundle() {
  const entry = `
    import { items } from "./src/agent-pane/items";
    import { renderItems } from "./src/agent-pane/render";
    globalThis.cedianScroll = async (selector, blocks, frames) => {
      const log = document.querySelector(selector);
      if (!log) throw new Error("no " + selector);
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      // What a 60 Hz or faster display gives an idle page.
      const idle = [];
      let last = await frame();
      for (let i = 0; i < 60; i++) { const t = await frame(); idle.push(t - last); last = t; }
      const started = performance.now();
      log.replaceChildren(renderItems(document, items(blocks)));
      log.scrollTop = 0;
      await frame();
      const renderMs = performance.now() - started;
      const max = log.scrollHeight - log.clientHeight;
      const deltas = [];
      last = await frame();
      for (let i = 1; i <= frames; i++) {
        log.scrollTop = (max * i) / frames;
        const t = await frame();
        deltas.push(t - last);
        last = t;
      }
      return { idle, deltas, renderMs, height: log.scrollHeight, nodes: log.querySelectorAll("*").length };
    };`;
  return execFileSync(join(root, "node_modules/.bin/esbuild"), ["--bundle", "--format=iife", "--loader=ts"], {
    cwd: root,
    input: entry,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const percentile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

/** Draws and scrolls in `page` (a Playwright page whose `selector` is a scrollable log). */
export async function measureScroll(page, selector, { count = 10_000, frames = 600 } = {}) {
  await page.evaluate(bundle());
  const raw = await page.evaluate(([s, b, f]) => globalThis.cedianScroll(s, b, f), [selector, blocks(count), frames]);
  const ms = (x) => Math.round(x * 10) / 10;
  const result = {
    blocks: count,
    frames,
    nodes: raw.nodes,
    heightPx: raw.height,
    renderMs: ms(raw.renderMs),
    refreshMs: ms(median(raw.idle)),
    medianFrameMs: ms(median(raw.deltas)),
    p95FrameMs: ms(percentile(raw.deltas, 0.95)),
    worstFrameMs: ms(Math.max(...raw.deltas)),
    over25ms: raw.deltas.filter((d) => d > 25).length,
  };
  result.ok = result.medianFrameMs <= 1000 / 60 + 1 && result.over25ms <= frames * 0.05;
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? Number(args[i + 1]) : fallback;
  };
  const { chromium } = await import("playwright-core").catch(() => import("playwright"));
  const browser = await chromium.launch(process.env.CEDIAN_CHROMIUM ? { executablePath: process.env.CEDIAN_CHROMIUM } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 520, height: 900 } });
    const css = readFileSync(join(root, "vscode/contrib/cedian/browser/media/agentPane.css"), "utf8");
    await page.setContent(`<style>html,body{height:100%;margin:0}${css}</style><div class="cedian-agent-pane live" style="display:flex;flex-direction:column;height:100%"><div class="log"></div></div>`);
    const result = await measureScroll(page, ".cedian-agent-pane .log", { count: opt("--blocks", 10_000), frames: opt("--frames", 600) });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await browser.close();
  }
}
