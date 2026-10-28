#!/usr/bin/env node
// Phase A's smoke: Cedian.app opens and its agent pane draws the recorded cedia fixture the
// tree was prepared with (script/vscode/prepare). Exits 1 on any failure.
// Usage: node test/smoke/launch.mjs <Cedian.app> [screenshot.png]
import { launch } from "./app.mjs";

const [app, shot] = process.argv.slice(2);
if (!app) {
  console.error("usage: node test/smoke/launch.mjs <Cedian.app> [screenshot.png]");
  process.exit(2);
}
const { electronApp, window } = await launch(app);
try {
  await window.waitForSelector(".monaco-workbench", { timeout: 60_000 });
  const title = await window.title();
  if (!title.includes("Cedian")) throw new Error(`window title "${title}" does not name Cedian`);
  const pane = window.locator(".cedian-agent-pane");
  await pane.waitFor({ state: "visible", timeout: 30_000 });
  const fixture = await pane.getAttribute("data-fixture");
  const receipt = (await pane.locator(".receipt").first().textContent()) ?? "";
  const user = (await pane.locator(".ubub").first().textContent()) ?? "";
  if (!fixture) throw new Error("agent pane has no fixture");
  if (!user.trim()) throw new Error("agent pane drew no user message");
  if (!receipt.includes("verified")) throw new Error(`receipt reads "${receipt}"`);
  const chat = await window.locator(".interactive-session, .chat-view-welcome").count();
  if (chat > 0) throw new Error("a built-in AI chat view is showing");
  if (shot) await window.screenshot({ path: shot });
  console.log(`smoke ok: "${title}" drew fixture ${fixture}; receipt "${receipt.trim()}"`);
} finally {
  await electronApp.close();
}
