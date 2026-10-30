#!/usr/bin/env node
// The Browser block end to end, without the app: the real daemon (target/debug/cedian-daemon)
// starts its Chromium, and the block (src/browser-panel/panel.ts, bundled) draws in a page of
// Playwright's Chromium with browserPanel.css, talking to the daemon over its socket the way the
// app's main process relays it. A local site stands in for a dev server. Checks: the page is
// screencast into the block; a click and typing reach it; tabs open and close through the
// daemon; the console shows the page's errors; the picker hands an element to the composer;
// "Claude tools are off for this site" on a site not on the list, gone once allowed; a load
// that fails says so in the block. Saves screenshots in <out> (default test/smoke/out/browser).
// Usage: node test/smoke/browser.mjs [<out>]   (cargo build first; CEDIAN_CHROMIUM names a Chromium)
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.argv[2] ?? join(root, "test/smoke/out/browser");
mkdirSync(out, { recursive: true });
const chromiumBin = process.env.CEDIAN_CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const daemonBin = join(root, "daemon/target/debug/cedian-daemon");
if (!existsSync(daemonBin)) throw new Error("cargo build the daemon first");

const SITE = `<!doctype html><title>Basket</title>
<style>body { font: 16px system-ui; margin: 24px } button { font-size: 18px; padding: 6px 14px; background: #2f6; border: 0; border-radius: 6px }</style>
<h1>Basket · ตะกร้า</h1><p id="count">0 items</p><button id="add">Add item</button> <input id="name" placeholder="name">
<script>let n = 0; document.querySelector('#add').onclick = () => { n++; document.querySelector('#count').textContent = n + ' items' };
console.log('basket ready'); console.error('Uncaught TypeError: cannot read properties of undefined (reading map)')</script>`;

