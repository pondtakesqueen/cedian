# Computer-Use Research Preview (macOS 26)

Split out of `docs/CEDIAN_SPEC.md` §14 on 2026-10-26 (`docs/READINESS.md`:
docs are long and this section evolves on its own cadence). `CEDIAN_SPEC.md`
remains the design source; this file holds the detail.

## 1. Goal
Enable cedia to control local macOS apps when no API, MCP tool, or deterministic integration exists, while keeping the user in control and preserving security.

## 2. Scope
**In scope (research preview):**
- local macOS 26 apps
- Accessibility-based UI tree inspection
- app/window/element state queries
- click, type, key press, scroll, focus
- screenshot fallback for inaccessible UI
- permission onboarding and diagnostics
- audit log of actions

**Out of scope (v1):**
- cloud execution
- remote control from phone
- Windows/Linux
- unattended locked-use automation unless separately approved
- payment, credential entry, or destructive actions without explicit user approval

## 3. How others do it
- **Claude**: computer use is a research preview in Cowork/Code; it prioritizes connectors/tools before GUI control; can open apps, click, type; supports background use on newer macOS; requires Accessibility/Screen Recording.
- **Cursor**: added computer use for local agents to click/type/capture across GUI apps, with emphasis on testing flows such as iOS Simulator.
- **Codex**: background computer use on macOS/Windows with its own cursor; runs alongside the user; uses Accessibility; requires explicit permissions.

## 4. Architecture
- cedia owns tool calls and reasoning
- Cedian daemon executes macOS Accessibility actions
- Cedian UI shows permission status, pending approvals, and audit history
- accessibility tree is the primary interface; screenshot/vision is fallback
- element index is reused across a sequence in one process
- risky actions pass a safety gate before execution

## 5. Tool surface (initial)
- `list_apps`
- `get_app_state`
- `click`
- `type_text`
- `press_key`
- `scroll`
- `screenshot`
- `wait`

## 6. Permissions
- Accessibility
- Screen Recording
- onboarding via `doctor`
- clear error when permission is missing

## 7. Safety
- explicit approval for risky or destructive actions
- no automatic credential entry
- no payment/submission without user approval
- app allowlist/denylist support
- sandbox commands separately via sandbox-runtime ideas
- full audit log retained locally

## 8. Evaluation
- task success rate
- no unintended focus theft
- correct permission-denial handling
- recovery after UI changes
- deterministic tests with fixtures where possible

## 9. License
- core implementation is Cedian-owned
- macOS public APIs only
- MIT-only dependencies
- no proprietary/FSL code in core
