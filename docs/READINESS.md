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

## Before VS Code fork
- [ ] Confirm VS Code version to fork
- [ ] Document vendoring steps
- [ ] Decide module ownership between Rust daemon and TS UI
- [ ] Add smoke test for TS entrypoint
- [ ] Add license scan to CI
- [ ] Review `cedian_wire` module boundaries
- [ ] Decide whether to split computer-use spec into its own file

## Known gaps
- `src/` has no implementation yet
- no E2E tests yet
- no license scan tooling yet
- docs are long; may need indexing/splitting
