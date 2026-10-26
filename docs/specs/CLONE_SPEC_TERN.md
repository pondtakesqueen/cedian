# CLONE_SPEC — Tern (clean-room reverse engineering)

**Target:** `/Applications/Tern.app` (Mach-O 64-bit arm64, Tern 3.6556.2)
**Method:** REA (strings, otool, bundle inspection). No code/assets copied.
**Scope:** User-visible features, screens, state machines, formats, protocols, settings, errors relevant to a desktop coding-agent workspace. Items not verifiable are marked UNKNOWN.

## 1. Identity & stack (evidence)

- Binary: `tern` (Mach-O arm64). Linked frameworks (otool -L): AppKit, Foundation, WebKit, JavaScriptCore, CoreGraphics, Metal, ScreenCaptureKit, CoreMedia, Security, IOKit, SystemConfiguration, CFNetwork, AVFoundation, UserNotifications, CoreLocation, CoreData, CoreImage, CloudKit, UniformTypeIdentifiers, ServiceManagement, QuartzCore, CoreVideo. No GPUI/iced/egui/tauri/wry strings found → likely a **custom Rust UI framework** or stripped.
- Strings: Rust panic messages ("called `Result::unwrap()` on an `Err` value", "a formatting trait implementation returned an error"), `tracing::span`, `rust-regex-automata`, `gix` (git), `sqzer-rav1d` (AV1 decode), `rust-min-stack`.
- Config dir: `/home/user/.config/tern/` (strings: `environment.json`, `boot.json`, `host-key.json`, `sent.json`, `journal`).
- WebKit + ScreenCaptureKit → native WKWebView + screen capture.

## 2. User-visible features

### 2.1 Blocks / canvas
- **Block**: unit of UI. Types seen in strings: agent block, browser block, canvas block, board block, terminal block, editor block, git block, notebook block, table/view block.
- **Block palette**: "block in the palette", "command lenses, palette commands and key binds". Blocks opened via palette (`⌘K`-style).
- **PiP (picture-in-picture)**: floating browser over the frame; commands: `pip`, `pip float <corner>`, `pip nth`, `pip fling <vx> <vy>`, `pip dx dy` (drag), `pip release [vx vy]`, `pip dir` (dock), `pip stash`/`unstash`/`stash-all`, `pip expand`.
- **Stash**: PiP stashed against a side (left/right/up/down) of frame.
- **Fan**: fans out a deck of PiPs.
- **Dock**: PiP docked into split tree beside owner in a direction.
- **Zoom**: `expand` toggles PiP filling frame.
- **Tear-off**: a block let go outside the window opens in a new window (strings: "A block let go outside the window opens in a new window there").

### 2.2 Browser block
- Native WKWebView (sharp).
- Commands: back, forward, reload, element selection, viewport capture.
- Element selection: highlights hovered element, consumes next click; context = URL, title, CSS selector, tag, bounded text, sanitized markup summary, element bounds. Form values/editable text/scripts/hidden descendants excluded. Labeled untrusted.
- Screenshot: WKWebView visible-viewport snapshot (macOS). PNGs in private cache. UUIDs not arbitrary paths. Up to 4 per turn, 5MB/image, 12MB total. Shared renderer memory budget.
- Ephemeral history/cookies (first version).
- App menus/dialogs hide guest view.
- No bundled engine, proxy, or idle polling.

### 2.3 Sessions / tabs / hosts
- Sessions with tabs; panes move between tabs/sessions.
- Cross-session click: switch to that session/tab or just highlight.
- Remote hosts: attach via SSH/Tailscale, connect/disconnect, setup wizard, RTT measurement, peer join/leave.
- Host identity chain (local/ssh-key/tailscale), service build, version.
- Lock/unlock session.

### 2.4 Board / canvas
- Board pane (path or id), canvas block (no view until opened).
- Notebook (Jupyter-like, `.ipynb`).
- Table/view export (CSV/JSON), column names, quoting, newline.

### 2.5 Agent
- "Hermes: Your agent" (agent name?).
- Agent block opening ("always opens a shell block and an agent block").
- Commands, key binds, CSS, workspaces at launch (plugin system).
- Agent teams: architect + up to 3 workers (strings: "an architect and up to three workers").

### 2.6 PiP interactions (from strings)
- `pip`, `pip float <corner>`, `pip nth`, `pip fling <vx> <vy>`, `pip dx dy`, `pip release [vx vy]`, `pip <dir>`, `pip stash`, `pip unstash`, `pip stash-all`, `pip expand`, `pip fan`, `pip see`.
- Stash against side (left/right/up/down), unstash brings back.
- Fling from rest at velocity.
- Fan out deck.
- See-through (holding key).

