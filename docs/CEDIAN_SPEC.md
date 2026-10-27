# CEDIAN — Detailed Specification (VS Code fork + cedia agent)

**Version:** 0.1 (draft)
**Date:** 2026-10-27 (adds §3.6 Artifacts REA + `cedian_artifact` + `src/artifacts/`)
**Base:** VS Code (latest stable, MIT license) fork
**Agent:** cedia (unchanged, multi-provider)
**Product name:** Cedian
**License:** Proprietary (Cedian-specific) + MIT notice for VS Code portions (see §9)

**Target platform:** macOS 26 (Tahoe) only for v1 (personal, single-owner, local-first).

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
- **Cross-platform**: macOS only → macOS 26 (Tahoe) only for v1 (Windows/Linux later)

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
| Computer use | macOS 26 Accessibility / Cua Spaces (future) |
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

### 3.6 Artifacts (from Claude Desktop; REA 2026-10-27)

Source: `https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them`
+ `https://claude.com/features/artifacts` (marketing page; scope mapping only)
(public docs only; no code copied, no proprietary internals). Method: REA
recovers trigger, inputs, processing steps, outputs, side effects, and failure
modes from the article text, then cedian re-implements that observable behavior
local-first. cedia remains the only agent: cedia decides what qualifies, the
daemon applies the rules and owns the records, the window only renders.

#### 3.6.1 Recovered behavior (Claude Desktop / web)

- **Trigger.** Claude creates an artifact when the content is (a) significant
  and self-contained, typically over 15 lines, (b) likely to be edited,
  iterated on, or reused outside the conversation, (c) standalone without the
  conversation's context, and (d) likely to be referred back to. An explicit
  ask ("ask for one in any conversation, including Claude Code") or a template
  choice (Output menu, Artifacts tab) also triggers one. Capability switch
  "Create and edit files" (Settings > Capabilities, or Organization settings on
  Team/Enterprise) must be on. Plan gating: create-in-chat on all plans;
  Docs/Slides/Design templates on all plans (Enterprise auto-on 2026-10-15,
  owners may enable earlier); Dashboards beta on Pro/Max/Team/Enterprise
  (Enterprise off until owner enables); Motion beta on Team (on) /
  Enterprise (off until owner enables).
- **Inputs.** Chat prompt + conversation context, template choice, connected-app
  data, design system (colors/fonts/components), direct edits, highlight +
  "Edit with Claude" requests, multi-file batch requests, published-artifact
  code pasted into a new chat + change description, error text via "Try fixing
  with Claude".
- **Processing.** Decide artifact vs inline (four criteria above); open in its
  own window beside the conversation (templates open on an editable canvas/page);
  edit loop: ask Claude to change it, edit directly, highlight + Edit with
  Claude, batch across several Markdown files in one pass (file list shows
  pending count, send applies the whole batch), or edit an earlier message to
  branch a different chat version with its own artifacts; view/copy/download
  (legacy) or Export (templates); build on a published artifact (Free/Pro/Max,
  legacy published from chat: Copy code → new chat + describe changes →
  refine, separate copy); fix via "Try fixing with Claude" (re-sends error,
  success not guaranteed); artifacts-that-use-Claude (artifact calls Claude on
  Anthropic infra, users sign in, usage counts against each user's plan; legacy
  toggle "AI-powered artifacts", new asks permission first time); connect apps
  (first use shows apps/tools, asks approval, per-tool off carries over,
  per-action-approval tools unavailable); store data (personal vs shared, first
  shared use shows confirmation, 20 MB per artifact text-only, personal/shared
  separate, legacy works only after publish, unpublish deletes legacy data);
  Claude Code publish (live page at private URL, updates in place, shareable;
  /design or ask-for-doc; desktop side panel, terminal link); legacy
  (pre-2026-09-16) and Cowork-live (pre-2026-08-19) keep working with no new
  creation / no in-place edit respectively.
- **Outputs.** Versioned artifact pane; saved to Artifacts tab
  (`claude.ai/artifacts`: view all, start from template, organize). Exports:
  Docs → Word/PDF/Markdown/Google Docs; Slides/Decks → PowerPoint/PDF/Google
  Slides (editable); Designs → .zip/PDF/PowerPoint/standalone HTML/other tool;
  Animations → MP4; legacy → view code/copy/download. Starts private; sharing
  per the sharing article.
- **Side effects.** Library entry; plan-limit metering per user (not builder);
  personal/shared storage persists between sessions; publish creates a
  shareable/private URL; unpublish deletes legacy stored data.
