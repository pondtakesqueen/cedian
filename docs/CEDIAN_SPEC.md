# CEDIAN — Detailed Specification (VS Code fork + cedia agent)

**Version:** 0.1 (draft)
**Date:** 2026-10-26
**Base:** VS Code (latest stable, MIT license) fork
**Agent:** cedia (unchanged, multi-provider)
**Product name:** Cedian
**License:** Proprietary (Cedian-specific) + MIT notice for VS Code portions (see §9)

## 1. Vision

Cedian is an **agentic IDE** built on a VS Code fork, with cedia as the AI agent. It combines:
- VS Code's full IDE (editor, terminal, debugger, git, LSP, extensions, settings)
- cedia's agent (multi-provider, multi-model, tools, permissions, sandbox)
- Tern's block-based UI (CSS drag/zoom/park/PiP)
- Claude Desktop's browser pane (Chromium, CDP, element selection, safety)
- Multi-repo workspace (coordinator, threads, shared memory)

**Not competing with Cursor** — built for owner's own use, with complete tools.

**Single-owner, local-first**: no multi-user/team features, cloud sessions, cloud environments, GitHub App, connectors (cloud), or mobile app. MCP and connectors are configured locally via cedia. (See §12 for full gap list.)

## 2. Architecture

```
┌─────────────────────────────────────────────────────┐
│  VS Code fork (Electron + TypeScript)               │
│  ┌─────────────────────────────────────────────┐    │
│  │  VS Code core (editor, terminal, debugger,   │    │
│  │  git, search, settings, keybindings,         │    │
│  │  extensions, browser webview, LSP)           │    │
│  └─────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────┐    │
│  │  Cedian agent integration (NEW)              │    │
│  │  - Chat panel (agent conversation)           │    │
│  │  - Composer (prompt box + attachments)       │    │
│  │  - Agent mode (multi-file edits)             │    │
│  │  - Rules (AGENTS.md / .cedian/rules)         │    │
│  │  - @mentions, MCP integration               │    │
│  │  - Multi-repo workspace (roots, coordinator) │    │
│  └─────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────┐    │
│  │  Cedian daemon (Rust, separate process)      │    │
│  │  - worktree, git, browser (Chromium),        │    │
│  │  - settings, snapshots, indexing,            │    │
│  │  - Roots UI, multi-repo workspace            │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
         │ Unix socket / Electron IPC
         ▼
┌─────────────────────────────────────────────┐
│  cedia (agent, unchanged)                   │
│  - multi-provider, multi-model               │
│  - tools, permissions, sandbox              │
│  - threads, memory, schedules               │
└─────────────────────────────────────────────┘
```

### Principles (from ARCHITECTURE.md, adapted)

1. **Daemon owns all state** — window is viewer, holds nothing daemon can't rebuild
2. **cedia is the only agent** — no agent loop in Cedian
3. **`~/.cedia/settings.json`** is the only settings file — Cedian reads/writes `desktop` key
4. **cedia's thread/session files are append-only** — Cedian only reads and indexes
5. **One crate per area** (Rust) — daemon stays Rust, UI is TypeScript
6. **No `unwrap()` outside tests** — propagate errors with `?` or log
7. **A decision that changes ARCHITECTURE.md updates it in the same change**

### What changes from original architecture

- **UI framework**: GPUI → Electron (VS Code fork)
- **Blocks**: native GPUI → Tern-style blocks (drag/zoom/park/PiP) via VS Code workbench fork (TS/CSS, native DOM)
- **Editor**: Zed's editor → VS Code's Monaco (built-in)
- **Terminal**: Zed's terminal → VS Code's xterm.js (built-in)
- **Browser**: screencast → daemon-owned Chromium (bundled), screencast into VS Code panel (not VS Code integrated browser)
- **Thai text**: ICU4X → browser native (Chromium ICU line breaking + CSS font fallback; no ICU4X/Intl.Segmenter needed)
- **Theme**: Zed tokens → VS Code theme + Cedian tokens
- **Cross-platform**: macOS only → macOS only for v1 (Windows/Linux later)

### What stays the same

- **Daemon** (Rust) — unchanged, owns all state
- **cedia** (agent) — unchanged, multi-provider
- **Protocol** — cedia's schema is source of truth
- **Settings** — `~/.cedia/settings.json`, `desktop` key
- **Multi-repo workspace** — roots, coordinator, threads
- **Block concept** — CSS-based instead of GPUI

