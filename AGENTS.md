# cedian rules

- Read `docs/CEDIAN_SPEC.md` before changing anything; it is the only design source (supersedes `docs/ARCHITECTURE.md`, which is retained for historical detail).
- cedian is a VS Code fork (Electron + TypeScript) with a Rust daemon. The daemon reuses Rust crates (cedian_daemon, cedian_protocol, cedian_index, cedian_wire); the UI is TypeScript. Do not vendor or fork VS Code's marketplace; use Open VSX.
- cedia is the agent. Never add an agent loop, a model client or a tool that duplicates one of cedia's; a missing agent capability is a change in the `cedia` repo.
- `~/.cedia/settings.json` is the only settings file. cedian reads and writes its `desktop` key and never keeps a copy.
- The daemon owns all state. The window is a viewer and holds nothing the daemon cannot rebuild.
- cedia's thread and session files are append-only and cedia's to write; cedian only reads and indexes them.
- One crate per area (`cedian_<area>`), one file per concept, no `mod.rs`.
- No `unwrap()` outside tests; propagate errors with `?` or log them.
- A decision that changes `docs/ARCHITECTURE.md` updates it in the same change.