- **Failure modes.** Capability off → no artifacts; plan/template gated →
  unavailable until owner enables; legacy/Cowork cutoffs → cannot create new /
  cannot edit in place; storage fails until publish (legacy while building),
  over 20 MB, or binary/image payload; per-action-approval connector tools
  unavailable; fix may fail; untrusted published code (treat like an unknown
  file); VoiceOver gap (Chrome 150–152 and Claude Desktop don't read typing in
  slide text boxes; use Chrome 153+); mobile (iOS/Android: view in Artifacts
  tab + edit, sharing needs web/desktop). Keyboard map for Slides is in the
  article (F6 areas, Tab/Return into slide/objects, arrows, Present, thumbnails
  menu); cedian does not replicate it verbatim (see differences).

#### 3.6.2 Cedian implementation (local-first, v1)

Rules live in `daemon/crates/cedian_artifact` (pure logic; daemon owns state)
with window mirrors in `src/artifacts/` (gating/preview only):

- `kind.rs` / `kinds.ts`: `ArtifactKind` (Docs/Slides/Design/Dashboard/Motion +
  Code/Website/Image/Diagram/Tool/Document), `from_template`, `is_beta`,
  `claude_exports` (original) vs `cedian_exports` (local).
- `trigger.rs` / `policy.ts`: `Candidate { lines, explicit_request, template,
  reusable, standalone, referable, capability_enabled }`;
  `should_be_artifact = capability_enabled &&
  (explicit_request || template.is_some() || (lines > 15 && reusable &&
  standalone && referable))`; `template_allowed(kind, plan,
  enterprise_enabled)` per the plan table above. cedia sets the flags; the
  daemon applies the predicate; the window previews it.
- `artifact.rs`: `Artifact { id, title, kind, versions[], forked_from }`,
  `Version { n, content, origin: Model|DirectEdit|ClaudeEdit|Batch|Fork|Fix }`;
  `edit_direct`, `claude_edit` (selection + `cedia threads send`), `apply_batch`
  (one version), `record_fix`, `fork` (earlier-message branch; original
  untouched), `build_on` (separate copy + trust warning).
- `store.rs` / `policy.ts`: `MAX_BYTES = 20MB`, text-only, personal-only in v1;
  `needs_publish(legacy)`, `unpublish_deletes(legacy)`; legacy imports are
  read-only.
- **Render:** artifact opens as a block beside the agent pane (Electron/VS Code
  split, not a separate window); Docs → markdown preview + VS Code editor;
  Code/Website → editor + daemon-Chromium preview (bundled `chrome-headless-shell`,
  same pane as §6.3); Slides/Design → editor + preview (canvas drag is Phase C,
  user-confirmed, not in v1); Dashboard → `copy`/`download` + Chromium preview
  when the content is static HTML (no live per-viewer queries in v1);
  Motion → Chromium preview of the HTML animation only (no timeline editor,
  no MP4 render in v1).
  Capability maps to `desktop.artifacts.enabled` (default true); cedia's
  thread/session files stay append-only and cedia's to write.
- **Repo split (AGENTS.md: cedia is the only agent):** the model-facing skill
  (when to create, kind mapping, design tokens, refresh) and the `Artifact`
  tool (temp file, connector/download declarations, publish versions) are a
  `cedia`-repo change; `cedian` holds only the record/version/store rules here
  plus pane render. No agent loop, model client, or duplicate tool in `cedian`.
- **Deferred to Phase C/D:** dashboard live-query renderer, Motion timeline
  editor + MP4 render, canvas drag for Slides/Design (Phase C, user-confirmed),
  Google Docs/Slides handoff, publish URLs + sharing,
  shared storage, connect-apps-to-artifact, artifacts-that-use-Claude, mobile.
- Tests: `cedian_artifact` (19) + `src/artifacts/artifacts.test.ts` (10)
  assert every recovered rule above (15/16-line bar, all four flags, explicit
  override, capability gate, plan table, export gaps, 20 MB text-only,
  legacy publish rule, fork/build-on isolation, fix recorded).

#### 3.6.3 Observable differences that remain (cedian v1 vs Claude)

1. No cloud run: artifacts render local files/previews; no Anthropic-infra
   execution, no private-URL live pages that update mid-session.
2. No Google handoff: Word/PDF/Markdown via VS Code; no "open in Google Docs /
   Slides as editable", no Design ".zip → other tool" push, no MP4 export.
3. Templates: Docs/Slides/Design fully local; Dashboard stored with Chromium
   preview for static HTML (live per-viewer queries deferred); Motion stored
   with HTML-animation preview only (timeline editor + MP4 deferred).
4. No shared storage, publish, or sharing links: personal-only, 20 MB
   text-only kept; unpublish-delete rule applies to imported legacy only.