### 2.7 Terminal
- Shell blocks, program/prompt fields, running commands, last exit status.
- Terminal questions (filter terminal/agent blocks).
- Tab width, cursor shape, blink, smooth blink, glide, trail.

### 2.8 Cloud / sandbox
- Cloud send (omp panes to cloud).
- Sandbox host key fingerprint, boot.json, sent.json.
- Thin bundle, apply pane capture.
- "The connection to the machine was lost", checkout has no cloud project identity.

### 2.9 Editor
- Monaco-like editor (from strings: tab width, cursor shape, blink, etc. — likely CodeMirror or Monaco).
- Find, replace, go to line, expand/shrink selection, fold/unfold, subword nav.
- Diff view (unified/split).

### 2.10 Other
- Mermaid diagrams (theme colors in strings).
- Export schema/data.
- Plugin system (Lua? `tern plugin install` from git URL or folder, `list`, `reload`, `remove`, `link`, `unlink`, `types` for luau-lsp).
- Workspaces opened at launch.
- CSS customization.
- Status line segments.

## 3. State machines

### 3.1 Block lifecycle
- Opened (in layout) → focused → zoomed/parked → closed.
- PiP: corner → dragged (held) → flung → released → docked/stashed/expanded.
- Browser block: closed before page opened → error.

### 3.2 Session/tab
- Session states: connected, connecting, stalled, reconnecting, error, failed, verify.
- Tab: previous-tab, cross-session-click (switch or highlight).

### 3.3 Host
- Host states: name, connected, connecting, stalled, reconnecting, error, failed, verify (waiting for key trust).

## 4. File formats / persistence

- Config dir: `~/.config/tern/`
- Files: `environment.json`, `boot.json`, `host-key.json`, `sent.json`, `journal`.
- SSH config: `~/.ssh/config`.
- Cloud: `~/cloudapply/...`, thin bundle.
- Session data: UNKNOWN (likely SQLite, like PandaCode).

## 5. Network protocols

- SSH (host attachment), Tailscale.
- HTTP/HTTPS (browser, cloud providers).
- CDP? UNKNOWN (Tern uses WKWebView, not Chromium, so no CDP; agent drives browser via... UNKNOWN).

## 6. Settings / keybinds

- Extensive keybind table (strings list many: cmd+z, cmd+f, cmd+k, cmd+j, etc.).
- Settings: appearance (font, UI font, density), keybinds, workspaces at launch, CSS, plugins.
- Cross-session click behavior setting.

## 7. Error behaviors (from strings)

- "Tern can't find your home folder."
- "This Tern's bundle names no identifier."
- "cannot trash old bundle"
- "the network went away", "the connection timed out"
- "no picker is open", "the pane is already in that tab, or it is on another host"
- "the pane is its tab's only pane, or it is on another host"
- "no previous tab"
- "journal is not UTF-8", "journal ends mid-character"
- "the browser block closed before its page opened"
- "The sandbox's host key fingerprint differs", "The sandbox did not boot"
- "internal error: entered unreachable code"
- "the canvas block has no view"
- "board must be a path or board pane id", "no focused pane for relative board path"
- "agent not found", "pane runs no agent", "agent must be a pane id"
- Screen sharing: "It has no graphical session Tern can capture", "The display went away", "Screen sharing stopped"

## 8. UNKNOWN

- Exact UI framework (custom? iced? egui?). No framework strings found (stripped). ScreenCaptureKit usage purpose (screen sharing vs capture).
- Agent protocol (Hermes? "Your agent"). Whether agent is built-in or external.
- Persistence format (SQLite? files?).
- Browser↔agent sharing (does agent see the same page? likely via separate mechanism).
- Extension/plugin system details (Lua? from `luau-lsp` reference).
- Remote daemon protocol (SSH-based?).
- Cloud sync protocol.

## 9. Evidence summary

- Binary strings (tern, ~large).
- otool -L (WebKit, ScreenCaptureKit, etc.).
- Config dir paths in strings (`~/.config/tern/`).
- Command strings (pip, stash, dock, fan, etc.).
- Error strings (extensive, user-facing).

## 10. Takeaways for cedian

- **PiP (floating native window)** — sharp browser, macOS-only, not shared with agent.
- **Native webview** for browser — sharp, but Tern's UI is web-based (Tauri-like).
- **Block model** with PiP/stash/dock/fan — Tern's movability is PiP + fixed panes, not in-layout drag.
- **ScreenCaptureKit** — screen sharing/capture.
- **Plugin system** — Lua? (`luau-lsp` reference).
- **No bundled engine** — uses OS webview (like PandaCode).
- **Take**: PiP pattern, element selection, stash/dock interactions. Don't take: web-based UI rewrite.

---
