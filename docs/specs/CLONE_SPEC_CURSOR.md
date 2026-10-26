# CLONE_SPEC — Cursor (clean-room reverse engineering)

**Target:** `/Applications/Cursor.app` (Electron, v3.27.12, VS Code fork)
**Method:** REA (bundle inspection). No code/assets copied.
**Scope:** User-visible features, screens, state machines, formats, protocols, settings, errors relevant to a desktop coding-agent workspace. Items not verifiable are marked UNKNOWN.

## 1. Identity & stack (evidence)

- VS Code fork (Electron). `out/main.js`. Version 3.27.12.
- Extensions in `extensions/`, `node_modules/`, `node_modules.asar`.
- Native modules: `molten/`.
- Policies, bin.

## 2. User-visible features

### 2.1 Editor (VS Code)
- Full VS Code editor: syntax highlighting, LSP, IntelliSense, debugging, git, extensions.
- Multi-cursor, snippets, Emmet.
- Terminal (integrated, xterm.js).
- File explorer, search, source control.

### 2.2 AI features (Cursor-specific)
- Composer (AI chat in editor).
- Agent mode (multi-file edits).
- Inline edit (Cmd+K).
- Tab completion (Cursor's proprietary).
- Chat panel.
- Rules (`.cursorrules`, project rules).
- MCP servers.
- Background agents (cloud).
- Bug finder, PR review.

### 2.3 Cursor-specific UI
- Command palette (Cmd+K / Cmd+Shift+P).
- Sidebar (explorer, search, git, extensions, chat).
- Panel (terminal, problems, output, debug).
- Status bar.
- Minimap.

## 3. Screens / surfaces

- Main window (editor + sidebar + panel).
- Settings (VS Code settings UI).
- Command palette.
- Quick open (Cmd+P).
- Chat/Composer panel.

## 4. File formats / persistence

- VS Code settings: `settings.json`, `keybindings.json`.
- Workspace: `.vscode/`, `.cursor/`.
- Extensions: `~/.cursor/extensions/`.
- State: SQLite (VS Code state db) in `~/Library/Application Support/Cursor/`.
- Chat history: in state db or files (UNKNOWN exact format).

## 5. Network protocols

- HTTPS to cursor.com (auth, models, telemetry).
- LSP over stdio (language servers).
- MCP servers (stdio/SSE).
- Background agents: cloud API.

## 6. Settings / keybinds

- VS Code settings system (JSON, settings UI).
- Keybindings (JSON).
- Cursor-specific settings (model, rules, MCP, etc.).

## 7. Error behaviors

- Extension host crash → reload.
- LSP server crash → restart.
- Model unavailable → fallback.
- Auth expired → re-login.

## 8. UNKNOWN

- Cursor's AI internals (model routing, context gathering).
- Background agent protocol.
- Tab completion implementation.
- Composer/agent state machine.
- Exact persistence (SQLite schema).
- Extension host details.

## 9. Evidence

- `/Applications/Cursor.app/Contents/Resources/app/` (unpacked, not asar).
- `out/main.js` (main entry).
- `extensions/` (bundled extensions).
- `product.json` (product config).
- VS Code fork (inherited VS Code architecture).

## 10. Takeaways for cedian

- **Monaco editor** — web-based, sharp, LSP support; good for Tauri migration.
- **VS Code settings model** — JSON settings + keybindings; familiar pattern.
- **Command palette** — `⌘K`/`⌘P` pattern; cedian already has `⌘K`.
- **Extension system** — not recommended for cedian (maintenance burden).
- **Tab completion** — Cursor's proprietary; not easily replicable.
- **Take**: Monaco editor, settings model, command palette. Don't take: extension system, tab completion.