5. No connect-apps-to-artifact and no artifacts-that-use-Claude (would be a
   second agent surface; cedia owns tools/MCP).
6. No per-plan metering or org-owner toggles: single owner, `desktop.artifacts`
   on/off only; plan table kept in code for parity testing, not enforced.
7. Version branch via `cedia threads fork` (new thread) rather than in-place
   chat-version duplication; cedia files stay append-only.
8. Editing is VS Code editor + ask-cedia (selection + send), not an editable
   canvas in v1 (canvas drag is Phase C, user-confirmed); Slides keyboard map
   and screen-reader canvas behaviors not replicated
   (VS Code + VoiceOver baseline applies instead).
9. Legacy (pre-2026-09-16) and Cowork-live imports are read-only; no new legacy
   creation path.
10. Trust: "Copy → new chat" becomes fork-local-file + warning; no Free/Pro/Max
    published-remix network.

#### 3.6.4 Solo-dev scope (from `claude.com/features/artifacts`)

The marketing page sells three jobs. cedian v1 keeps the solo-local subset;
anything needing a second person, a cloud run, or an external SaaS stays out
(single-owner, local-first; Mac always on covers background refresh, not cloud).

- **Show your numbers (Slides / Dashboards / Motion):** Slides fully local
  (editor + preview, PDF export). Dashboards from local data only —
  spreadsheet/report/CSV in the repo or rows cedia already pulled through
  local MCP (`cedia mcp`); no Salesforce/QuickBooks cloud connectors, no live
  per-viewer queries. Motion as HTML animation preview only; no MP4 render.
- **Pitch and launch (Design / Docs / Slides / Motion):** Design/Docs/Slides
  fully local (one-pager, mockup, deck from rough notes). No Canva asset
  generation, no HubSpot staging/send, no "show everything before anything
  goes out" approval pipeline — the review is the local diff + artifact pane.
- **Keep the team aligned (Docs / Dashboards / Slides):** living doc/spec per
  project that Claude updates as the work changes; same link is the daemon
  record file (§5.4), not a share link. No co-editing, comments stay as
  selection + `cedia threads send`.
- **Edit your way — yes:** edit directly, leave a comment for Claude, or ask
  in the conversation. Canvas drag for Slides/Design stays Phase C (§3.6.3-8);
  phone editing is out (VS Code + VoiceOver baseline instead).
- **Edit with your team — no:** private by default and stays private; no
  viewers/editors roles, no in-org or public links, no audit log.
- **Export it — partial:** Markdown/PDF/standalone-HTML/PNG/copy/download via
  VS Code + bundled Chromium. No PowerPoint/Google Slides editable handoff,
  no .zip-to-tool push, no MP4 in v1.
- **Pass it on — no push:** no send-to-tools integration; handoff is a local
  file the owner moves. Always-on Mac covers scheduled refresh
  (`cedia schedules`) and the `localhost` live preview; it does not replace
  cloud sessions or external sharing.

### 3.7 Code-tab behaviors (from desktop-changelog + cursor-changelog REA, 2026-10-27)

Source: `https://code.claude.com/docs/en/desktop-changelog`,
`https://cursor.com/changelog` (public docs only; no code copied). cedia owns
agent behavior; cedian renders. Single-owner local-first; cloud/SSH/WSL/phone
stay deferred (§12 G13).

- **Prompt suggestions:** gray text in an empty composer; `Tab`/`Right arrow`
  accepts, typing replaces, `Enter` alone never sends it. Toggle in Settings.
  Generated by a background request (counts as plan usage).
- **Permission modes:** Manual (`default`: ask per edit/command, diff shown),
  Accept edits (`acceptEdits`: auto file edits + mkdir/touch/mv, ask other
  commands), Plan (`plan`: explore + propose, no source edits; session-only),
  Auto (`auto`: classifier gates shell/network), Bypass (`bypassPermissions`:
  no prompts except never-auto actions, safety classifiers, destructive session
  ops; sandboxed containers/VMs only). Selector default remembered per folder
  (`permissions.defaultMode`); Plan never sticks.
- **Preview servers:** `.claude/launch.json` declares dev commands; daemon
  starts/stops servers, Browser pane `Dev servers` menu lists them; `Open`
  card appears in chat. Auto-verify after edits (screenshot, DOM inspect,
  click, fill, fix) needs no per-site approval on localhost.
- **External site safety:** first action on a new external site shows Allow
  once / Always allow / Deny; Always allow persists per site (subdomains
  included) on device, revocable in Settings. Classifiers review write actions
  in every mode; domain allowlist check applies outside Auto/Bypass. Purchases,
  account creation, and CAPTCHA bypass always ask.