const until = async (check, what, ms = 15_000) => {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > ms) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.error(`${pass ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

// The site, on localhost.
const site = createServer((_, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(SITE));
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const siteUrl = `http://localhost:${site.address().port}/`;

// The window's page, served so it has an origin the daemon's Chromium can be told to take.
const bundle = execFileSync(join(root, "node_modules/.bin/esbuild"), ["--bundle", "--format=iife", "--loader=ts"], {
  cwd: root,
  input: `import { BrowserPanel } from "./src/browser-panel/panel";
    import { DaemonClient } from "./src/daemon-client/client";
    import { cssText } from "./src/theme/theme";
    window.start = (cwd) => {
      const style = document.createElement("style");
      style.textContent = cssText("light", "body");
      document.head.append(style);
      let onLine = () => {}, onState = () => {};
      window.__line = (line) => onLine(line);
      window.__state = (s) => onState(s);
      const client = new DaemonClient({ send: (line) => window.__send(line), onLine: (l) => (onLine = l), onState: (l) => (onState = l) });
      window.attached = [];
      window.notified = [];
      const panel = new BrowserPanel(document, client, {
        cwd, mac: false,
        connect: (url) => new WebSocket(url),
        notify: (m) => window.notified.push(m),
        attach: (text, png) => window.attached.push({ text, png: png ? png.length : 0 }),
        devServers: async () => [{ name: "web", command: "bun", args: ["run", "dev"], url: "${siteUrl}" }],
        runDevServer: () => {},
      });
      document.body.append(panel.root);
      window.panel = panel;
      window.__state("connected");
    };`,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const css = readFileSync(join(root, "vscode/contrib/cedian/browser/media/browserPanel.css"), "utf8");
const windowPage = createServer((_, res) =>
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><meta charset="utf-8"><style>html, body { margin: 0; height: 100% } ${css}</style><body><script>${bundle}</script></body>`),
);
await new Promise((r) => windowPage.listen(0, "127.0.0.1", r));
const windowOrigin = `http://127.0.0.1:${windowPage.address().port}`;

// The daemon, with its own state, cedia home and a stand-in cedia.
const tmp = mkdtempSync(join(tmpdir(), "cedian-browser-smoke-"));
const project = join(tmp, "project");
mkdirSync(project);
const env = {
  ...process.env,
  HOME: tmp,
  CEDIAN_STATE_DIR: join(tmp, "state"),
  CEDIA_HOME: join(tmp, "cedia"),
  CEDIAN_NO_LOGIN_ENV: "1",
  CEDIAN_CEDIA_BIN: join(root, "daemon/crates/cedian_daemon/tests/fake/cedia"),
  FAKE_CAPS: '"browser","browser.sites"',
  CEDIAN_BROWSER_ORIGINS: windowOrigin,
  ...(chromiumBin ? { CEDIAN_CHROMIUM: chromiumBin } : {}),
};
const daemon = spawn(daemonBin, [], { env, stdio: ["ignore", "ignore", "pipe"] });
let daemonLog = "";
daemon.stderr.on("data", (d) => (daemonLog += d));
const sock = join(tmp, "state/daemon.sock");
await until(() => existsSync(sock), "the daemon's socket");

const { chromium } = await import("playwright-core").catch(() => import("playwright"));
const browser = await chromium.launch(chromiumBin ? { executablePath: chromiumBin } : {});
const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
page.on("pageerror", (e) => ok("no error in the window", false, e.message));
const daemonSocket = connect(sock);
let rest = "";
await page.exposeFunction("__send", (line) => daemonSocket.write(`${line}\n`));
daemonSocket.on("data", (chunk) => {
  const lines = (rest + chunk).split("\n");
  rest = lines.pop();
  for (const line of lines) if (line) page.evaluate((l) => window.__line?.(l), line).catch(() => {});
});
await page.goto(windowOrigin);
await page.evaluate((cwd) => window.start(cwd), project);

const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
const text = (sel) => page.locator(`.cedian-browser ${sel}`).first().textContent();

try {
  await until(() => page.locator(".cedian-browser .empty .big").count(), "the empty state");
  ok("the block opens on its empty state", (await text(".empty .big")) === "Open a page");
  await shot("1-empty");

  // Address bar → the page, screencast into the block.
  await page.fill(".cedian-browser .url input", siteUrl.replace("http://", ""));
  await page.press(".cedian-browser .url input", "Enter");
  await until(async () => (await page.locator(".cedian-browser .screen").getAttribute("src"))?.startsWith("data:image/jpeg"), "a screencast frame");
  await until(async () => (await text(".tab.on .tt")) === "Basket", "the tab's title");
  ok("the page is screencast into the block and its title is the tab's", true);
  ok("localhost needs no approval", (await text(".banner")).includes("The agent can use this page"));

  // A click on the page's button, through the block.
  const stage = await page.locator(".cedian-browser .stage").boundingBox();
  const button = await until(async () => {
    const r = await page.evaluate(() => window.panel.session?.cdp.call("Runtime.evaluate", { expression: "JSON.stringify(document.querySelector('#add').getBoundingClientRect())", returnByValue: true }));
    return r && JSON.parse(r.result.value);
  }, "the button's place");
  await page.mouse.click(stage.x + button.x + button.width / 2, stage.y + button.y + button.height / 2);
  const read = (js) => page.evaluate((e) => window.panel.session.cdp.call("Runtime.evaluate", { expression: e, returnByValue: true }).then((r) => r.result.value), js);
  await until(async () => (await read("document.querySelector('#count').textContent")) === "1 items", "the click");
  ok("a click in the block clicks the page", true);
  const field = JSON.parse(await read("JSON.stringify(document.querySelector('#name').getBoundingClientRect())"));
  await page.mouse.click(stage.x + field.x + 10, stage.y + field.y + field.height / 2);
  await page.keyboard.type("Pond");
  await until(async () => (await read("document.querySelector('#name').value")) === "Pond", "typing");
  ok("typing in the block types in the page", true);

  // The console.
  await until(async () => (await text(".con .ch")).includes("● 1"), "the console's error count");
  await page.click(".cedian-browser .con .ch");
  ok("the console shows the page's error", (await text(".con .cl")).includes("Uncaught TypeError"));
  await shot("2-page-and-console");

  // The picker: the next click picks the button for the composer instead of pressing it.
  await page.click(".cedian-browser .pick");
  await page.mouse.move(stage.x + button.x + 5, stage.y + button.y + 5);
  await page.mouse.down();
  await page.mouse.up();
  const attached = await until(() => page.evaluate(() => window.attached[0]), "the picked element");
  ok("the picker hands the element to the composer with its picture", attached.text.includes("selector: button#add") && attached.png > 0, attached.text.split("\n")[1]);
  ok("picking did not press the button", (await read("document.querySelector('#count').textContent")) === "1 items");

  // Tabs, through the daemon.
  await page.click(".cedian-browser .tabs .add");
  await until(async () => (await page.locator(".cedian-browser .tab").count()) === 2, "a second tab");
  ok("a new tab opens through the daemon and is the active one", (await page.locator(".cedian-browser .tab.on .tt").textContent()) !== "Basket");

  // A site not on the list: the agent's tools are off there until it is added.
  await page.fill(".cedian-browser .url input", "example.com");
  await page.press(".cedian-browser .url input", "Enter");
  await until(async () => (await text(".banner")).includes("Claude tools are off for this site"), "the tools-off banner");
  ok("a site not on the list says Claude tools are off for this site", true);
  await shot("3-tools-off");
  await page.click(".cedian-browser .banner .btn");
  await until(async () => (await text(".banner")).includes("The agent can use this page"), "the site allowed");
  const settings = JSON.parse(readFileSync(join(tmp, "cedia/settings.json"), "utf8"));
  ok("Allow writes the site to desktop.browser_sites", JSON.stringify(settings.desktop.browser_sites).includes("example.com"), JSON.stringify(settings.desktop.browser_sites));

  // A load that fails says why in the block.
  const closed = createServer();
  await new Promise((r) => closed.listen(0, "127.0.0.1", r));
  const free = closed.address().port;
  await new Promise((r) => closed.close(r));
  await page.fill(".cedian-browser .url input", `localhost:${free}`);
  await page.press(".cedian-browser .url input", "Enter");
  await until(async () => (await page.locator(".cedian-browser .empty .big").count()) && (await text(".empty .big")) === "This page didn't open", "the load error");
  ok("a page that does not load says why, in the block", (await text(".empty .small")).includes("ERR_CONNECTION_REFUSED"));
  await shot("4-load-error");

  // Closing the new tab goes back to the first.
  await page.click(".cedian-browser .tab.on .tx");
  await until(async () => (await page.locator(".cedian-browser .tab").count()) === 1, "the tab closed");
  await until(async () => (await text(".tab.on .tt")) === "Basket", "back on the first tab");
  ok("closing a tab shows the one left", true);

  // Phone width.
  await page.click(".cedian-browser .phone");
  await until(async () => (await read("innerWidth")) === 390, "the phone width");
  ok("the phone switch lays the page out at 390 px", true);
  await shot("5-phone");
  ok("no notification for a page that loaded", (await page.evaluate(() => window.notified)).length === 0, JSON.stringify(await page.evaluate(() => window.notified)));
} catch (e) {
  ok("smoke ran to the end", false, e.message);
  await shot("failed").catch(() => {});
} finally {
  await browser.close();
  daemon.kill();
  daemonSocket.destroy();
  site.close();
  windowPage.close();
  try {
    execFileSync("pkill", ["-f", join(tmp, "state")]);
  } catch {}
}
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(daemonLog.slice(-2000));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: results.length, screenshots: out }));
