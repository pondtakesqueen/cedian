#!/usr/bin/env node
// What the window's glass costs a scroll (the workbench mockup: the frame and side bar on macOS's
// vibrancy, the Command Palette and a context menu as frosted glass, a fade under the editor's
// header). Scrolls 10,000 blocks drawn with the agent pane's own renderer (scroll.mjs) in a page
// laid out as the window: a clear frame over a desktop, the side bar on it, the scrolling card in
// the middle. Three runs, each in a fresh page:
//   solid   the frame and side bar painted solid, nothing over the card (as before);
//   sheet   the frame and side bar clear at 68% over the desktop (the vibrancy's stand-in: the
//           real one is the window server's and costs the page nothing), a 12px gradient fade
//           over the card's top edge (workbench.css: a gradient layer, never a mask);
//   glass   the sheet, with a palette (blur 20px, saturate 1.8) and a menu (blur 12px) open over
//           the scrolling card: the worst case, something scrolling under the glass.
// Passes when each run's scroll meets scroll.mjs's bar (median within a 60 Hz frame, at most 5% of
// frames over 25 ms); the pane's own streaming numbers are scroll.mjs's to judge.
// Prints JSON. Usage: node test/smoke/glass.mjs [--blocks 10000] [--frames 600]
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { measureScroll } from "./scroll.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const chromiumBin = process.env.CEDIAN_CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

/** The window's page for one run. */
export function page(variant, paneCss) {
  const clear = variant !== "solid";
  const glass = variant === "glass";
  return `<!doctype html><style>
    :root { --frame:#151412; --app:#1C1B19; --raised:#2C2B28; --code:#1E1D1B; --line:#FFF8EB12; --line-strong:#FFF8EB21; --text:#EDEBE5; }
    html, body { height: 100%; margin: 0; }
    body { background: radial-gradient(70% 60% at 10% 10%, #2b3a55, transparent 70%), radial-gradient(60% 60% at 90% 90%, #4a3626, transparent 70%), #1d1f22; color: var(--text); font: 13px/1.6 sans-serif; }
    .win { position: absolute; inset: 0; display: grid; grid-template-rows: 38px 1fr 24px; background: ${clear ? "color-mix(in srgb, var(--frame) 68%, transparent)" : "var(--frame)"}; }
    .main { display: grid; grid-template-columns: 264px 1fr 360px; gap: 8px; padding: 0 8px 8px; min-height: 0; }
    .side { ${clear ? "" : "background: var(--app); border-radius: 12px; box-shadow: 0 0 0 1px var(--line);"} padding: 8px; }
    .side div { padding: 2px 8px; border-radius: 8px; }
    .card { position: relative; background: var(--code); border-radius: 12px; box-shadow: 0 0 0 1px var(--line); overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
    .card .head { flex: none; height: 40px; background: var(--app); }
    .card .fade { position: absolute; left: 0; right: 0; top: 40px; height: 12px; background: linear-gradient(var(--code), transparent); pointer-events: none; z-index: 2; }
    .cedian-agent-pane { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .glass { position: absolute; isolation: isolate; z-index: 10; }
    .glass::before { content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; background: color-mix(in srgb, var(--raised) 72%, transparent); box-shadow: inset 0 0 0 1px var(--line-strong), inset 0 1px 0 rgba(255,255,255,.1); }
    .pal { left: 320px; top: 80px; width: 520px; height: 260px; border-radius: 14px; box-shadow: 0 16px 40px rgba(0,0,0,.45); }
    .pal::before { backdrop-filter: blur(20px) saturate(1.8); }
    .menu { left: 600px; top: 420px; width: 210px; height: 160px; border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.45); }
    .menu::before { backdrop-filter: blur(12px); }
    ${paneCss}
  </style>
  <div class="win"><div></div><div class="main">
    <div class="side">${Array.from({ length: 24 }, (_, i) => `<div>thread ${i}</div>`).join("")}</div>
    <div class="card"><div class="head"></div>${clear ? '<div class="fade"></div>' : ""}<div class="cedian-agent-pane live"><div class="log"></div></div></div>
    <div class="card"></div>
  </div><div></div></div>
  ${glass ? '<div class="glass pal"></div><div class="glass menu"></div>' : ""}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? Number(args[i + 1]) : fallback;
  };
  const count = opt("--blocks", 10_000);
  const frames = opt("--frames", 600);
  const paneCss = readFileSync(join(root, "vscode/contrib/cedian/browser/media/agentPane.css"), "utf8");
  const { chromium } = await import("playwright-core").catch(() => import("playwright"));
  const browser = await chromium.launch(chromiumBin ? { executablePath: chromiumBin } : {});
  const runs = {};
  try {
    for (const variant of ["solid", "sheet", "glass"]) {
      const tab = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await tab.setContent(page(variant, paneCss));
      const r = await measureScroll(tab, ".cedian-agent-pane .log", { count, frames });
      runs[variant] = { ok: r.medianFrameMs <= 1000 / 60 + 1 && r.over25ms <= frames * 0.05, refreshMs: r.refreshMs, medianFrameMs: r.medianFrameMs, p95FrameMs: r.p95FrameMs, worstFrameMs: r.worstFrameMs, over25ms: r.over25ms, frames: r.frames, blocks: r.blocks };
      await tab.close();
    }
  } finally {
    await browser.close();
  }
  const ok = Object.values(runs).every((r) => r.ok);
  console.log(JSON.stringify({ ok, runs }, null, 2));
  process.exitCode = ok ? 0 : 1;
}