- **Diff comments + review card:** hover `+` opens a line comment box; `Enter`
  adds, `Cmd+Enter` submits all; cedia reads comments and returns a new diff.
  `/code-review` groups findings by file; Walk through in diff steps findings
  (Fix this one / dismiss per line); Apply fixes asks cedia to fix open ones.
- **Session details:** Context card (%, per-category), Environment card (env,
  folder/worktree, Remote switch), Changes card (diff totals, PR + CI status).
  Header ring mirrors context %.
- **File pane:** Auto save on by default (toggle in pane ⋮); disk-change
  warning → Override (write) / Discard. View-only files (`.mcp.json`,
  `.claude/settings.json`) open read-only; edit in an external app. Context
  menu: Attach as context, Open in (VS Code/Cursor/Zed), Show in
  Finder/Explorer, Copy path (absolute/relative/filename).
- **Context commands:** `/context` prints per-category usage in chat;
  `/compact` summarizes now; auto-compact at the limit, then work continues.
- **Side chat:** `Cmd+;` or `/btw`; reads main-thread context, writes nothing
  back; discarded on close and on app quit (never persisted).
- **Archive lifecycle:** auto-archive on PR merge/close (setting, default
  off); archiving with uncommitted changes asks Archive anyway / cancel
  (untracked-only changes: commit first or lose them after PR merge); worktree
  stays on disk, removed ~30 days after archive/last open; Archived tab +
  Unarchive restores.
- **Worktree settings:** `<root>/.cedian/worktrees/` default; Branch prefix
  setting prepends worktree branch names; `.worktreeinclude` copies gitignored
  files (e.g. `.env`); per-project location override in Settings. Git required.
- **Computer-use tiers (summary; detail in `COMPUTER_USE_SPEC.md`):** fixed per
  category — browsers view-only; terminals/IDEs click-only; everything else
  full control; extra warning for Finder/Terminal/System Settings; Denied-apps
  list; unhide-windows-on-finish toggle. Research preview, out of v1.
- **Decided defaults (2026-10-27; cedia-side items pending its tool):**
  gate is AND — cedia `enableArtifact` (to be added) and
  `desktop.artifacts.enabled` (default on); either off blocks creation and the
  inline error names which. Project-level `enableArtifact` never re-enables;
  cedian ignores project-level settings (single source `~/.cedia/settings.json`).
  Canvas drag (Phase C) gets its own perf gate; exempt from the 10k-block scroll
  budget until measured. Local Chromium preview enforces the viewer CSP from
  Phase B (CDN allowlist, data-URI images, no external network). Scheduled
  dashboard refresh publishes a new version per refresh; daemon keeps the newest
  20, prunes older.

## 4. State machines

### 4.1 Thread states (from cedia, unchanged)

```
queued → working → (done | failed | stopped | asking | interrupted)
```
- `asking`: run ended on a question; answer is next prompt
- Auto-archive: done + verified + no hunks → archived; PR-merge trigger,
  unsaved-changes guard, and ~30-day worktree retention per §3.7

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

### 4.5 Artifact states (daemon-owned; window renders)

```
draft → open → (edited | fixing | forked) → pinned → closed
```

- `draft`: candidate met §3.6 trigger; daemon record created, no versions yet.
- `open`: v1+ rendered beside the agent pane.
- `edited`: direct, Claude, or batch edit appended a version.
- `fixing`: "Try fixing" re-sent the error; stays until the next version lands
  (fix may fail).
- `forked`: earlier-message edit branched a separate line (`forked_from` set;
  original untouched). `build_on` is a fork plus the trust warning.
- `pinned`: kept in the Artifacts-equivalent list (daemon state, per project).
- Legacy/Cowork-live imports enter as read-only `open` and never leave it.
- Storage failures (over 20 MB, binary, shared) and capability-off keep the
  candidate in `draft` with an inline error (§8).

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
- `<main worktree>/.cedian/worktrees/` — threads' worktrees (git-native, in-repo; see `daemon/crates/cedian_daemon/src/worktree.rs`); Branch prefix setting prepends branch names; `.worktreeinclude` copies gitignored files; per-project location override in Settings

### 5.4 Artifact records (daemon-owned)

- `<state dir>/artifacts/<project slug>/<artifact id>.json` — one file per
  artifact (`Artifact` in `cedian_artifact`): id, title, kind, versions,
  `forked_from`. Daemon writes atomically (temp file + rename, same as
  `desktop`-key writes); window reads via IPC (Phase B) and rebuilds
  from these files on restart. cedia's thread/session files stay append-only
  and are never written for artifacts.
- Content is text only (20 MB cap per artifact, §3.6); previews render from the
  worktree file or the stored version, never from a cloud URL.

