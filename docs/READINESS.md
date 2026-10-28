# Cedian readiness checklist (pre-fork)

## Done
- [x] Daemon builds (`cargo build -p cedian_daemon`)
- [x] Rust tests pass (`cargo test --workspace`)
- [x] TypeScript compiles (`npm run lint`)
- [x] Test runner passes with no tests (`npm test`)
- [x] `.DS_Store` clutter removed
- [x] `src/` skeleton created
- [x] docs index added
- [x] third-party notices baseline added
- [x] CI workflow added
- [x] macOS 26 baseline documented
- [x] computer-use research preview spec added
- [x] MIT-only license policy documented
- [x] Zed/GPUI deps removed from daemon (`util::shell_env` → in-house
  `shell_env.rs`, workspace deps trimmed, `[patch.crates-io]` dropped;
  the daemon links no GPL code)
- [x] License scan in CI (`script/license-scan.py`)
- [x] TS entrypoint smoke test (`src/index.test.ts`)
- [x] Conflict sweep 2026-10-26 (8 fixed): spec §5.3 worktree path → in-repo
  `.cedian/worktrees` (matches code); `script/pin-cedia` dest → `daemon/`;
  `script/themes/cedian.py` refuses Zed-era write (Phase B retarget);
  `script/bundle-mac` marked pre-pivot (Phase D retarget);
  THIRD_PARTY drop "(when added)"; LICENSE/NOTICE identity + VS Code
  timing fixed; spec §6 CLI matches `--print=`/`--` reality; CI pins
  toolchain 1.98.1; `daemon/LICENSE` symlink so workspace license-file
  resolves

## Before VS Code fork
- [x] Confirm VS Code version to fork (`1.143.1`, latest stable 2026-10-26;
  see `docs/VENDORING.md`)
- [x] Document vendoring steps (`docs/VENDORING.md`)
- [x] Decide module ownership between Rust daemon and TS UI (table in
  `docs/CEDIAN_SPEC.md` §9)
- [x] Review `cedian_wire` module boundaries (clean: types + framing + paths
  only; review 2026-10-26 found no changes needed)
- [x] Decide whether to split computer-use spec into its own file (yes:
  `docs/specs/COMPUTER_USE_SPEC.md`, §14 is now a pointer)

## Phase 0 (spec settle, 2026-10-28)
- [x] Owner decisions Q1–Q12 + review applied to `docs/CEDIAN_SPEC.md`:
  cedia's four permission modes; cedian daemon runs threads under a lock
  `cedia daemon` yields to; permissive licenses; full Tern parity in v1;
  primary root's slug keys a multi-repo project; browser allowlist only
  (localhost by default); Cedian settings window; roadmap in §11; budgets
  measured against stock VS Code; `.cedia/launch.json` first; cedia pin
  bumped each phase; upstream merges rare; tab completion + inline edit in v1
- [x] Stray `EOF`/`echo done` lines removed from two spec drafts

## Phase A go/no-go (2026-10-28)
- [x] Phase 0 merged (cedian #1, #2; cedia-code #150, #151); history kept
- [x] cedia pin bumped to cedia main be2a523 (protocol 19b13053b4771393);
  `docs/protocol/` copy dropped, the pinned schema is the only one
- [x] App icon PR (#3) merged before vendoring step 2
- [x] Structured agent events on the wire: the daemon folds cedia's lines
  with `cedian_agent` and sends `Notice::Blocks` (blocks from an index on);
  `Notice::Line` is gone
- [x] Agent pane (`src/agent-pane/`) replays cedia's fixtures from the
  blocks the fold records (`cedian_agent/tests/replay/*.blocks.json`)
- [x] Exit gate on the owner's Mac (macOS 26.6.2, arm64, 2026-10-28):
  Cedian.app built from `script/vscode/prepare` + `build-mac`; smoke drew
  `edit-and-check` with a verified receipt and no AI chat
  (`docs/budgets/phase-a-smoke.png`); `cargo test --workspace` 106 passed,
  vitest 30/30; budgets recorded (`docs/budgets/`): cold start 1581 ms
  stock vs 1544 ms Cedian, idle memory 1754 MB vs 1324 MB, keystroke 16.6 ms
  both (one frame: Playwright cannot resolve it; the HID + pixel harness is
  still to build)
- [x] App license scan: BlueOak-1.0.0 (tar, minipass, chownr, yallist,
  lru-cache) and CC-BY-4.0 (@vscode/codicons) accepted as permissive;
  `jschardet` (LGPL-2.1+) allowed by name as the owner's exception

## Known gaps
- no E2E tests yet (Playwright smoke is a Phase A exit item)
- 6 permissive-but-non-MIT transitive deps (typify ×4 build-only, foldhash
  ×2) are accepted under the permissive policy (spec §9, 2026-10-28); keep
  their attribution in THIRD_PARTY_NOTICES.md
