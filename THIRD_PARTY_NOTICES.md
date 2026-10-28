# Third-party notices

Cedian includes third-party components. Their licenses are preserved in their
original locations and/or in `daemon/` dependency manifests.

- VS Code portions: MIT (see `NOTICE`)
- Rust crate dependencies: see `daemon/Cargo.lock`
- TypeScript dependencies: see `package-lock.json`

Cedian.app also ships the npm packages of VS Code 1.143.1, listed with their
licenses in the app's own `ThirdPartyNotices.txt`. `python3
script/license-scan.py --app <Cedian.app>` lists the non-MIT ones. Among them:

- BlueOak-1.0.0: tar, minipass, chownr, yallist, lru-cache
- CC-BY-4.0: @vscode/codicons (icons; attribution to Microsoft)
- LGPL-2.1+, an exception the owner allowed (2026-10-28): jschardet, VS Code's
  file-encoding guesser, shipped unmodified as its own module. Source:
  https://github.com/aadsm/jschardet. Its license text ships with the module in
  the app; anyone may replace that module with their own build of it.

Only permissively licensed code (MIT, BSD, Apache-2.0, ISC and the like) may
be included; Apache-2.0 components keep their NOTICE. See
`docs/CEDIAN_SPEC.md` §9.
