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

## Phase B (one live thread, started 2026-10-28)
- [x] cedia's Phase B commands (cedia-code #153): `desktop.lock`, images on
  `threads send` and `threads fork`, `cedia inline-edit`; pin moved to that
  branch's head 39560d1 (protocol ff8c83a6b208152c), to move to cedia main
  once #153 merges
- [x] Daemon holds `~/.cedia/desktop.lock` while it serves (`cedia daemon`
  yields); `Request::Send` and a running thread's `Prompt` carry images;
  `Request::Fork` keeps the forked run's images unless the window names
  others; `Request::InlineEdit` answers `Notice::InlineEdit`
- [x] Window wire types generated from the Rust types
  (`cedian_wire/wire.schema.json` → `src/protocol/wire.ts`)
- [x] Window modules in `src/`, tested with vitest + happy-dom: daemon
  client (queue while down, watches re-sent on reconnect), composer (queue,
  Send now, `@`, `/`, images), live pane (view modes, context ring, ask card,
  todo, review hunks, Commit / open PR, cedia's four permission modes, model
  and effort chips, worktree), settings window (appearance, models, MCP,
  roots, editor, keys), Warm & Lime + `--cedian-*`, keybinding layer, inline
  edit
- [x] VS Code glue (`vscode/contrib/cedian`): main-process `cedianDaemon`
  channel (starts the daemon when none answers), live Agent view, review in
  the (multi-)diff editor, Cedian Settings editor, Cmd+K inline edit as a
  diff with รับ / ไม่เอา, `desktop` as VS Code defaults; type-checks with
  VS Code's `src/tsconfig.json` (0 errors)
- [x] Exit gate on the owner's Mac (macOS 26.6.2, arm64, 2026-10-28, at
  28e296d): `build-mac` 236 s; `npm run smoke` ok (daemon reached, four
  permission modes, accent on); `test/smoke/gate-b.mjs --model
  openrouter/claude-haiku-5-5` ok in 25 s: a worktree run, quit and reopen
  with the thread intact, review and accept, daemon killed and a new one
  rebuilt the thread and its review
