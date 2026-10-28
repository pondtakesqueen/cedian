// Launches a built VS Code-based app (Cedian.app or stock VS Code) through Playwright's
// Electron driver, in a fresh user-data dir with a throwaway folder open, so every launch is
// a first launch.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";

/** The executable inside a macOS .app bundle, or the path itself when it is one already. */
export function executable(app) {
  if (!app.endsWith(".app")) return app;
  const name = app.split("/").pop().replace(/\.app$/, "");
  // Stock VS Code's binary is "Electron"; Cedian's and Code - OSS's take the product name.
  return name === "Visual Studio Code" ? `${app}/Contents/MacOS/Electron` : `${app}/Contents/MacOS/${name}`;
}

export async function launch(app, settings = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "cedian-smoke-"));
  const user = join(scratch, "user");
  const folder = join(scratch, "folder");
  mkdirSync(join(user, "User"), { recursive: true });
  mkdirSync(folder);
  writeFileSync(join(folder, "README.md"), "# smoke\n");
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
  return { electronApp, window, startedAt, folder };
}
