# Vendoring the VS Code fork (Phase A)

Pinned base: **VS Code `1.143.1`** (latest stable, verified 2026-10-26 via
`https://update.code.visualstudio.com/api/releases/stable`).
Spec: `docs/CEDIAN_SPEC.md` §9 (Base, License, Extension system) and §11 items 1–11.
Merge policy: rebase onto VS Code latest stable quarterly; the owner decides
each merge (spec §9).

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
- Non-MIT dependencies without explicit owner approval (CI license scan).