## 3. Features (from Claude Desktop, Cursor, Tern)

### 3.1 From Claude Desktop Code tab

| Feature | Cedian implementation |
|---------|----------------------|
| Chat panel (agent conversation) | VS Code sidebar panel, cedia drives |
| Composer (prompt box + attachments) | VS Code input box, image/file attach |
| Permission modes (Manual/Accept edits/Plan/Auto/Bypass) | cedia's permission modes (auto/read-only/plan/workspace) |
| Diff view (file-by-file review) | VS Code diff editor + cedia's shadow git diffs |
| PR monitoring (Auto-fix, Merge when ready) | Daemon + gh CLI |
| Browser pane (tabbed, element selection, safety) | daemon Chromium (bundled) screencast into panel + CDP (agent drives) |
| Terminal (integrated, xterm.js) | VS Code terminal |
| File editor (open/edit/save) | VS Code editor (Monaco) |
| View modes (Normal/Thinking/Verbose) | Agent pane view modes |
| Side chat (`Cmd+;` / `/btw`) | Side chat panel |
| Keyboard shortcuts | VS Code keybindings + Cedian additions |
| Context usage ring | Agent header context meter |
| Notifications (OS + badges) | VS Code notifications + badge counts |
| Computer use | macOS Accessibility (future) |
| SSH/WSL sessions | Future (protocol ready) |
| Auto-archive after PR merge | Daemon (cedia threads archive) |
| Suggested tasks | Agent pane (coordinator cards) |

### 3.2 From Cursor

| Feature | Cedian implementation |
|---------|----------------------|
| Chat panel + Composer | VS Code sidebar panel |
| Agent mode (multi-file edits) | cedia agent mode |
| Inline edit (Cmd+K) | VS Code inline edit + cedia |
| Rules (.cursorrules → AGENTS.md) | cedia project instructions |
| @mentions (files, folders, tasks) | Composer @-mention |
| MCP servers | Settings (cedia mcp) |
| Background agents | Daemon (thread runs) |
| Code review (/code-review) | Daemon (cedia commit/pr) |
| Diff view (unified/split) | VS Code diff editor |
| Branch switching | Daemon (git commands) |
| Worktree (per task) | Daemon (worktree create) |
| Split view (side by side) | VS Code split editor |
| Command palette (Cmd+K/Cmd+P) | VS Code command palette + Cedian blocks |
| Find in thread (Cmd+F) | VS Code find |

### 3.3 From Tern

| Feature | Cedian implementation |
|---------|----------------------|
| Blocks (drag/zoom/park/tear-off) | CSS blocks (Tern-style) |
| PiP (floating window) | CSS PiP (floating) |
| Stash (dock to side) | CSS stash |
| Fan (deck of PiPs) | CSS fan |
| Tear-off (new window) | Electron BrowserWindow |
| Debugger (DAP) | VS Code debugger (DAP) |
| Native webview (sharp browser) | daemon Chromium (bundled) screencast into panel |
| Grab Element (agent context) | CDP DOM.inspect |
| Worktree-first | Daemon (worktree per thread) |
| No flicker (resize) | Chromium native (no screencast) |
| Open files on restart | VS Code (restores tabs) |
| Themes (Ghostty/Warp) | VS Code themes + Cedian tokens |
| Markdown (Mermaid, PDF export) | VS Code markdown preview |
| Viewers (images, PDF, CSV, notebooks) | VS Code viewers |
| Terminal (find, prompt marks, links) | VS Code terminal |
| Keybindings (every shortcut by id) | VS Code keybindings + Cedian |
| Settings search (Cmd+F) | VS Code settings search |
| File tree drag-to-move | VS Code file explorer |
| Native menu bar | Electron (native menus) |

### 3.4 From PandaCode

| Feature | Cedian implementation |
|---------|----------------------|
| Native child webview (sharp) | daemon Chromium (bundled) screencast into panel |
| Element selection + viewport capture | CDP DOM.inspect + captureScreenshot |
| Resource limits (no polling, lazy load) | VS Code (lazy loading) |
| No transitions (everything at once) | VS Code (instant render) |
| Ephemeral browser history | daemon Chromium (ephemeral profile) |
| App menus hide guest view | VS Code (native) |

### 3.5 From Claude Projects (claude.ai/code)

