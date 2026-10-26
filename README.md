# cedian-app

VS Code fork (Electron + TypeScript) for **Cedian** — the UI half of the agentic IDE.

The agent and all state live in the Rust daemon in the sibling `cedian` repo
(`/Users/pond/cedian`). This app is the viewer: it talks to `cedian-daemon` over
the Unix socket `daemon.sock` and renders blocks, the agent pane, settings, etc.

Design source of truth: `/Users/pond/cedian/CEDIAN_SPEC.md` (and `AGENTS.md` there).
Architecture history: `/Users/pond/cedian/docs/ARCHITECTURE.md` (superseded).

## Layout (planned)

- `src/` — TypeScript (blocks, agent pane, settings, browser panel, ...)
- `docs/` — app-specific notes
- (VS Code fork source will be vendored here when the fork is taken)

## Status

Scaffold only. VS Code fork not yet vendored. See CEDIAN_SPEC.md §11.