### 5.5 Desktop key (Cedian's)

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
    "editor": { "auto_save": true },
    "artifacts": { "enabled": true }
  }
}
```

## 6. Network protocols

### 6.1 cedia protocol (unchanged)

- `cedia --print=<text> --thread <id> --output-format stream-json --cwd <dir>` (`--print=` keeps a prompt starting with `-` from reading as a flag)
- `cedia threads --cwd <dir> send <id> -- <text>`
- `cedia threads archive|rename|delete`
- `cedia mcp list|add|remove|check`
- `cedia usage --json --since <range>`
- `cedia schedules due|fire|pause|resume`
- `cedia commit --thread <id> --json`
- `cedia pr --thread <id>`

### 6.2 Daemon IPC (Electron ↔ daemon)

- Unix socket: `daemon.sock` in Cedian's state dir (primary transport; daemon outlives window)
- Request/Notice protocol (cedian_wire) — structured agent events (user/text/thinking/tool_call/tool_result/receipt/session) sent from daemon to window
- Artifacts IPC deferred to Phase B: `Request::Artifacts` / `Notice::Artifacts`
  for the §5.4 record files (daemon owns, window renders); no wire change in v1
- Electron IPC: window-local only (renderer↔main); not used for daemon communication
- Tauri: not used

### 6.3 Browser (Chromium/CDP)

- daemon Chromium (bundled) screencast into panel for browser pane
- CDP for agent-driven browser (read/click/type/navigate)
- Element selection via CDP DOM.inspect
- Screenshot via Page.captureScreenshot
- External sites with safety classifiers (Claude Desktop pattern)
- Dev servers from `.claude/launch.json` (`Dev servers` menu; auto-verify on localhost needs no site approval)
- Per-site Claude-tool approvals: Allow once / Always allow / Deny, revocable in Settings

### 6.4 Remote (future)

- SSH sessions (Claude Desktop pattern)
- WSL (Windows)
- Remote Control (phone → desktop)

## 7. Settings / keymap

### 7.1 Settings window (VS Code settings UI)

- Appearance: theme, fonts, sizes, density, view mode, sound
- Bots, Models, MCP (cedia's keys, edited through schema)
- Roots: per-project root paths (validate git repo, dedup)
- Worktrees: branch prefix, custom location (per project)
- Sessions: prompt-suggestion toggle, auto-archive after PR merge (default off)
- Browser: keep cookies, external sites allowlist + per-site Claude-tool approvals (revocable)
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
| `Tab` / `→` | Accept prompt suggestion (empty composer only) |

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
- "Archive anyway? This worktree has uncommitted changes" (archive guard; cancel keeps them)
- "Claude tools are off for this site" (per-site deny / admin block)

### 8.4 Display levels (VS Code fork)
- **Blocking / needs action** (protocol mismatch, not a git repo, root in use, version mismatch) → modal dialog (VS Code window.showErrorMessage, modal)
- **Transient** (network timeout, browser closed before page opened, lost contact) → VS Code notification (non-modal, auto-dismiss)
- **Inline** (stale hunk, agent error, unverified, artifact draft/fix/storage errors) → inline in block/agent pane
- Thai messages (§8.3) retained as-is

### 8.6 Artifact errors (recovered, local-mapped; strings English in v1,
Thai follows with the settings-window pass)

- "Artifacts are off — turn on Artifacts in Settings" (capability off;
  `desktop.artifacts.enabled` false).
- "Dashboards need Pro or a team plan" / "Motion needs Team" (plan gate;
  recorded for parity, not enforced single-owner).
- "Artifact storage is 20 MB per artifact" / "artifacts store text only"
  (quota/binary guard, `check_store`).
- "Shared storage is not available in cedian v1 (personal only)" (shared
  requested; confirmation step has no one to confirm to).
- "Legacy artifacts open read-only" (pre-2026-09-16 import; no new legacy).
- "Try fixing with Claude failed — see the error above" (fix attempt recorded
  as a `Fix` version; success not guaranteed).
- "Untrusted artifact — forked to a local copy, original untouched"
  (build-on trust warning).

### 8.5 Crash recovery (daemon)
- Daemon outlives window; quitting window never stops a thread.
- On daemon restart: reconcile live runs via `runs.json` (pid, thread, cwd, pre-run sessions); follow surviving cedia processes by tailing session logs; mark threads whose run is gone as `interrupted`.
- Window reconnects to daemon on launch; starts daemon if none answers.
- Worktrees and shadow git persist on disk; review state rebuilds from cedia files.

## 9. Decisions (grilled 2026-10-26, rounds 1–5)

### Strategic
- **Pivot**: Fresh start on VS Code fork (Electron + TypeScript); reuse daemon + cedian_protocol + cedian_index + cedian_wire where possible; UI (GPUI) rewritten in TS. ARCHITECTURE.md (GPUI native) superseded.
- **Platform**: macOS 26 (Tahoe) only for v1 (Windows/Linux later); daemon uses macOS-specific APIs (caffeinate, launchd, Keychain, APFS clonefile). Assumes macOS 26+; Cua Spaces/locked-use features available only on this baseline.
- **Base**: VS Code latest stable (MIT). Pin latest stable; merge VS Code updates quarterly; owner decides merge.
- **License**: Proprietary (Cursor-style) for Cedian-specific additions; VS Code portions retain MIT notice (LICENSE/NOTICE). Legal review before ship.
- **Extension system**: VS Code built-ins + Open VSX (not Microsoft Marketplace, ToS forbids non-Microsoft products). No Cedian-specific extensions.

### Agent / browser / tools
- **Agent integration**: Full Cursor-style (chat panel, composer, agent mode, rules, @mentions, MCP).
- **Models/effort**: coordinator (project chat) and threads may use different model+effort (Claude Projects pattern); defaults Opus/high for threads, lower for coordinator. Set per-project in desktop key.
- **Agent is the only agent**: cedia owns MCP; VS Code MCP client disabled (avoids duplicate tool surfaces; cedia permission/sandbox covers MCP tools).
- **Browser**: in-app Chromium (daemon-owned, bundled chrome-headless-shell) + CDP; screencast into VS Code panel. Not VS Code integrated browser. One browser per workspace, shared by person + agent. cedia owns site policy; Cedian adds per-project allowlist (desktop.browser).
- **Debugger**: Full DAP (VS Code-level).
- **Computer use**: later (macOS 26 Accessibility / Cua Spaces / Cua Driver, research preview). Core implementation must be Cedian-owned and MIT-clean; only MIT-compatible dependencies allowed.
- **Remote access**: later (protocol ready, client later).
- **SSH/WSL**: later.

### UI / blocks
- **Blocks**: Tern-style (drag/zoom/park/PiP/named layouts) implemented by forking VS Code workbench layout engine in TS; native DOM + CSS (no React). Full parity in v1 (accept timeline risk). Tern-level polish achievable via CSS transforms + rAF.
- **Block rendering tech**: native DOM + CSS (no React) — smaller bundle, full control.
- **State ownership**: daemon owns cedia state (threads, worktrees, browser, roots, block layouts, project tabs); VS Code owns editor buffers/tabs, terminal sessions, git UI, keybindings, extensions. VS Code settings UI disabled; Cedian settings window writes ~/.cedia/settings.json (desktop key); VS Code settings.json is generated read-only.
- **Module ownership** (Rust crate ↔ TS dir; decided 2026-10-26, pre-fork):

  | Area | Rust (daemon owns state/logic) | TypeScript (window renders) |
  |------|-------------------------------|------------------------------|
  | Agent runs | `cedian_daemon` (runs, worktrees, git ops) + `cedian_agent` (stream fold, Phase B) | `src/agent-pane/`, `src/composer/` |
  | Protocol | `cedian_protocol` (cedia schema types), `cedian_wire` (socket framing) | generated TS types from wire (Phase B) |
  | Index/search | `cedian_index` (threads/sessions/memory reads) | `src/workbench/` (sidebar, project chat) |
  | Review | `cedian_review` (hunks vs first snapshot) | diff UI via VS Code diff editor |
  | Artifacts | `cedian_artifact` (trigger, kind, versions, 20 MB store) + daemon record files (§5.4) | `src/artifacts/` (kinds, policy gating, pane render) |
  | Layout | block trees in `desktop.layout` (daemon persists) | `src/blocks/` (drag/zoom/park/PiP) |
  | Browser | `cedian_daemon` (Chromium process, CDP) | `src/browser-panel/` (screencast view) |
  | Settings | `cedian_daemon` (atomic `desktop`-key writes) | `src/settings/` (settings window) |

  Rule of thumb: if the window can be killed and rebuilt from it, it lives in
  the daemon; if it is pixels and interaction, it lives in `src/`. cedia's
  thread/session files stay append-only and cedia's to write.
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

### License / IP policy
- **Cedian-specific code**: proprietary (Cursor-style), unless explicitly marked MIT-compatible.
- **Third-party code**: **MIT only** for direct inclusion. No FSL, Apache-2.0, GPL, AGPL, or proprietary code in the core.
- **Computer-use core**: written in-house for Cedian; may use macOS public APIs only. External MIT code may be used as reference or optional dependency, with attribution.
- **Dependency policy**: every dependency must pass license scan in CI; non-MIT dependencies require explicit approval.
- **Attribution**: maintain `THIRD_PARTY_NOTICES.md` and preserve upstream license files.
- **No copying proprietary internals**: implement behavior from public docs/APIs, not from closed-source products.

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
- `https://code.claude.com/docs/en/desktop-changelog` → REA findings (§3.7)
- `https://cursor.com/changelog` → REA findings (§3.7, §12 G4/G11: Agent SDK, canvases, Origin, remote-control, Rollouts/Security Review)
- `https://support.claude.com/en/articles/9517075-what-are-projects` → REA findings
- `https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them` → REA findings (§3.6; public docs only)
- Academy: `creating-with-artifacts`, `intro-to-artifacts`,
  `build-custom-artifacts-with-claude`, `debate-practice-with-feedback` → kind
  mapping + custom-artifact contract (§3.6.2–3.6.4; public docs only)
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
3. Daemon IPC over Unix socket; reuse cedian_daemon + cedian_protocol + cedian_index + cedian_wire (+ cedian_agent for the stream fold and cedian_review for hunks, Phase B; artifacts IPC `Request::Artifacts`/`Notice::Artifacts` also Phase B, §6.2)
4. Rewrite UI in TS on VS Code fork: blocks (full Tern parity), settings window, browser panel (daemon Chromium screencast)
5. Open VSX configured; VS Code settings UI disabled; Cedian settings window writes ~/.cedia/settings.json
6. Theme (Warm & Lime) via VS Code color theme + CSS vars; Thai text via Chromium native
7. Roots UI (settings) per docs/specs/ROOTS_SETTINGS_DRAFT.md
8. Multi-repo workspace per docs/specs/PROJECTS_SPEC.md
9. CI: Rust cargo test + TS vitest + Playwright E2E; performance budgets as gates
10. License compliance (MIT notice for VS Code portions) before ship
11. Manual update check (Help → Check for updates) for v1 (auto-update deferred)

