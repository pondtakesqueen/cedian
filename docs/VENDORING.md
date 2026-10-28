# Vendoring the VS Code fork (Phase A)

Pinned base: **VS Code `1.143.1`** (latest stable, verified 2026-10-26 via
`https://update.code.visualstudio.com/api/releases/stable`).
Spec: `docs/CEDIAN_SPEC.md` §9 (Base, License, Extension system) and §11 items 1–11.
Merge policy: merge upstream rarely, only when needed (e.g. a security fix);
the owner decides each merge (spec §9, 2026-10-28).

## How it is done (Phase A)

The fork is not checked in. `vscode/` holds what Cedian changes, and
`script/vscode/prepare <dir>` makes a source tree from it:

- `vscode/UPSTREAM`: the tag and its commit; prepare refuses any other.
- `vscode/patches/*.patch`, applied in order: `0001` adds Cedian's workbench
  contribution to `workbench.common.main.ts`; `0002` turns AI off
  (`chat.disableAIFeatures` defaults to true, the `copilot` terminal command
  to false, the built-in Copilot extension is not built, and the Copilot
  runtime and `@vscode/copilot-api`, proprietary, are kept out of the app's
  node_modules); `0003` defaults telemetry to off.
- `vscode/product.json`: keys merged over VS Code's (`null` removes one):
  the Cedian names, bundle id `dev.cedian.app`, URL protocol `cedian`, Open
  VSX as the gallery, no voice or agents telemetry endpoints.
- `vscode/contrib/cedian/`: the workbench contribution, copied to
  `src/vs/workbench/contrib/cedian/` with `src/agent-pane` and the generated
  `src/protocol/cedia.ts`. Phase A's Agent view (secondary side bar) draws one
  recorded cedia fixture (`prepare <dir> <fixture>`, default
  `edit-and-check`), folded by `cedian_agent` at the pin.
- The app icon comes from `brand/`.

Then, on the Mac: `script/vscode/build-mac <dir>` (Node per VS Code's
`.nvmrc`) builds `<dir>/../VSCode-darwin-<arch>/Cedian.app`;
`npm run smoke -- <Cedian.app>` launches it with Playwright and checks the
fixture is drawn and no AI chat shows; `npm run budgets -- <app> --out
docs/budgets/<name>.json` records cold start, keystroke and idle memory, run
on stock VS Code 1.143.1 and on Cedian.app; `python3 script/license-scan.py
--app <Cedian.app>` scans every npm package the app ships.

Checked off the Mac: the contribution type-checks with VS Code's own
`src/tsconfig.json` (no new errors against the unpatched tree). Electron's
download hosts are blocked in the cloud sessions, so building and launching
need the Mac.

## Steps

1. Clone `microsoft/vscode` at tag `1.143.1` into a scratch dir (not this repo;
   this repo holds Cedian-specific code plus the daemon).
2. Rename the product to Cedian: `product.json` (`nameShort`, `nameLong`,
   `applicationName`, `dataFolderName` → `Cedian`), app icon from `brand/`,
   macOS bundle id for the app.
3. Strip AI features for a clean slate: Copilot/Cursor-style chat, inline
   completions, and any Microsoft Marketplace hooks (ToS forbids non-Microsoft
   products on the Marketplace; use Open VSX per spec §9).
4. Point the extension gallery at Open VSX; keep VS Code built-ins (git,
   debugger/DAP, LSP client, markdown, JSON). No Cedian-specific extensions.
5. Disable the VS Code settings UI; generate `settings.json` read-only from
   cedia's `desktop` key via `ConfigurationService` (spec §9 Settings mapping).
   The Cedian settings window is the only writer of `~/.cedia/settings.json`.
6. Layer Cedian keybindings on top of VS Code defaults (Cedian wins on
   conflict; see spec §7; full override table finalized in Phase B).
7. Add the Cedian workbench contributions from `src/`: agent pane, composer,
   blocks layout engine (Tern-style, native DOM + CSS), browser panel
   (daemon Chromium screencast), settings window. Daemon IPC over the Unix
   socket `daemon.sock` via the `cedian_wire` protocol — Electron IPC stays
   window-local only.
8. Theme: the Warm & Lime token table in `script/themes/cedian.py` is the color
   source; its writer is Zed-era and refuses to run until Phase B retargets it
   to a VS Code color theme plus `--cedian-*` CSS custom properties.
9. Verify license compliance before ship: MIT notice for VS Code portions in
   `LICENSE`/`NOTICE`, `THIRD_PARTY_NOTICES.md` updated, `python3
   script/license-scan.py` green (§13 License gate), legal review.
10. Manual update check (`Help → Check for updates`) for v1; auto-update
    deferred (spec §11 item 11).

## Do not vendor

- `microsoft/vscode` Marketplace integration, Copilot, or any proprietary
  Microsoft/Cursor code (spec §9 License/IP policy).
- Copyleft or proprietary dependencies (GPL, AGPL, LGPL-only, MPL, FSL/BSL/SSPL); permissive licenses pass the CI license scan (spec §9, 2026-10-28).
