# cedian-app rules

Design source: /Users/pond/cedian/CEDIAN_SPEC.md (read before changing anything).
Architecture history: /Users/pond/cedian/docs/ARCHITECTURE.md (superseded).

- cedian is a VS Code fork (Electron + TypeScript) with a Rust daemon.
- The daemon (in /Users/pond/cedian) owns all state; this app is a viewer.
- Communicate with daemon over Unix socket daemon.sock (cedian_wire protocol).
- Never add an agent loop, model client, or tool duplicating cedia's.
- ~/.cedia/settings.json is the only settings file; read/write its desktop key.
- No telemetry; crash logs local.
