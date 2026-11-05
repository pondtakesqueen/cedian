#!/usr/bin/env node
// The block layer end to end in a real Chromium, without the app: src/blocks/layer.ts (bundled)
// floats a stand-in block over a page with blocks.css and the theme's tokens, and Playwright's
// mouse drags it the way a person would. Checks: a floated block rests bottom right; a drag let go
// still rests in the nearest corner; a fling carries it on; a fling at a side stashes it and its
// tab brings it back; expand fills the frame and shrinks back; arrow keys step corners; a smaller
// window keeps it inside; the fan shows every block, stashed ones too, and a card picked comes
// back; Reduce Motion stops the glide; Dock hands it back. Saves screenshots in
// <out> (default test/smoke/out/blocks).
// Usage: node test/smoke/blocks.mjs [<out>]   (CEDIAN_CHROMIUM names a Chromium)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.argv[2] ?? join(root, "test/smoke/out/blocks");
mkdirSync(out, { recursive: true });
const chromiumBin = process.env.CEDIAN_CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.error(`${pass ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

const bundle = execFileSync(join(root, "node_modules/.bin/esbuild"), ["--bundle", "--format=iife", "--loader=ts"], {
  cwd: root,
  input: `import { BlockLayer } from "./src/blocks/layer";
    import { cssText } from "./src/theme/theme";
    window.start = (appearance) => {
      const style = document.createElement("style");
      style.textContent = cssText(appearance, "body");
      document.head.append(style);
      window.theme = (a) => (style.textContent = cssText(a, "body"));
      window.changes = [];
      window.docked = [];
      const layer = new BlockLayer(document, { dock: (k) => window.docked.push(k), changed: (f) => window.changes.push(f) });
      document.querySelector("#frame").append(layer.root);
      const block = (kind, label) => {
        const root = document.createElement("div");
        root.className = "stand-in";
        root.textContent = label;
        return { kind, root, title: () => label, onTitle: () => () => {}, layout: (w, h) => { root.dataset.size = w + "x" + h; }, focus: () => {}, dispose: () => root.remove() };
      };
      window.layer = layer;
      window.float = (kind, label, at) => layer.float(block(kind, label), at);
    };`,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const css = readFileSync(join(root, "vscode/contrib/cedian/browser/media/blocks.css"), "utf8");
// A stand-in workbench behind the layer: editors to float over.
const PAGE = `<!doctype html><meta charset="utf-8"><style>html, body { margin: 0; height: 100% }
body { font: 13px -apple-system, system-ui, sans-serif; background: var(--cedian-app); color: var(--cedian-text) }
#frame { position: relative; height: 100%; overflow: hidden }
.editor { position: absolute; inset: 8px; border-radius: 12px; background: var(--cedian-sheet); padding: 16px; box-shadow: 0 0 0 1px var(--cedian-line) }
.editor pre { font: 12px/1.6 Menlo, monospace; color: var(--cedian-text-muted); margin: 0 }
.stand-in { display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #e8f5d8, #fff); color: #333; font-size: 15px }
${css}</style><body><div id="wb" class="monaco-workbench monaco-enable-motion" style="height: 100%"><div id="frame"><div class="editor"><pre>${Array.from({ length: 40 }, (_, i) => `${String(i + 1).padStart(3)}  const basket = items.map((item) => item.price) // ตะกร้า`).join("\n")}</pre></div></div></div><script>${bundle}</script></body>`;
const server = createServer((_, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const { chromium } = await import("playwright-core").catch(() => import("playwright"));
const browser = await chromium.launch(chromiumBin ? { executablePath: chromiumBin } : {});
const W = 1200;
const H = 800;
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => ok("no error in the page", false, e.message));
await page.goto(url);
await page.evaluate(() => window.start("light"));

const box = (kind = "browser") => page.locator(`.cedian-pip[data-kind="${kind}"]`).boundingBox();
const settled = async () => {
  // The glide is 180 ms (motion.ts OPEN_MS); wait for transitions to finish.
  await page.waitForTimeout(320);
};
const last = () => page.evaluate(() => window.changes.at(-1));
const near = (a, b, d = 2) => Math.abs(a - b) <= d;
const GAP = 12;

try {
  await page.evaluate(() => window.float("browser", "Browser block"));
  await settled();
  let b = await box();
  ok("a floated block rests bottom right", near(b.x, W - GAP - 440) && near(b.y, H - GAP - 300), `${b.x},${b.y}`);
  await page.screenshot({ path: join(out, "1-floating.png") });

  // Drag by the header to the top left and hold still before letting go: a drop.
  const head = page.locator('.cedian-pip[data-kind="browser"] .pip-head');
  let h = await head.boundingBox();
  await page.mouse.move(h.x + 60, h.y + 15);
  await page.mouse.down();
  await page.mouse.move(400, 300, { steps: 12 });
  await page.mouse.move(200, 120, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await settled();
  b = await box();
  ok("dragged and dropped still, it rests in the nearest corner", near(b.x, GAP) && near(b.y, GAP) && (await last())[0].corner === "tl", `${b.x},${b.y}`);

  // A quick fling down from the top left carries it on to the bottom left.
  h = await head.boundingBox();
  await page.mouse.move(h.x + 60, h.y + 15);
  await page.mouse.down();
  await page.mouse.move(h.x + 60, h.y + 120, { steps: 3 });
  await page.mouse.move(h.x + 60, h.y + 260, { steps: 3 });
  await page.mouse.up();
  await settled();
  ok("flung, it carries on to where it was going", (await last())[0].corner === "bl", JSON.stringify(await last()));

  // A fling at the right side stashes it there with a tab showing.
  h = await head.boundingBox();
  await page.mouse.move(h.x + 60, h.y + 15);
  await page.mouse.down();
  await page.mouse.move(h.x + 500, h.y + 15, { steps: 3 });
  await page.mouse.move(h.x + 1100, h.y + 15, { steps: 3 });
  await page.mouse.up();
  await settled();
  b = await box();
  const stash = (await last())[0];
  ok("flung at a side, it stashes there with a tab in the frame", stash.stash === "right" && near(b.x, W - 28), `${JSON.stringify(stash)} x=${b.x}`);
  await page.screenshot({ path: join(out, "2-stashed.png") });
  await page.locator('.cedian-pip[data-kind="browser"] .pip-tab').click();
  await settled();
  b = await box();
  ok("the tab brings it back to its corner", near(b.x, W - GAP - 440) && !(await last())[0].stash, `${b.x},${b.y}`);

  // Expand fills the frame; again shrinks it back.
  await page.locator('.cedian-pip[data-kind="browser"] .pip-expand').click();
  await settled();
  b = await box();
  const size = await page.locator(".stand-in").getAttribute("data-size");
  ok("expand fills the frame and lays the block out below its header", near(b.width, W - 2 * GAP) && near(b.height, H - 2 * GAP) && size === `${W - 2 * GAP}x${H - 2 * GAP - 30}`, `${b.width}x${b.height} ${size}`);
  await page.screenshot({ path: join(out, "3-expanded.png") });
  await page.locator('.cedian-pip[data-kind="browser"] .pip-expand').click();
  await settled();
  b = await box();
  ok("and shrinks back to its corner", near(b.width, 440) && near(b.height, 300));

  // Resize by the free corner: bottom right grows up and left; the corner stays put.
  b = await box();
  await page.mouse.move(b.x + 4, b.y + 4);
  await page.mouse.down();
  await page.mouse.move(b.x + 4 - 60, b.y + 4 - 40, { steps: 6 });
  await page.mouse.move(b.x + 4 - 120, b.y + 4 - 80, { steps: 6 });
  await page.mouse.up();
  await settled();
  b = await box();
  const grown = (await last())[0];
  ok("resized by its free corner, the resting corner stays", near(b.width, 560) && near(b.height, 380) && near(b.x + b.width, W - GAP) && near(b.y + b.height, H - GAP) && grown.width === 560 && grown.height === 380, `${b.x},${b.y} ${b.width}x${b.height}`);
  await page.screenshot({ path: join(out, "3b-resized.png") });
  await head.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowDown");
  await settled();
  b = await box();
  ok("Shift+arrows resize it from the keyboard", near(b.width, 480) && near(b.height, 420), `${b.width}x${b.height}`);
  await page.evaluate(() => window.layer.resizeTo("browser", { width: 440, height: 300 }));
  await settled();

  // Arrow keys on the header step corners.
  await head.focus();
  await page.keyboard.press("ArrowUp");
  await settled();
  b = await box();
  ok("arrow keys move it a corner at a time", near(b.y, GAP) && (await last())[0].corner === "tr", `${b.x},${b.y}`);

  // Two blocks in one corner stack.
  await page.evaluate(() => window.float("agent", "Side chat", { corner: "tr" }));
  await settled();
  const a = await box("agent");
  ok("a second block in the corner stacks below the first", near(a.y, GAP + 300 + GAP) && near(a.x, W - GAP - 440), `${a.x},${a.y}`);
  await page.screenshot({ path: join(out, "4-stacked.png") });

  // The fan: a third block stashed, then all three fanned out across the middle; a click on the
  // stashed one's card brings it back.
  await page.evaluate(() => window.float("side", "Stashed block", { corner: "bl", stash: "left" }));
  await settled();
  await page.evaluate(() => window.layer.fan());
  await settled();
  const cards = await Promise.all(["browser", "agent", "side"].map((k) => box(k)));
  ok("fanned, every block is a card inside the frame, the stashed one too", cards.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.width <= W + 1 && r.y + r.height <= H + 1), JSON.stringify(cards.map((r) => [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)])));
  await page.screenshot({ path: join(out, "4b-fanned.png") });
  const s = await box("side");
  await page.mouse.click(s.x + s.width / 2, s.y + s.height / 2);
  await settled();
  const picked = await page.evaluate(() => ({ fanned: window.layer.isFanned, state: window.layer.stateOf("side") }));
  const back = await box("side");
  ok("a card clicked in the fan comes back out of its stash", !picked.fanned && picked.state === "focused" && near(back.x, GAP), JSON.stringify(picked));
  await page.evaluate(() => window.layer.close("side"));
  await settled();

  // A smaller window keeps both inside.
  await page.setViewportSize({ width: 700, height: 500 });
  await settled();
  const small = [await box(), await box("agent")];
  const reachable = await page.evaluate(() =>
    ["browser", "agent"].every((kind) => {
      const b = document.querySelector(`.cedian-pip[data-kind="${kind}"] .pip-expand`).getBoundingClientRect();
      return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest(".cedian-pip")?.dataset.kind === kind;
    }),
  );
  ok("in a smaller window neither block covers the other's buttons", reachable);
  ok("a smaller window keeps them inside", small.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.width <= 700 + 1 && r.y + r.height <= 500 + 1), JSON.stringify(small.map((r) => [r.x, r.y, r.width, r.height])));
  await page.setViewportSize({ width: W, height: H });
  await settled();

  // Reduce Motion: no glide. VS Code takes monaco-enable-motion off the workbench for the OS's
  // reduced motion and for workbench.reduceMotion alike; the glide hangs on that class.
  const duration = () => page.locator('.cedian-pip[data-kind="browser"]').evaluate((n) => getComputedStyle(n).transitionDuration);
  const gliding = await duration();
  ok("with motion on, a block glides", gliding.split(",").some((d) => parseFloat(d) > 0), gliding);
  await page.evaluate(() => document.querySelector("#wb").classList.remove("monaco-enable-motion"));
  const transition = await duration();
  ok("Reduce Motion stops the glide", transition.split(",").every((d) => parseFloat(d) === 0), transition);
  await page.evaluate(() => document.querySelector("#wb").classList.add("monaco-enable-motion"));

  // Dark theme.
  await page.evaluate(() => window.theme("dark"));
  await settled();
  await page.screenshot({ path: join(out, "5-dark.png") });

  // Dock hands it back and leaves only the other.
  await page.locator('.cedian-pip[data-kind="browser"] .pip-dock').click();
  const docked = await page.evaluate(() => window.docked);
  const left = await page.evaluate(() => window.layer.floating().map((f) => f.kind));
  ok("Dock closes it here and hands it back", docked.includes("browser") && !left.includes("browser"), `${docked} / ${left}`);
} catch (e) {
  ok("the smoke ran to the end", false, e.message);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.pass);
console.error(`${results.length - failed.length}/${results.length} passed; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