| Feature | Cedian implementation |
|---------|----------------------|
| Project conversation (coordinator) | Project chat block (⌘0) + coordinator profile (cedia) |
| Threads (workers) | cedia threads, one per worktree/root |
| Overview (track threads by state) | Sidebar groups (working / need attention / done / pinned) + Background tasks pane |
| Standing context (memory, instructions, repos/files) | Memory block (read; write via cedia memory add), AGENTS.md instructions, roots |
| Routing rules (coordinator decides thread vs in-place) | cedia coordinator (open_thread); cedian renders cards |
| Shared context to new threads (repos, CLAUDE.md, connectors, env) | cedia (roots as read-only roots, AGENTS.md) |
| Models/effort separate (coordinator vs threads) | desktop key (G2); defaults Opus/high threads, lower coordinator |
| Multi-repo ("one goal across many repos") | roots[] per project slug; one thread per root/worktree |
| Thread lifecycle (queued→working→done/failed/stopped/asking/interrupted) | cedia thread states (§4.1) |
| Auto-archive (done + verified + no hunks) | daemon (cedia threads archive) + sidebar count |
| Questions (asking state) | ถามคุณ badge + question card in project chat |
| Scheduled tasks | daemon scheduled runs (cedia schedules) |
| Pull requests tracking | PR monitoring (daemon + gh CLI) |
| Library (knowledge/memory) | Memory block |

**Not replicated** (Claude Projects cloud features): cloud sessions (run while laptop closed), GitHub App, cloud environments, connectors (cloud), multi-user sharing, mobile app. (See §12 Exclude.)

## 4. State machines

### 4.1 Thread states (from cedia, unchanged)

```
queued → working → (done | failed | stopped | asking | interrupted)
```
- `asking`: run ended on a question; answer is next prompt
- Auto-archive: done + verified + no hunks → archived

### 4.2 Session states (from Claude Desktop)

```
starting → running → (completed | failed | cancelled)
```
- Remote Control: connected/disconnected
- SSH/WSL: connecting/connected/disconnected

### 4.3 Browser states

```
idle → loading → loaded → (error)
```
- Element selection: idle → inspecting → selected → attached
- Capture: idle → capturing → marked → attached

### 4.4 Block states (Tern-style)

```
closed → open → focused → (zoomed | parked | torn-off) → closed
```
- PiP: corner → dragged → flung → released → docked/stashed/expanded

## 5. File formats / persistence

### 5.1 Settings