- [x] cedia pin moved to cedia main 1b97cd5 (cedia-code #153 merged)
- [x] Phase B gaps closed after the gate (cedian #9, #10, checked on the
  Mac): a reopened thread's model and permission chips, pasted images,
  live `desktop.keymap`, and the window handing over from a daemon of
  another build

## Phase C (Parallel)
- [x] cedia pin moved to cedia main 8cb0358 at the start of the phase
  (cedia-code #158: multi-repo workspaces; schema unchanged)
- [x] Multi-repo, cedia side: `CEDIA_ROOTS` keys every root by the primary
  root's slug, `open_thread` takes a root of the workspace, a `--thread`
  run goes on in its root, the other roots are named read-only
- [x] Multi-repo, cedian side: the daemon passes `CEDIA_ROOTS` from
  `desktop.roots` (cedian #11)
- [x] Project chat, first pass (⌘0, the thread picker's first entry): the
  chat's first message starts the project's coordinator thread
  (`--profile coordinator`, in the project itself); the chat shows a card
  per thread it opened (state, todo progress and step, its question with
  answers as buttons, เปิด)
- [x] An archived thread keeps its card in the chat, last, as เก็บแล้ว (the
  daemon's auto-archive was already in place); thread search on ⌘T, a quick
  pick over the chat and every thread, archived last
- [x] Threads the coordinator opens run on the chat's model (the opener's
  writer model, cedian #12; checked on the Mac: 2 threads queued → done)
- [x] `@<thread> text` in the chat goes straight to that thread (its next
  run, or queued while it works); `@` at the start offers the coordinator's
  threads by title. Opened threads' worktrees are named from their titles
- [x] PR watch (owner, 2026-10-28): the daemon follows each thread's PR
  through `gh`; CI red, new review comments or a conflict become the
  thread's next run; PR chip on the header, the card and the search; a
  merged PR archives the thread (ARCHITECTURE, Phase C). Checked on the
  Mac with a real PR 2026-10-29: the daemon pushes the fix run's commits;
  CI going green is unchecked (the scratch repo's Actions would not
  start, a billing limit). Per-thread หยุดเฝ้า built 2026-10-29
- [x] Exit gate on the owner's Mac (macOS 26.6.2, arm64, 2026-10-29, at
  4505b92): `node test/smoke/gate-c.mjs <Cedian.app> --model
  openrouter/claude-haiku-5-5` ok. The coordinator opened three threads,
  one in the primary repo and two in the second root; all three worked at
  once, each in a worktree of its own repo, and each committed its change.
  Memory over 12 samples: the window peaked at 1164 MB (median 626), the
  daemon with its cedia runs at 1555 MB (median 744), 2181 MB together.
  Scrolling 10k blocks (36,665 nodes) in the live pane: median frame
  16.7 ms, p95 16.8 ms, worst 18.6 ms, none over 25 ms; drawn in 209 ms.
  The gate found and 77c4037 fixed a thread opened in another root never
  starting
- [x] The agent pane keeps what it drew (`ItemsView`, 2026-10-29): a notice
  on a 10k-block thread drew all of it again (209 ms on the owner's Mac,
  1.0 s in headless Chromium on Linux); now only the items that changed
  are drawn, 31 ms in that Chromium, measured by `test/smoke/scroll.mjs`
  (`updateMs`). An opened tool list stays open across notices

## Phase D (Media, depth, started 2026-10-29)
- [x] Pin moved to cedia main a5da949 (protocol 39028f3719326bb7); the
  only schema change is `plugin` as a command source
- [x] cedia: completion command (fill-in-the-middle on a fast cheap model):
  `cedia complete --file --at <line:col> [--stdin] --json` (cedia #180, merged
  2026-10-29, pinned at main b140712), on `roles.complete`, default the code model
- [x] cedia: prompt images route to a model that reads images; video frames
  (cedia-code #171: a video on `--image` or `read` comes as up to 8 frames
  where the screen changes; a run with images on a text-only model runs on
  `--media`, default Haiku 5.5). Pin at cedia main d609d53 (protocol
  094b076845b55b39), where #171 merged
- [x] Images and video in threads: the composer takes a video (picker,
  paste, drop) once cedia says `video`; the agent pane counts its frames
  as images. A pasted video checked on the Mac by gate-d
- [x] §3.9 `Notice::Text` (2026-10-29): a streaming block that only grew goes
  out as its new characters. `node test/smoke/scroll.mjs` streams 250 deltas
  onto a 10k-block thread in headless Chromium on Linux: 21 KB on the wire
  instead of 734 KB. Drawn per delta, median 5 ms, p95 14 ms either way:
  appending a text node to the drawn answer instead of drawing it again was
  tried and measured no faster (p95 9 ms to 14 ms over two runs each), so the
  pane draws the grown block as before
- [x] §3.9 credit flow control (2026-10-29, `cedian_daemon::flow`): the
  pane acks each blocks or text notice once its frame is painted; from a
  window's first ack of a thread, the daemon keeps at most 2 undrawn and
  merges the rest per view (appends to one block join, anything else resends
  from the first block touched), sent as one notice on the next ack. Tested
  against the fake cedia with a held run; not yet timed in the app
- [x] §3.9 `CEDIAN_WIRE_RECORD=<file>` on the daemon (2026-10-29): every
  request and notice of every window, one JSON line each with the client and
  its time, 0600. The daemon sees both directions, so the window records
  nothing itself. `node test/smoke/replay.mjs <file>` plays one window's
  notices into the pane at their times in Chromium and times the frames; on
  a synthetic 3k-block thread streaming 250 deltas at 50 a second: median
  frame 16.7 ms, 2 frames over 25 ms (the first draw)
- [ ] Line comments on diffs; `/code-review` card (built 2026-10-29, not yet
  tried in the app): a `+` beside the line under the pointer in a review diff
  opens a comment box (Enter adds, Cmd+Enter adds and sends all); the
  comments wait in the daemon (`Request::Comments`, kept per thread under its
  state dir) and show under their lines and on the pane's card, and go to the
  thread as one message (`SendComments`: queued while it runs, else a run
  under its last permission). `/code-review` runs `cedia review --thread
  --json` (capability `code-review`); the card groups the findings by file,
  Walk through opens each open one at its line, and each has Fix this one and
  Dismiss, in the card and under its line in the diff; Fix all sends the
  open ones. Tested in vitest and against the fake cedia; anchoring comments
  by hunk context (§11 Annotate AI Diff) is still to come
- [ ] Git pane (built 2026-10-29; Source Control and the Git card tried on
  the owner's Mac against local remotes, not yet against GitHub): VS Code's own
  Source Control follows the agent pane's open thread: `git.openRepository`
  on its worktree (else the project), then focused and pinned in the SCM
  view (`vscode/contrib/cedian/browser/sourceControl.ts`), so Changes,
  Commit, Pull, Push and the graph are the thread's; `git.detectWorktrees`
  lists every thread's worktree beside the project. In the thread, as the
  prototype draws it: a `⑂ <branch>` chip in the composer opens the Git
  card (`fix-login → origin/main · ahead 2 · behind 1`, uncommitted and
  unpushed counts, Pull and Push, Source Control), read and run by the
  daemon with hooks off (`Request::Git`, `Request::GitAction`,
  `cedian_daemon::git_state`). Pull autostashes and aborts a rebase that
  conflicts; opening the card fetches, off the window's reader thread with
  a 120 s limit and no credential prompt
- [ ] Review, merge and issues in Cedian (built 2026-10-29, not yet tried in
  the app), through the person's own `gh`, each action the command a person
  would type. The PR block under a thread's receipt (`pr-block.ts`,
  `cedian_daemon::pr_view`, one GraphQL read): description, comments and
  line-comment threads with their hunk (Reply, Resolve, Fix in thread,
  Apply suggestion in thread), Approve and Request changes on someone
  else's PR, + Reviewer, Checks with a failed run's log and Fix in thread,
  Commits, Files (the diff), and Merge with its blockers, method, Update
  branch, Ready for review and Merge when ready. `/prs` lists the
  repository's PRs (To review, Yours, All open); Review in a thread checks
  one out in a new worktree and reviews it read-only, and the PR watch never
  acts on someone else's PR. `/issues` (`issues.ts`,
  `cedian_daemon::issues`): search, Open / Closed / Assigned to me, an issue
  with labels, assignees, milestone, the PRs that close it and this
  project's thread on one, Comment, Close as completed or not planned,
  Reopen, New issue, and Start a thread, which fills a new thread's message
  asking its PR to say "Fixes #N"
- [ ] Pop-out panes; Help → Check for updates
- [x] Tab completion (ghost text) with a measured latency budget (built
  2026-10-29, tried in the app on the owner's Mac): an inline-completions
  provider for project files asks the daemon's `complete` 250 ms after typing
  stops, not mid-word; a newer ask stops the cedia answering the one before;
  Tab takes the ghost text; Settings → Editor → Tab completion turns it off
  (`editor.inlineSuggest.enabled`) and, while on, keeps the suggest list from
  opening over ghost text already shown
  (`editor.inlineSuggest.suppressSuggestions`); with the list open and part of
  the word typed, cedia is asked at the end of its pick and the ghost text
  goes on from it; right after `.` the list wins (its pick is only its first
  item) Budget, on the
  default `anthropic/claude-haiku-5-5`: `cedia complete` p95 under 2.5 s and
  no errors over 6 spots × 10 (measured at 5b34421: p50 1309 ms, p95 2159 ms,
  0/60 errors, about $0.00006 a call); pause to ghost text p50 1.8 s in the
  app. Ghost text showed, Tab took it, typing on cleared it and the toggle
  turned it off; the suggest list hiding it and a doubled `}` are fixed
  since and still to be tried again
- [ ] §13 gates: a11y, Thai, 3 error levels, telemetry off, legal review
  (2026-10-29, on the owner's Mac at cedian 9d14508 + the offline fix,
  cedia main b140712):
  - [x] Telemetry: `node test/smoke/offline.mjs <Cedian.app>` launches with
    VS Code's own telemetry and update defaults, edits a file and idles 90 s:
    no outside connection from the app, its daemon or cedia (lsof over the
    tree; nettop agrees). Crash reports stay in `~/Library/Logs/Cedian`
    (patch 0004; crashpad runs with that database, nothing uploaded)
  - [x] Thai: `node test/smoke/thai.mjs`, 16 cases at 4 pane widths, no
    mid-word break, line height 1.6; the editor moves by Thai words
    (`editor.wordSegmenterLocales`) and wraps prose with the browser's
    breaker
  - [x] Accessibility: each pane item is a labelled group ("You", "cedia",
    "2 tool calls, 1 failed", "Run ended: unverified 1"), read from
    Chromium's accessibility tree in the app; 2px accent focus ring and
    Reduce Motion in the pane and settings. VoiceOver itself not driven
  - [ ] Errors: the three levels are mapped (a modal when cedia can't run or
    speaks another protocol; errors inline in their own thread or the
    settings window; notifications for a review that can't open); no
    unhandled rejections in the window, no unwrap on client input in the
    daemon. The archive guard: `/archive` on a thread whose worktree has
    uncommitted changes asks "Archive anyway?" (cancel keeps them), and
    auto-archive leaves such a thread alone. Settings keeps a root a thread
    still works in ("A thread is using this root: <title>. Archive it
    first"). The review card says which hunks were changed since the agent
    wrote them ("1 changed since", "Changed since" on the file). Waiting on
    the browser pane, which the window does not have yet (the daemon only
    starts Chromium for cedia's runs): "Claude tools are off for this site",
    and the browser's transient errors as notifications
  - [ ] License: `python3 script/license-scan.py --app <Cedian.app>` passes
    (309 packages, no copyleft beyond the allowed jschardet); NOTICE ships
    in the app as `licenses/Cedian-NOTICE.txt` beside VS Code's LICENSE.txt
    and ThirdPartyNotices.txt. Legal review needs a person
- [x] Exit gate on the owner's Mac (2026-10-29, at 8057d79, cedia d609d53):
  `node test/smoke/gate-d.mjs <Cedian.app> --model
  openrouter/claude-haiku-5-5` ok. A page whose counter showed 2 with 3
  items listed was filmed (MP4, 5.5 s) and pasted into the composer with
  "the recording shows a bug; fix it". The writer, on Haiku 5.5, was shown
  5 frames (0:00.0, 0:01.0, 0:02.5, 0:04.0, 0:05.5) and changed basket.js
  so the counter reads the list's length; after two adds the page shows 2
  with 2 listed. In the live pane: scroll 10k blocks median 16.7 ms, p95
  18.5 ms, none over 25 ms; a 250-delta stream drawn median 11 ms, p95
  16.8 ms, 21 KB on the wire. The first run fixed the bug too, but the
  gate looked for frames under the original file name (a pasted video is
  saved under a UUID name); 8057d79 fixed the gate. playwright-core wanted
  Chromium 1248, so the run used the cached 1228 through `CEDIAN_CHROMIUM`
- [ ] cedia follow-up from the gate: the writer's `read` of the video was
  cut off ("not run: the plan arrived before this call ran") and never
  retried, and its answer then said the read tool rejects video files

## Known gaps
- 6 permissive-but-non-MIT transitive deps (typify ×4 build-only, foldhash
  ×2) are accepted under the permissive policy (spec §9, 2026-10-28); keep
  their attribution in THIRD_PARTY_NOTICES.md
