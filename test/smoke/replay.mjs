#!/usr/bin/env node
// Plays a wire recording (`CEDIAN_WIRE_RECORD=<file>` on the daemon, spec §3.9) back into the
// agent pane: one window's notices, at the times they were sent, into the pane's own code in
// Playwright's Chromium with agentPane.css, timing every frame meanwhile. A stutter the owner
// saw becomes a fixture and a timed run. The pane's own requests (acks among them) go nowhere.
// Passes when the median frame is within a 60 Hz frame and at most 5% of frames take longer
// than 25 ms. Prints JSON.
// Usage: node test/smoke/replay.mjs <recording.jsonl> [--client <id>] [--speed <x>]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * One window's part of a recording: its cwd and the thread it opened (from its first `open` or
 * `prompt`), and the notices it was sent, each with its time from the first. `client` defaults
 * to the first that was sent a blocks notice.
 */
export function playback(text, client) {
  const entries = text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  const shows = (e) => e.notice && (e.notice.kind === "blocks" || e.notice.kind === "text");
  const id = client ?? entries.find(shows)?.client;
  if (id === undefined) throw new Error("no window in this recording was sent any blocks");
  const mine = entries.filter((e) => e.client === id);
  const first = mine.find((e) => e.request && (e.request.op === "open" || e.request.op === "prompt"))?.request;
  const notices = mine.filter((e) => e.notice).map((e) => ({ ms: e.ms, notice: e.notice }));
  const start = notices[0]?.ms ?? 0;
  return {
    client: id,
    cwd: first?.cwd ?? "/",
    thread: first?.op === "open" ? first.thread : (first?.thread ?? null),
    notices: notices.map((n) => ({ ms: n.ms - start, notice: n.notice })),
  };
}

/** The pane as one script that defines `globalThis.cedianReplay`. */
export function bundle() {
  const entry = `
    import { AgentPane } from "./src/agent-pane/pane";
    globalThis.cedianReplay = async (play, speed) => {
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      let listener = () => {};
      const wire = { request: () => {}, onAny: (l) => ((listener = l), () => {}) };
      const host = {
        cwd: play.cwd,
        files: async () => [],
        pickImages: async () => [],
        openReview: () => {},
        openUrl: () => {},
      };
      const pane = new AgentPane(document, wire, host);
      document.querySelector(".host").replaceChildren(pane.root);
      if (play.thread) pane.openThread(play.thread);
      const deltas = [];
      let playing = true;
      const frames = (async () => {
        let last = await frame();
        while (playing) {
          const t = await frame();
          deltas.push(t - last);
          last = t;
        }
      })();
      const handled = [];
      const t0 = performance.now();
      for (const { ms, notice } of play.notices) {
        const wait = ms / speed - (performance.now() - t0);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        const s = performance.now();
        listener(notice);
        handled.push(performance.now() - s);
      }
      await frame();
      await frame();
      playing = false;
      await frames;
      return { deltas, handled, playedMs: performance.now() - t0, nodes: pane.root.querySelectorAll("*").length };
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
  if (!s.length) return 0;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const percentile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const file = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  if (!file) {
    console.error("usage: node test/smoke/replay.mjs <recording.jsonl> [--client <id>] [--speed <x>]");
    process.exit(2);
  }
  const play = playback(readFileSync(file, "utf8"), opt("--client") === undefined ? undefined : Number(opt("--client")));
  const speed = Number(opt("--speed") ?? 1);
  const { chromium } = await import("playwright-core").catch(() => import("playwright"));
  const browser = await chromium.launch(process.env.CEDIAN_CHROMIUM ? { executablePath: process.env.CEDIAN_CHROMIUM } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 520, height: 900 } });
    const css = readFileSync(join(root, "vscode/contrib/cedian/browser/media/agentPane.css"), "utf8");
    await page.setContent(`<style>html,body{height:100%;margin:0}${css}</style><div class="host" style="display:flex;flex-direction:column;height:100%"></div>`);
    await page.evaluate(bundle());
    const raw = await page.evaluate(([p, s]) => globalThis.cedianReplay(p, s), [play, speed]);
    const ms = (x) => Math.round(x * 10) / 10;
    const result = {
      client: play.client,
      thread: play.thread,
      notices: play.notices.length,
      speed,
      playedMs: ms(raw.playedMs),
      nodes: raw.nodes,
      frames: raw.deltas.length,
      medianFrameMs: ms(median(raw.deltas)),
      p95FrameMs: ms(percentile(raw.deltas, 0.95)),
      worstFrameMs: ms(Math.max(0, ...raw.deltas)),
      over25ms: raw.deltas.filter((d) => d > 25).length,
      medianNoticeMs: ms(median(raw.handled)),
      worstNoticeMs: ms(Math.max(0, ...raw.handled)),
    };
    result.ok = result.medianFrameMs <= 1000 / 60 + 1 && result.over25ms <= raw.deltas.length * 0.05;
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await browser.close();
  }
}