---

## 12. Gap analysis vs Claude Desktop / Cursor / Tern (2026-10-26; G3/G12 resolved + §3.7 code-tab deltas 2026-10-27)

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
| Computer use | yes | no | later (macOS 26) | ⚠️ deferred |
| Artifacts (rendered inline) | yes | no | local block + editor/preview (§3.6) | ✅ local (10 diffs) |
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
| Prompt suggestions | gray text, Tab accept | ? | composer Tab-accept + toggle | ✅ |
| Permission modes | Manual/Accept/Plan/Auto/Bypass | ? | full matrix via cedia | ✅ |
| Preview servers | yes (launch.json, auto-verify) | ? | daemon + Dev servers menu | ✅ |
| External site approvals | Allow once/Always/Deny | ? | per-site + classifiers | ✅ |
| Diff comments | yes | ? | line comments + Cmd+Enter submit-all | ✅ |
| Code review card | yes | yes | walk-through + apply fixes | ✅ |
| Session details cards | Context/Env/Changes | ? | Context/Environment/Changes | ✅ |
| Context commands | /context | ? | /context + /compact + auto-compact | ✅ |
| File pane semantics | autosave, Override/Discard | ? | same + Open in…/copy paths | ✅ |
| Side chat semantics | reads context, unsaved | ? | /btw, read-only, discarded | ✅ |
| Archive lifecycle | PR-merge trigger, guard, retention | ? | same (30-day worktree) | ✅ |
| Worktree settings | prefix, location | ? | prefix + include + location | ✅ |

