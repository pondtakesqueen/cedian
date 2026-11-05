#!/usr/bin/env node
// A terminal in a side block, its header drawn with VS Code's own CSS and Cedian's workbench.css:
// the "Terminal" tab, the terminal's title as VS Code's single-tab action ("Test dev server"), then
// +, split and trash, at block widths from narrow to wide. VS Code's side-block toolbar lets every
// action shrink to 22px (auxiliaryBarPart.ts, `responsive-all`); before workbench.css clipped it, the
// title kept drawing past its slot, over the buttons after it. Fails when any title's ink reaches
// the next button, or a button leaves the header.
// Needs a VS Code source tree at the pinned tag (script/vscode/prepare <dir>, or a checkout of the
// tag in vscode/UPSTREAM). Prints JSON. Usage: node test/smoke/block-header.mjs <vscode-src> [shot.png]
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const chromiumBin = process.env.CEDIAN_CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const [src, shot] = process.argv.slice(2);
if (!src) {
  console.error("usage: node test/smoke/block-header.mjs <vscode-src> [shot.png]");
  process.exit(2);
}

const VSCODE_CSS = [
  "src/vs/base/browser/ui/actionbar/actionbar.css",
  "src/vs/base/browser/ui/toolbar/toolbar.css",
  "src/vs/workbench/browser/media/part.css",
  "src/vs/workbench/browser/parts/media/compositepart.css",
  "src/vs/workbench/browser/parts/media/paneCompositePart.css",
  "src/vs/workbench/browser/parts/auxiliarybar/media/auxiliaryBarPart.css",
  "src/vs/workbench/contrib/terminal/browser/media/terminal.css",
  "src/vs/platform/actions/browser/menuEntryActionViewItem.css",
  "src/vs/workbench/contrib/modernUI/browser/media/padding.css",
  "src/vs/workbench/contrib/modernUI/browser/media/tabs.css",
];
const css = VSCODE_CSS.map(f => readFileSync(join(src, f), "utf8")).join("\n")
  + readFileSync(join(root, "vscode/contrib/cedian/browser/media/workbench.css"), "utf8").replace(/@font-face[^}]*}/g, "");

const WIDTHS = [260, 300, 340, 388, 460, 560];
const TITLES = ["Test dev server", "python3 -I -m http.server 8799 --bind 127.0.0.1", "zsh"];

/** One side block's header, as VS Code builds it (compositePart.ts, toolbar.ts, terminalView.ts). */
function block(width, title) {
  const item = inner => `<li class="action-item menu-entry" style="min-width:22px">${inner}</li>`;
  return `<div class="part auxiliarybar pane-composite-part" style="width:${width}px">
  <div class="composite title has-composite-bar">
    <div class="composite-bar-container"><div class="composite-bar"><div class="monaco-action-bar"><ul class="actions-container">
      <li class="action-item checked"><a class="action-label">Terminal</a><div class="active-item-indicator"></div></li>
    </ul></div></div></div>
    <div class="title-actions" style="min-width:24px"><div class="monaco-toolbar responsive responsive-all" style="min-width:24px"><div class="monaco-action-bar"><ul class="actions-container">
      ${item(`<a class="action-label single-terminal-tab"><span class="codicon codicon-terminal"></span>${title}</a>`)}
      ${item(`<a class="action-label codicon codicon-plus"></a>`)}
      ${item(`<a class="action-label codicon codicon-split-horizontal"></a>`)}
      ${item(`<a class="action-label codicon codicon-trash"></a>`)}
    </ul></div></div></div>
    <div class="global-actions"><div class="monaco-action-bar"><ul class="actions-container">
      ${item(`<a class="action-label codicon codicon-close"></a>`)}
    </ul></div></div>
  </div></div>`;
}

const html = `<!doctype html><meta charset="utf-8"><style>${css}
  body { margin: 0; font: 13px sans-serif; }
  .monaco-workbench { display: grid; gap: 8px; padding: 8px; --vscode-spacing-size40: 4px; --vscode-spacing-size80: 8px; }
  .codicon { display: inline-block; width: 16px; height: 16px; }
  .codicon::before { content: ""; display: block; width: 16px; height: 16px; background: currentColor; opacity: .4; }
</style><div class="monaco-workbench mac modern-ui modern-ui-tabs">
${TITLES.flatMap(t => WIDTHS.map(w => block(w, t))).join("\n")}
</div>`;

const { chromium } = await import("playwright-core").catch(() => import("playwright"));
const browser = await chromium.launch(chromiumBin ? { executablePath: chromiumBin } : {});
const page = await browser.newPage({ viewport: { width: 640, height: 900 } });
await page.setContent(html);
const rows = await page.evaluate(() => [...document.querySelectorAll(".part")].map(part => {
  const label = part.querySelector(".single-terminal-tab");
  const slot = label.parentElement;
  const next = slot.nextElementSibling.getBoundingClientRect();
  const head = part.querySelector(".title").getBoundingClientRect();
  // The ink: the label's own box, or its whole text when nothing clips it.
  const clips = el => getComputedStyle(el).overflowX !== "visible";
  const box = label.getBoundingClientRect();
  const inkRight = clips(label) || clips(slot) ? Math.min(box.right, slot.getBoundingClientRect().right) : box.left + label.scrollWidth;
  const buttons = [...part.querySelectorAll(".title-actions .codicon.action-label, .global-actions .action-label")].map(b => b.getBoundingClientRect());
  return {
    width: part.offsetWidth,
    title: label.textContent,
    slot: Math.round(slot.getBoundingClientRect().width),
    overlap: Math.max(0, Math.round(inkRight - next.left)),
    offHeader: buttons.some(b => b.right > head.right + 0.5 || b.left < head.left - 0.5),
  };
}));
if (shot) await page.screenshot({ path: shot, fullPage: true });
await browser.close();

const failed = rows.filter(r => r.overlap > 0 || r.offHeader);
console.log(JSON.stringify({ ok: failed.length === 0, rows }, null, 1));
process.exit(failed.length ? 1 : 0);
