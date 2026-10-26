# Cedian

**Cedian** is an agentic IDE built on a VS Code fork, with **cedia** as the AI agent.
It combines VS Code's full IDE with cedia's multi-provider agent, Tern-style blocks,
a daemon-owned browser pane, and a multi-repo workspace.

## About

- **Product:** Cedian
- **Base:** VS Code fork (Electron + TypeScript), MIT portions retained
- **Agent:** cedia (unchanged, multi-provider)
- **Platform:** macOS 26 (Tahoe) only for v1
- **License:** Proprietary for Cedian-specific additions + MIT notice for VS Code portions
- **Status:** Scaffold + daemon moved in; VS Code fork not yet vendored (Phase A)

See `docs/CEDIAN_SPEC.md` for the full specification.

## Layout

- `daemon/` — Rust daemon (moved from the former `cedian` repo). Builds with Cargo.
  - `daemon/crates/` — cedian_daemon, cedian_protocol, cedian_index, cedian_wire, cedian_agent, cedian_review
- `src/` — TypeScript (blocks, agent pane, settings, browser panel, ...)
- `docs/` — `CEDIAN_SPEC.md` (design source), `ARCHITECTURE.md` (historical), `specs/`, `protocol/`
- `brand/`, `script/` — icons and generators (theme, icon, fetch-chromium, bundle-mac)

The daemon owns all state; this app is the viewer. They communicate over the Unix
socket `daemon.sock` (cedian_wire protocol).

## Build daemon

```sh
cd daemon && cargo build -p cedian-daemon
```

## Status

Scaffold + daemon moved in. VS Code fork not yet vendored (Phase A). See `docs/CEDIAN_SPEC.md` §11.
