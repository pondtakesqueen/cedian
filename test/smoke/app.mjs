// Launches a built VS Code-based app (Cedian.app or stock VS Code) through Playwright's
// Electron driver, in a fresh user-data dir with a throwaway folder open, so every launch is
// a first launch.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";

/** The executable inside a macOS .app bundle, or the path itself when it is one already. */
export function executable(app) {
  if (!app.endsWith(".app")) return app;
  // The bundle names its binary: stock VS Code's is "Code", Cedian's is "Cedian".
  const plist = readFileSync(`${app}/Contents/Info.plist`, "utf8");
  const name = plist.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
  if (!name) throw new Error(`${app}/Contents/Info.plist names no CFBundleExecutable`);
  return `${app}/Contents/MacOS/${name}`;
}

/** `opts.user` and `opts.folder` reopen an earlier launch's user data and folder. */
export async function launch(app, settings = {}, opts = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "cedian-smoke-"));
  const user = opts.user ?? join(scratch, "user");
  const folder = opts.folder ?? join(scratch, "folder");
  mkdirSync(join(user, "User"), { recursive: true });
  if (!opts.folder) {
    mkdirSync(folder);
    writeFileSync(join(folder, "README.md"), "# smoke\n");
  }
  writeFileSync(
    join(user, "User", "settings.json"),
    JSON.stringify({
      "security.workspace.trust.enabled": false,
      "workbench.startupEditor": "none",
      "update.mode": "none",
      "extensions.autoCheckUpdates": false,
      "telemetry.telemetryLevel": "off",
      ...settings,
    }),
  );
  const startedAt = performance.now();
  const electronApp = await electron.launch({
    executablePath: executable(app),
    args: [
      `--user-data-dir=${user}`,
      `--extensions-dir=${join(scratch, "extensions")}`,
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-workspace-trust",
      "--disable-updates",
      "--new-window",
      folder,
    ],
    timeout: 60_000,
  });
  const window = await electronApp.firstWindow({ timeout: 60_000 });
  return { electronApp, window, startedAt, folder, user };
}