### Include (added/clarified)
- **G1. Single-owner, local-first scope** — stated explicitly in §1 Vision (no multi-user/team/cloud/mobile). Already intended; now explicit.
- **G2. Model/effort separate for coordinator vs threads** — added to §9 (Claude Projects pattern).
- **G3. Artifacts (rendered code/docs inline in chat)** — DONE 2026-10-27 (§3.6):
  daemon-owned records (`cedian_artifact` + §5.4 files), artifact block beside
  the agent pane (editor + Chromium preview), local exports, personal-only
  20 MB text store. Cloud/shared/publish paths excluded by design (§3.6.3).

### Defer (phase later)
- **G4. Inline AI completion / tab completion (ghost text)** (Cursor) — still deferred to Phase D or later; requires model routing; cedia may expose completion. Cursor's changelog since (Agent SDK, cloud canvases, Origin marketplace) adds no new completion surface to track. Not blocking "complete tools".
- **G5. Quick window / global launcher + find in page** (Claude) — ⌘K palette covers v1; global hotkey launcher and browser-pane find-in-page deferred.
- **G6. Project overview surface** (Claude Projects: Landing/Idle/Resolved + Library/PRs/Scheduled) — sidebar + background tasks cover most; add "Landing" badge for PR-in-flight later.
- **G7. Lock/unlock thread** (Tern) — defer.
- **G8. Screen capture for agent (desktop, not just browser page)** (Tern/PandaCode) — covered by computer use (later).
- **G9. Canvas/board block** (Tern) — freeform notes block; defer to Phase C/D.
- **G10. Custom CSS / theming beyond tokens** (Tern) — defer.
- **G11. Bug finder + Security Review + Rollouts** (Cursor) — covered by code review (`/code-review` card: walk-through, apply fixes) + PR review + PR monitoring (auto-fix/merge); dedicated security-only review (severity/attack-path/dismiss-once/team rules) and deploy-health monitoring (per-env verdicts, revert PR) deferred. Origin marketplace apps are out (no Cedian-specific extensions).
- **G12. Artifacts rendering details** — RESOLVED 2026-10-27 (§3.6): REA from
  the public artifacts article; rules in `cedian_artifact` + `src/artifacts/`
  with tests; cloud/shared/publish/connect-apps/use-Claude deferred or
  excluded per §3.6.3.
