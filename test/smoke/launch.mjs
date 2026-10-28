#!/usr/bin/env node
// Phase B's smoke: Cedian.app opens, its agent pane is the live one, and the window reaches the
// daemon (starting it if none answers, as a launch does) and hears its welcome: the pane's
// connection line goes away and the composer's chips fill from cedia's models and permission
// modes. Exits 1 on any failure.
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
  // VS Code's macOS window title leaves out the app name, so ask Electron for it.
  const title = await electronApp.evaluate(({ app }) => app.getName());
  if (title !== "Cedian") throw new Error(`app is named "${title}", not Cedian`);
  const pane = window.locator(".cedian-agent-pane.live");
  await pane.waitFor({ state: "visible", timeout: 30_000 });
  await pane.locator(".composer textarea").waitFor({ state: "visible" });
  await pane.locator(".conn").waitFor({ state: "hidden", timeout: 30_000 });
  await pane.locator('select[data-chip="permission"]').waitFor({ state: "attached", timeout: 30_000 });
  const modes = await pane.locator('select[data-chip="permission"] option').evaluateAll((os) => os.map((o) => o.value));
  for (const mode of ["read-only", "workspace", "auto", "plan"]) {
    if (!modes.includes(mode)) throw new Error(`permission picker lacks ${mode}: ${modes.join(", ")}`);
  }
  const accent = await window.evaluate(() => getComputedStyle(document.querySelector(".monaco-workbench")).getPropertyValue("--cedian-accent").trim());
  if (!accent) throw new Error("the --cedian-* properties are not on the workbench");
  const chat = await window.locator(".interactive-session, .chat-view-welcome").count();
  if (chat > 0) throw new Error("a built-in AI chat view is showing");
  if (shot) await window.screenshot({ path: shot });
  console.log(`smoke ok: "${title}" reached the daemon; permission modes ${modes.join(", ")}; accent ${accent}`);
} finally {
  await electronApp.close();
}
