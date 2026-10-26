# CLONE_SPEC — Claude Desktop (clean-room reverse engineering)

**Target:** `/Applications/Claude.app` (Electron, v3.6556.2, `@ant/desktop`)
**Method:** REA (asar extraction, bundle inspection). No code/assets copied.
**Scope:** User-visible features, screens, state machines, formats, protocols, settings, errors relevant to a desktop coding-agent workspace. Items not verifiable are marked UNKNOWN.

## 1. Identity & stack (evidence)

- Electron app (`app.asar`, main `.vite/build/index.pre.js`).
- package.json: `@ant/desktop`, v3.6556.2, Node >= 22.
- Renderers: `main_window`, `quick_window`, `file_viewer`, `buddy_window`, `about_window`, `find_in_page`, `heavy-work-worker`.
- Uses Chromium (bundled Electron), not OS webview.

## 2. User-visible features

### 2.1 Chat (claude.ai)
- Conversations with Claude (Opus, Sonnet, Haiku).
- Projects (claude.ai Projects): group conversations + reference files (older) + new Code Projects (web-embedded).
- Artifacts: code, docs rendered inline.
- File upload, image paste.
- Memory (per conversation/project).
- Connectors (MCP servers via claude.ai).
- Cowork (team collaboration), Claude Tag (Slack, Team/Enterprise).

### 2.2 Desktop-specific
- Quick window (launcher), find in page, buddy window, about window.
- Native notifications.
- File viewer (turns).
- Heavy work worker (background processing).
- Settings, about.

### 2.3 Code tab (embedded web)
- Embeds claude.ai/code (web app) → Claude Code Projects live there, not in desktop bundle.
- Desktop is just a webview host for Code Projects.

### 2.4 Computer use / Remote Control
- "Use this computer from your phone and claude.ai" (Remote Control).
- Keep computer awake for Remote Control.
- Trusted devices.

## 3. Screens / surfaces

- `main_window` (primary chat)
- `quick_window` (launcher)
- `file_viewer` (turns viewer)
- `buddy_window`
- `about_window`
- `find_in_page`
- Heavy work worker (background)

## 4. Settings / persistence

- Electron userData dir (macOS: `~/Library/Application Support/Claude/`).
- Settings stored in app config (JSON).
- Keychain for secrets (Anthropic).
- Connectors configured at claude.ai/customize/connectors.

## 5. Network protocols

- HTTPS to claude.ai (chat, projects, connectors).
- WebSocket / SSE for streaming.
- Remote Control: HTTPS to claude.ai → local daemon (localhost).
- MCP: via claude.ai connectors (cloud).

## 6. Error behaviors

- "Couldn't show the setup proposal" (app version mismatch).
- "Claude hasn't responded" (restart Claude).
- Usage limit errors, credits required.
- Lost contact with folder (Remote Control).

## 7. UNKNOWN (not in desktop bundle)

- Code Projects internals (live in web app, not desktop).
- Cowork internals.
- Connector implementation.
- Memory storage format.
- Artifact rendering details.

## 8. Evidence

- `/Applications/Claude.app/Contents/Resources/app.asar` extracted.
- package.json: `@ant/desktop`, v3.6556.2, main `.vite/build/index.pre.js`.
- Renderers: main_window, quick_window, file_viewer, buddy_window, about_window, find_in_page.

---

# Summary for cedian

## What cedian can take from each

### From Tern
- PiP (floating window) pattern for native sharpness
- Block/canvas model (already in cedian)
- PiP interactions (stash, dock, fan, fling)
- Native webview for browser (sharp)
- ScreenCaptureKit for screen sharing

### From Claude Desktop
- Projects model (already studied)
- Remote Control pattern (phone → desktop)
- Connector model (MCP via cloud account)
- Artifact rendering

### From Cursor
- Monaco editor (web-based, sharp, LSP)
- VS Code settings/keybindings model
- Command palette pattern
- Extension system (if needed later)

### From PandaCode (studied earlier)
- Native child webview (create on navigate, destroy on close)
- Element selection + viewport capture
- Resource limits (no polling, lazy load, cached instructions)
- No transitions (everything appears at once)

## Recommendation for cedian

**Keep GPUI + hybrid approach.** Take from these:
1. **Element selection** (PandaCode) — send page context to agent
2. **Native webview on demand** (PandaCode/Tern) — "open in system browser" (done)
3. **Resource limits** (PandaCode) — no polling, lazy load, cached instructions
4. **PiP** (Tern) — optional, macOS-only, floating native window

**Don't:**
- Rewrite as Tauri/web (months of work, lose GPUI perf)
- Fork OSS (architecture rule + license)
- Full IDE (extension system, debugger) — not cedian's value

**cedian's value = agent experience (cedia) + daemon architecture + native GPUI performance.** Sharp browser via "open in system browser" + PNG toggle. Cross-platform via future Tauri migration (if needed).