- `~/.cedia/settings.json` — single source of truth (cedia owns schema)
- `desktop` key — Cedian's keys (theme, font, keymap, layout, roots, etc.)
- VS Code settings: `settings.json` in VS Code userData (Cedian maps to cedia's desktop key)

### 5.2 Thread/session files (cedia, unchanged)

- `~/.cedia/projects/<slug>/threads/*.jsonl` — append-only
- `~/.cedia/sessions/<slug>/*.jsonl` — append-only
- `~/.cedia/snapshots/<worktree slug>/` — shadow git
- `~/.cedia/projects/<slug>/memory.jsonl` — append-only
- `~/.cedia/projects/<slug>/schedules.jsonl` — append-only

### 5.3 VS Code state

- `~/Library/Application Support/Cedian/` (macOS) — VS Code state db, settings, keybindings, extensions
- `~/.cedian/` — Cedian-specific (worktrees, etc.)

### 5.4 Desktop key (Cedian's)

```json
{
  "desktop": {
    "theme": "dark",
    "font": { "ui": "SF Pro", "code": "Lilex" },
    "ui_font_size": 14,
    "code_font_size": 13,
    "density": "comfortable",
    "view_mode": "answers",
    "notifications": { "sound": true },
    "keymap": {},
    "layout": { /* per project */ },
    "layout_style": "tiles",
    "roots": { /* per project slug: string[] */ },
    "browser": { "keep_cookies": false },
    "editor": { "auto_save": true }
  }
}
```

## 6. Network protocols

### 6.1 cedia protocol (unchanged)

- `cedia -p <text> --thread <id> --output-format stream-json`
- `cedia threads send <id> <text>`
- `cedia threads archive|rename|delete`
- `cedia mcp list|add|remove|check`
- `cedia usage --json --since <range>`
- `cedia schedules due|fire|pause|resume`
- `cedia commit --thread <id> --json`
- `cedia pr --thread <id>`

### 6.2 Daemon IPC (Electron ↔ daemon)

- Unix socket: `daemon.sock` in Cedian's state dir (primary transport; daemon outlives window)
- Request/Notice protocol (cedian_wire) — structured agent events (user/text/thinking/tool_call/tool_result/receipt/session) sent from daemon to window
- Electron IPC: window-local only (renderer↔main); not used for daemon communication
- Tauri: not used

### 6.3 Browser (Chromium/CDP)

- daemon Chromium (bundled) screencast into panel for browser pane
- CDP for agent-driven browser (read/click/type/navigate)
- Element selection via CDP DOM.inspect
- Screenshot via Page.captureScreenshot
- External sites with safety classifiers (Claude Desktop pattern)

### 6.4 Remote (future)

- SSH sessions (Claude Desktop pattern)
- WSL (Windows)
- Remote Control (phone → desktop)

## 7. Settings / keymap

### 7.1 Settings window (VS Code settings UI)

- Appearance: theme, fonts, sizes, density, view mode, sound
- Bots, Models, MCP (cedia's keys, edited through schema)
- Roots: per-project root paths (validate git repo, dedup)
- Browser: keep cookies, external sites allowlist
- Editor: auto-save, format on save
- Keybindings: VS Code keybindings + Cedian additions
- Extensions: VS Code built-ins ship (git, debugger, LSP client, markdown, JSON, etc.); third-party via Open VSX. No Cedian-specific extensions.
- About: dialog (Help → About) showing Cedian version, cedia rev/protocol hash, license, credits. (Version info from `cedia --version --json`.)

### 7.2 Keybindings (from Claude Desktop / VS Code)

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New session |
| `Cmd+W` | Close session |
| `Ctrl+Tab` | Next/previous session |
| `Cmd+Shift+D` | Toggle diff pane |
| `Cmd+Shift+B` | Toggle Browser pane |
| `Cmd+Shift+S` | Select element in Browser |
| `Ctrl+`` ` | Toggle terminal |
| `Cmd+\` | Close focused pane |
| `Cmd+;` | Side chat |
| `Ctrl+O` | Cycle view modes |
| `Cmd+Shift+M` | Permission mode menu |
| `Cmd+Shift+I` | Model menu |
| `Cmd+Shift+E` | Effort menu |
| `Cmd+K` | Command palette |
| `Cmd+P` | Quick open file |
| `Cmd+F` | Find in thread |
| `Cmd+,` | Settings |
| `Cmd+.` | Stop |

**Conflict reconciliation (VS Code defaults vs Cedian):** Cedian wins on conflict (§9). VS Code shortcuts that Cedian overrides: `Cmd+K` (command palette, VS Code uses as chord prefix), `Cmd+W` (close block vs close editor — Cedian closes focused block), `Cmd+Shift+E` (VS Code explorer focus → Cedian effort menu; explorer via sidebar). VS Code shortcuts preserved where no conflict: `Cmd+P` (quick open), `Cmd+Shift+P` (command palette variants), `Cmd+F` (find). Full override table to be finalized during Phase B (keybindings.json generation).

## 8. Error behaviors

### 8.1 From Tern
- "Tern can't find your home folder."
- "This Tern's bundle names no identifier."
- "the network went away", "the connection timed out"
- "no picker is open", "the pane is already in that tab"
- "the browser block closed before its page opened"
- "journal is not UTF-8", "journal ends mid-character"

### 8.2 From Claude Desktop
- "Couldn't show the setup proposal" (version mismatch)
- "Claude hasn't responded" (restart Claude)
- Usage limit errors, credits required
- Lost contact with folder (Remote Control)
- Repository access errors (GitHub App)

### 8.3 Cedian-specific
- "cedia speaks protocol X, cedian was built on Y" (protocol mismatch)
- "this cedia does not manage MCP servers yet"
- "no thread X in this project"
- "not a git repository" (roots validation)
- "มี thread ใช้ root นี้อยู่" (root in use)

### 8.4 Display levels (VS Code fork)
- **Blocking / needs action** (protocol mismatch, not a git repo, root in use, version mismatch) → modal dialog (VS Code window.showErrorMessage, modal)
- **Transient** (network timeout, browser closed before page opened, lost contact) → VS Code notification (non-modal, auto-dismiss)
- **Inline** (stale hunk, agent error, unverified) → inline in block/agent pane
- Thai messages (§8.3) retained as-is

### 8.5 Crash recovery (daemon)
- Daemon outlives window; quitting window never stops a thread.
- On daemon restart: reconcile live runs via `runs.json` (pid, thread, cwd, pre-run sessions); follow surviving cedia processes by tailing session logs; mark threads whose run is gone as `interrupted`.
- Window reconnects to daemon on launch; starts daemon if none answers.
- Worktrees and shadow git persist on disk; review state rebuilds from cedia files.

## 9. Decisions (grilled 2026-10-26, rounds 1–5)

### Strategic
- **Pivot**: Fresh start on VS Code fork (Electron + TypeScript); reuse daemon + cedian_protocol + cedian_index + cedian_wire where possible; UI (GPUI) rewritten in TS. ARCHITECTURE.md (GPUI native) superseded.
- **Platform**: macOS only for v1 (Windows/Linux later); daemon uses macOS-specific APIs (caffeinate, launchd, Keychain, APFS clonefile).
- **Base**: VS Code latest stable (MIT). Pin latest stable; merge VS Code updates quarterly; owner decides merge.
- **License**: Proprietary (Cursor-style) for Cedian-specific additions; VS Code portions retain MIT notice (LICENSE/NOTICE). Legal review before ship.
- **Extension system**: VS Code built-ins + Open VSX (not Microsoft Marketplace, ToS forbids non-Microsoft products). No Cedian-specific extensions.

### Agent / browser / tools
- **Agent integration**: Full Cursor-style (chat panel, composer, agent mode, rules, @mentions, MCP).
- **Models/effort**: coordinator (project chat) and threads may use different model+effort (Claude Projects pattern); defaults Opus/high for threads, lower for coordinator. Set per-project in desktop key.
- **Agent is the only agent**: cedia owns MCP; VS Code MCP client disabled (avoids duplicate tool surfaces; cedia permission/sandbox covers MCP tools).
- **Browser**: in-app Chromium (daemon-owned, bundled chrome-headless-shell) + CDP; screencast into VS Code panel. Not VS Code integrated browser. One browser per workspace, shared by person + agent. cedia owns site policy; Cedian adds per-project allowlist (desktop.browser).
- **Debugger**: Full DAP (VS Code-level).
- **Computer use**: later (macOS Accessibility, research preview).
- **Remote access**: later (protocol ready, client later).
- **SSH/WSL**: later.

### UI / blocks
- **Blocks**: Tern-style (drag/zoom/park/PiP/named layouts) implemented by forking VS Code workbench layout engine in TS; native DOM + CSS (no React). Full parity in v1 (accept timeline risk). Tern-level polish achievable via CSS transforms + rAF.
- **Block rendering tech**: native DOM + CSS (no React) — smaller bundle, full control.
- **State ownership**: daemon owns cedia state (threads, worktrees, browser, roots, block layouts, project tabs); VS Code owns editor buffers/tabs, terminal sessions, git UI, keybindings, extensions. VS Code settings UI disabled; Cedian settings window writes ~/.cedia/settings.json (desktop key); VS Code settings.json is generated read-only.
- **Settings mapping**: inject VS Code-required settings (font, size, theme) from cedia desktop key via ConfigurationService.
- **Theme**: VS Code color theme (JSON) generated from Warm & Lime tokens + CSS custom properties (--cedian-*) for block UI.
- **Multi-repo workspace UI**: roots section in settings (draft ready).
- **Keyboard shortcuts**: layer Cedian on top of VS Code defaults; Cedian wins on conflict; user overrides via desktop.keymap.
- **Side chat (Cmd+;)**: floating agent block (PiP) using cedia fork; discarded on close.
- **View modes**: chip in agent block header (answers / +thinking / all tools); default from desktop.view_mode.
- **Thai text**: browser native (Chromium ICU line breaking + CSS font fallback); no ICU4X/Intl.Segmenter needed.

### Protocol / infra
- **IPC**: Unix socket (daemon.sock) primary; structured agent events from daemon to window; Electron IPC window-local only; Tauri not used.
- **Agent stream parsing**: daemon (Rust, cedian_agent) folds stream-json → structured events; window renders. Matches Claude Desktop split (main/daemon manages agent, renderer renders).
- **Update mechanism**: v1 no separate auto-update; app update via VS Code updater (signed/notarized); daemon + cedia bundled in app bundle. Auto-update daemon deferred.
- **Performance budgets**: keep GPUI-era budgets as gates, Electron-adjusted (cold start ≤500ms, keystroke ≤50ms, idle ≤300MB, scroll 10k blocks @60fps). Measured with HID events + pixel polling.
- **Migration**: none (owner-only); settings compatible by construction (~/.cedia/settings.json, desktop key).

### Accessibility / errors / roadmap
- **Accessibility**: VS Code baseline + Cedian-specific (VoiceOver labels for blocks, Thai line-height ≥1.6, focus ring 2px accent, Reduce Motion stops animation).
- **Error behaviors**: 3 levels — blocking → modal dialog; transient → VS Code notification; inline → block/agent pane. Thai messages retained (§8.3).
- **Browser safety**: cedia owns site policy + Cedian per-project allowlist; no separate classifier.
- **Roadmap**: use ARCHITECTURE.md phases (0-D) as canonical with exit gates; map CEDIAN_SPEC phases onto them.
- **CI/testing**: 3 layers — Rust cargo test (replay fixtures, layout fit), TS vitest (block logic, settings), Playwright E2E smoke. No model calls in CI.
- **Telemetry**: all disabled; crash logs local (~/Library/Logs/Cedian).
- **Name**: Cedian
- **License**: proprietary (see License above)

## 10. Evidence sources

- `/Applications/Tern.app` (strings, otool) → `docs/specs/CLONE_SPEC_TERN.md`
- `/Applications/Claude.app` (asar) → `docs/specs/CLONE_SPEC_CLAUDE.md`
- `/Applications/Cursor.app` (bundle) → `docs/specs/CLONE_SPEC_CURSOR.md`
- `https://code.claude.com/docs/en/claude-projects` → `docs/specs/PROJECTS_SPEC.md`
- `https://code.claude.com/docs/en/desktop-changelog` → REA findings
- `https://support.claude.com/en/articles/9517075-what-are-projects` → REA findings
- `https://cursor.com/docs/release-notes` → REA findings
- `https://tern.build/changelog` → REA findings
- PandaCode docs (browser.md) → REA findings
- Synara README → REA findings

---

## 11. Next steps (grill + implement)

Roadmap is canonical in `docs/ARCHITECTURE.md` (phases 0–D with exit gates). CEDIAN_SPEC phases map onto them:

- **Phase 1 (VS Code fork scaffold)** → Architecture Phase A (spike: GPUI window + Zed editor/terminal → VS Code fork scaffold; compiled cedia on Mac)
- **Phase 2 (Core UI) + Phase 3 (Tools)** → Architecture Phase B (one live thread: daemon, runs, review, settings, receipt)
- **Phase 4 (Blocks/layouts)** → Architecture Phase C (parallel: many threads, blocks full parity, browser, project chat) — includes PiP, tear-off, overview, named layouts
- **Phase 5 (Polish) + Phase 6 (Complete tools)** → Architecture Phase D (media, depth: LSP, git pane, surface protocol, pop-out panes)

Cedian-specific additions to the roadmap:
1. Fork VS Code latest stable; rename to "Cedian"; strip Copilot/Cursor AI features (clean slate)
2. Integrate cedia agent (chat panel, composer, agent mode, rules, @mentions) via daemon structured events
3. Daemon IPC over Unix socket; reuse cedian_daemon + cedian_protocol + cedian_index + cedian_wire
4. Rewrite UI in TS on VS Code fork: blocks (full Tern parity), settings window, browser panel (daemon Chromium screencast)
5. Open VSX configured; VS Code settings UI disabled; Cedian settings window writes ~/.cedia/settings.json
6. Theme (Warm & Lime) via VS Code color theme + CSS vars; Thai text via Chromium native
7. Roots UI (settings) per docs/specs/ROOTS_SETTINGS_DRAFT.md
8. Multi-repo workspace per docs/specs/PROJECTS_SPEC.md
9. CI: Rust cargo test + TS vitest + Playwright E2E; performance budgets as gates
10. License compliance (MIT notice for VS Code portions) before ship
11. Manual update check (Help → Check for updates) for v1 (auto-update deferred)

---

## 12. Gap analysis vs Claude Desktop / Cursor / Tern (2026-10-26)

Reviewed against `docs/specs/CLONE_SPEC_CLAUDE.md`, `CLONE_SPEC_CURSOR.md`, `CLONE_SPEC_TERN.md`, and `docs/specs/PROJECTS_SPEC.md`. Dispositions: **Include** (add to spec), **Defer** (phase later), **Exclude** (intentionally not replicated).

### Parity summary (at a glance)

| Area | Claude Desktop | Cursor | Cedian | Notes |
|------|----------------|--------|--------|-------|
| Editor (Monaco/LSP/debug/git) | via web (Code tab) | full VS Code | VS Code fork | ✅ parity |
| Terminal | integrated | xterm.js | xterm.js | ✅ |
| Chat panel | yes | yes | yes | ✅ |
| Composer (prompt+attachments) | yes | yes | yes | ✅ |
| Agent mode (multi-file) | yes (cloud) | yes | cedia agent mode | ✅ |
| Inline edit (Cmd+K) | ? | yes | VS Code inline edit + cedia | ✅ |
| Rules | CLAUDE.md | .cursorrules | AGENTS.md | ✅ |
| @mentions | yes | yes | composer @-mention | ✅ |
| MCP | cloud connectors | yes | cedia mcp (local) | ⚠️ local only (by design) |
| Background agents | cloud | cloud | local background tasks | ⚠️ local only (by design) |
| Tab completion | no | yes (proprietary) | deferred (G4) | ⚠️ gap (deferred) |
| Browser (in-app Chromium) | yes (+ Claude in Chrome) | ? | daemon Chromium + CDP | ✅ (shared page) |
| Element selection | yes | ? | CDP DOM.inspect | ✅ |
| Diff view | yes | unified/split | VS Code diff + shadow git | ✅ |
| PR monitoring | yes | yes | daemon + gh CLI | ✅ |
| Multi-repo / projects | yes (cloud) | single repo | roots + coordinator | ✅ (local) |
| Blocks / canvas | no | no | Tern-style (unique) | ✅ unique |
| PiP / tear-off | no | no | yes (unique) | ✅ unique |
| Named layouts | no | workspace layouts | yes (unique) | ✅ unique |
| Theme (Warm & Lime) | Claude theme | VS Code themes | Warm & Lime | ✅ unique |
| Thai text | ? | ? | Chromium native | ✅ |
| Performance budgets | not published | not published | explicit gates | ✅ better |
| Accessibility | baseline | baseline | baseline + Cedian | ✅ better |
| Testing/CI | unknown | unknown | 3 layers explicit | ✅ better |
| Telemetry | yes (Anthropic) | yes (Cursor) | disabled | ✅ (privacy) |
| Auto-update | yes | yes | deferred v1 | ⚠️ gap |
| Remote Control (phone) | yes | no | later | ⚠️ deferred |
| Computer use | yes | no | later | ⚠️ deferred |
| Artifacts (rendered inline) | yes | no | deferred (G3) | ⚠️ gap |
| Quick window / launcher | yes | command palette | ⌘K palette | ⚠️ partial |
| Buddy window | yes | no | excluded | ⚠️ excluded |
| Cowork / team | yes | no | excluded | ⚠️ by design |
| Cloud sessions | yes | yes (cloud) | excluded (deferred) | ⚠️ deferred |
| Inline completion | no | yes | deferred (G4) | ⚠️ gap |
| Bug finder | no | yes | deferred (G11) | ⚠️ deferred |
| Settings model | app config | VS Code settings | cedia desktop key | ✅ (single source) |
| Keybindings | VS Code | VS Code | layer on top | ✅ |
| Extension system | N/A (web) | VS Code marketplace | Open VSX + builtins | ✅ (compliant) |
| Debugger (DAP) | ? | yes | full DAP | ✅ |
| Git | ? | yes | daemon git | ✅ |
| Viewers (images/PDF/CSV/notebooks) | yes | yes | VS Code viewers | ✅ |

### Include (added/clarified)
- **G1. Single-owner, local-first scope** — stated explicitly in §1 Vision (no multi-user/team/cloud/mobile). Already intended; now explicit.
- **G2. Model/effort separate for coordinator vs threads** — added to §9 (Claude Projects pattern).
- **G3. Artifacts (rendered code/docs inline in chat)** — add "Artifacts" rendering in agent pane (markdown/code inline) as part of Phase B/C. Medium scope; cedia may emit artifact events.

### Defer (phase later)
- **G4. Inline AI completion / tab completion (ghost text)** (Cursor) — defer to Phase D or later; requires model routing; cedia may expose completion. Not blocking "complete tools".
- **G5. Quick window / global launcher** (Claude) — ⌘K palette covers v1; global hotkey launcher deferred.
- **G6. Project overview surface** (Claude Projects: Landing/Idle/Resolved + Library/PRs/Scheduled) — sidebar + background tasks cover most; add "Landing" badge for PR-in-flight later.
- **G7. Lock/unlock thread** (Tern) — defer.
- **G8. Screen capture for agent (desktop, not just browser page)** (Tern/PandaCode) — covered by computer use (later).
- **G9. Canvas/board block** (Tern) — freeform notes block; defer to Phase C/D.
- **G10. Custom CSS / theming beyond tokens** (Tern) — defer.
- **G11. Bug finder** (Cursor) — covered by code review (/code-review) + PR review; defer dedicated tool.
- **G12. Artifacts rendering details** — UNKNOWN in clone spec; revisit when cedia emits artifacts.
- **G13. Cloud execution** (cloud sessions while laptop closed, cloud environments, background agents cloud, GitHub App) — defer to post-v1 "remote execution" phase; local-first for v1 (daemon keep-awake covers local).
- **G14. Cloud connectors** (claude.ai connectors) — defer; local MCP (cedia mcp) covers v1.

### Exclude (intentionally not replicated)
- Cowork / team collaboration, Claude Tag (Slack), multi-user sharing, trusted devices — owner-only is a core principle (AGENTS.md).
- Mobile app — desktop product; mobile would be a separate client talking to daemon (Remote Control pattern), not part of cedian.
- Tab completion internals (Cursor proprietary) — cannot replicate; model-based completion deferred (G4).
- Buddy window — low value; ⌘K palette covers.
- Heavy-work worker as separate process — Electron workers suffice if needed.

### Already covered (no gap)
- Artifacts partially via viewers (images, PDF, CSV, notebooks) and markdown preview.
- Quick window partially via ⌘K command palette.
- Find in page via VS Code find.
- Memory (per project) via Memory block (read; write via cedia memory add).
- Connectors via local MCP (cedia mcp).
- Remote Control / computer use / SSH/WSL → "later" (protocol ready).
- Multi-cursor, snippets, Emmet, minimap, status bar → VS Code provides.
- Notebook viewer, Mermaid, CSV/JSON export → VS Code viewers.

---

## 13. Quality gates (v1 "done" criteria)

Consolidated checklist; details in referenced sections.

- [ ] **Performance** (§9): cold start ≤500ms, keystroke ≤50ms, idle ≤300MB, scroll 10k blocks @60fps. Measured with HID events + pixel polling on Mac.
- [ ] **Accessibility** (§9, §4): VS Code baseline + VoiceOver labels for blocks, Thai line-height ≥1.6, focus ring 2px accent, Reduce Motion stops animation. (better-a11y review.)
- [ ] **Thai text** (§9): Chromium native line breaking + CSS font fallback; no mid-word wrap; verified with Thai fixtures.
- [ ] **Error behaviors** (§8): 3 levels (modal/notification/inline) mapped; Thai messages retained; no unhandled errors.
- [ ] **Notifications** (§9): badges (project tab, sidebar, Dock) + optional sound; no banners (deferred).
- [ ] **Testing/CI** (§9, §11): Rust cargo test (replay fixtures, layout fit), TS vitest (block logic, settings), Playwright E2E smoke. No model calls in CI. All green.
- [ ] **Telemetry** (§9): all disabled; crash logs local only (~/Library/Logs/Cedian).
- [ ] **License** (§9): VS Code MIT notice in LICENSE/NOTICE; legal review before ship.
- [ ] **Settings** (§5, §9): single source ~/.cedia/settings.json; VS Code settings UI disabled; Cedian settings window writes desktop key atomically.
- [ ] **Blocks** (§9, §11): full Tern parity (split/drag/zoom/park/PiP/tear-off/named layouts/overview/fold) working at 720–1440px, both themes, no leak.
- [ ] **Browser** (§9): daemon Chromium + CDP + screencast; element selection + capture; per-project allowlist; safety banner.
- [ ] **Multi-repo** (§3.5, §11): roots add/remove/validate; one thread per root; coordinator cards; auto-archive.
- [ ] **Roadmap exit gate** (docs/ARCHITECTURE.md phases 0-D): Phase D exit — "agent fixes a bug shown in a screen recording".