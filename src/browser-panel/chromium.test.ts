// The Browser block's page session against a real Chromium, started the way the daemon starts
// it (headless, a DevTools port, its own profile). Skipped where none is installed:
// CEDIAN_CHROMIUM names one, else Playwright's in the cloud container.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Cdp, type Socket } from "./cdp.js";
import { elementContext, PageSession, type Frame, type PickedElement } from "./session.js";

const bin = process.env.CEDIAN_CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const PAGE = `<!doctype html><title>Basket</title>
<style>button.primary { color: rgb(255, 0, 0); font-size: 20px; padding: 4px 10px }</style>
<main><h1>Basket</h1><button class="primary" id="add" onclick="document.querySelector('h1').textContent='Added'">Add</button>
<input id="name"></main>
<script>console.log("ready", 2); console.warn("careful"); setTimeout(() => { throw new Error("boom") }, 0)</script>`;

const until = async (check: () => boolean, ms = 10_000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe.skipIf(!bin)("the page session on a real Chromium", () => {
  let chrome: ChildProcess;
  let server: Server;
  let profile: string;
  let port = 0;
  let site = "";

  beforeAll(async () => {
    profile = mkdtempSync(join(tmpdir(), "cedian-browser-"));
    chrome = spawn(bin!, ["--headless=new", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "--no-sandbox", "about:blank"], { stdio: "ignore" });
    await until(() => existsSync(join(profile, "DevToolsActivePort")), 15_000);
    port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
    server = createServer((_, res) => res.writeHead(200, { "content-type": "text/html" }).end(PAGE));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    site = `http://localhost:${(server.address() as { port: number }).port}/`;
  }, 30_000);

  afterAll(async () => {
    server?.close();
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise((r) => chrome.once("exit", r));
      chrome.kill();
      await exited;
    }
    // Chromium's helpers can still be writing the profile as it exits; a leftover temp folder is harmless.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  });

  const open = async () => {
    const target = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json()) as { webSocketDebuggerUrl: string };
    const session = new PageSession(new Cdp(new WebSocket(target.webSocketDebuggerUrl) as unknown as Socket));
    await session.start(800, 600, 1);
    return session;
  };

  test("screencasts the page, follows its load, title and console, and takes input", async () => {
    const session = await open();
    const frames: Frame[] = [];
    session.onFrame((f) => frames.push(f));
    expect(session.view.load).toBe("idle");
    await session.navigate(site);
    await until(() => session.view.load === "loaded" && session.view.title === "Basket");
    await until(() => frames.length > 0);
    expect(frames[0].width).toBe(800);
    expect(Buffer.from(frames[0].data, "base64").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    await until(() => session.console.length >= 3);
    expect(session.console.map((l) => [l.level, l.text])).toEqual([
      ["log", "ready 2"],
      ["warn", "careful"],
      ["error", expect.stringContaining("Error: boom")],
    ]);
    // A click where the button is, then typing into the field.
    const box = (await (session as any).cdp.call("Runtime.evaluate", { expression: "JSON.stringify(document.querySelector('#add').getBoundingClientRect())", returnByValue: true })).result.value;
    const r = JSON.parse(box);
    const at = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    await session.mouse({ type: "mousePressed", ...at, button: 0, buttons: 1, clickCount: 1 });
    await session.mouse({ type: "mouseReleased", ...at, button: 0, buttons: 0, clickCount: 1 });
    const read = async (js: string) => (await (session as any).cdp.call("Runtime.evaluate", { expression: js, returnByValue: true })).result.value;
    await until(() => true);
    expect(await read("document.querySelector('h1').textContent")).toBe("Added");
    await read("document.querySelector('#name').focus()");
    for (const key of "hi") {
      const e = { key, code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0), altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
      await session.key("keyDown", e);
      await session.key("keyUp", e);
    }
    await session.insertText(" ไทย");
    expect(await read("document.querySelector('#name').value")).toBe("hi ไทย");
    session.dispose();
  }, 30_000);

  test("picks an element with its selector, styles and a picture, instead of clicking it", async () => {
    const session = await open();
    await session.navigate(site);
    await until(() => session.view.load === "loaded");
    const picks: PickedElement[] = [];
    session.onPicked((p) => picks.push(p));
    session.pick();
    expect(session.view.pick).toBe("inspecting");
    const r = JSON.parse((await (session as any).cdp.call("Runtime.evaluate", { expression: "JSON.stringify(document.querySelector('#add').getBoundingClientRect())", returnByValue: true })).result.value);
    const at = { x: r.x + 5, y: r.y + 5 };
    await session.mouse({ type: "mouseMoved", ...at });
    await session.mouse({ type: "mousePressed", ...at, button: 0, buttons: 1 });
    await until(() => picks.length === 1);
    const picked = picks[0];
    expect(picked.selector).toBe("button#add");
    expect(picked.tag).toBe("button");
    expect(picked.text).toBe("Add");
    expect(picked.styles.color).toBe("rgb(255, 0, 0)");
    expect(picked.styles["font-size"]).toBe("20px");
    expect(Buffer.from(picked.image!, "base64").subarray(1, 4).toString()).toBe("PNG");
    expect(session.view.pick).toBe("idle");
    // The click picked; it did not press the button.
    expect((await (session as any).cdp.call("Runtime.evaluate", { expression: "document.querySelector('h1').textContent", returnByValue: true })).result.value).toBe("Basket");
    expect(elementContext(picked)).toContain("selector: button#add");
    session.dispose();
  }, 30_000);

  test("a page that does not load says why, in the block", async () => {
    const session = await open();
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    const free = (closed.address() as { port: number }).port;
    await new Promise((r) => closed.close(r));
    await session.navigate(`http://127.0.0.1:${free}/`);
    await until(() => session.view.load === "error");
    expect(session.view.error).toBe("Nothing answers there (net::ERR_CONNECTION_REFUSED). Is the dev server running?");
    session.dispose();
  }, 30_000);

  test("a closed tab tells the block", async () => {
    const session = await open();
    const closed: boolean[] = [];
    session.onClose((beforeLoad) => closed.push(beforeLoad));
    const { targetInfo } = await (session as any).cdp.call("Target.getTargetInfo");
    await fetch(`http://127.0.0.1:${port}/json/close/${targetInfo.targetId}`);
    await until(() => closed.length === 1);
    expect(closed).toEqual([true]);
  }, 30_000);
});
