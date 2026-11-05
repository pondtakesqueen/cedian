#!/usr/bin/env node
// Builds remote control's web page (spec §6.5) from the same sources as the desktop's agent
// pane: tsc emits src/remote/main.ts and what it imports as ES modules, beside the pane's CSS
// and the page. The daemon serves the folder (CEDIAN_REMOTE_WEB, or `remote-web` beside its
// binary, where script/bundle-mac puts it).
// Usage: node script/remote-web.mjs [<out dir>]   (default: out/remote-web)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? join(root, "out/remote-web"));
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "css"), { recursive: true });
const config = join(out, "tsconfig.remote.json");
writeFileSync(
  config,
  JSON.stringify({
    extends: join(root, "tsconfig.json"),
    compilerOptions: { noEmit: false, outDir: join(out, "js"), rootDir: join(root, "src"), sourceMap: false },
    include: [],
    files: [join(root, "src/remote/main.ts")],
  }),
);
execFileSync(join(root, "node_modules/.bin/tsc"), ["-p", config], { stdio: "inherit" });
rmSync(config);
const media = join(root, "vscode/contrib/cedian/browser/media");
for (const css of ["agentPane.css", "threadList.css"]) copyFileSync(join(media, css), join(out, "css", css));
copyFileSync(join(root, "src/remote/web/remote.css"), join(out, "css/remote.css"));
for (const file of ["index.html", "sw.js", "manifest.webmanifest"]) copyFileSync(join(root, "src/remote/web", file), join(out, file));
copyFileSync(join(root, "brand/app-icon/macos-1024.png"), join(out, "icon.png"));
console.log(`remote web build in ${out}`);