- **G13. Cloud execution + remote surfaces** (cloud sessions while laptop closed incl. multi-repo/cloud-environment scale, SSH incl. port-forward, WSL, Remote Control/phone incl. iOS + keep-awake) — defer to post-v1 "remote execution" phase; local-first for v1 (daemon keep-awake covers local). Protocol ready.
- **G14. Cloud connectors** (claude.ai connectors) — defer; local MCP (cedia mcp) covers v1.

### Exclude (intentionally not replicated)
- Cowork / team collaboration, Claude Tag (Slack), multi-user sharing, trusted devices — owner-only is a core principle (AGENTS.md).
- Mobile app — desktop product; mobile would be a separate client talking to daemon (Remote Control pattern), not part of cedian.
- Tab completion internals (Cursor proprietary) — cannot replicate; model-based completion deferred (G4).
- Buddy window — low value; ⌘K palette covers.
- Heavy-work worker as separate process — Electron workers suffice if needed.

### Already covered (no gap)
- Artifacts viewers (images, PDF, CSV, notebooks) and markdown preview now fold
  into §3.6 (artifact blocks); cloud/shared/publish paths stay excluded.
- Code-tab behaviors (§3.7): suggestions, permission matrix, preview servers +
  auto-verify, per-site approvals, diff comments + review card, session cards,
  /context + /compact, file-pane semantics, side-chat discard, archive
  lifecycle, worktree settings, computer-use tiers.
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
- [ ] **License** (§9): VS Code MIT notice in LICENSE/NOTICE; legal review before ship; MIT-only dependency scan; THIRD_PARTY_NOTICES updated.
- [ ] **Settings** (§5, §9): single source ~/.cedia/settings.json; VS Code settings UI disabled; Cedian settings window writes desktop key atomically.
- [ ] **Blocks** (§9, §11): full Tern parity (split/drag/zoom/park/PiP/tear-off/named layouts/overview/fold) working at 720–1440px, both themes, no leak.
- [ ] **Browser** (§9): daemon Chromium + CDP + screencast; element selection + capture; per-project allowlist; safety banner.
- [ ] **Multi-repo** (§3.5, §11): roots add/remove/validate; one thread per root; coordinator cards; auto-archive.
- [ ] **Code-tab behaviors** (§3.7): suggestions accept/toggle, permission matrix, preview servers + auto-verify, per-site approvals, diff comments + review card, session cards, file-pane save semantics, /context + compact, side-chat discard, archive lifecycle, worktree settings. Unit-test pure rules; E2E smoke covers panes.
- [ ] **Artifacts** (§3.6, §4.5, §5.4, §8.6): `cargo test -p cedian_artifact` +
  `vitest src/artifacts` green; 15/16-line bar, plan table, 20 MB text-only,
  fork/build-on isolation, local exports (no Google/MP4), 10 differences listed
  and true.
- [ ] **Roadmap exit gate** (docs/ARCHITECTURE.md phases 0-D): Phase D exit — "agent fixes a bug shown in a screen recording".

---

## 14. Computer-Use Research Preview (macOS 26)

Detail lives in `docs/specs/COMPUTER_USE_SPEC.md` (split out 2026-10-26).
Summary: cedia owns tool calls and reasoning; the daemon executes macOS
Accessibility actions (`list_apps`, `get_app_state`, `click`, `type_text`,
`press_key`, `scroll`, `screenshot`, `wait`); the UI shows permission status,
approvals, and audit history. Per-app tiers: browsers view-only,
terminals/IDEs click-only, everything else full control, with a denied-apps
list and unhide-on-finish toggle. Research preview, out of scope for v1.
