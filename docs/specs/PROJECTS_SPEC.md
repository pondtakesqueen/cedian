# Claude Projects — behaviour spec (RE'd from public docs, 2026-10-25)

Source: https://code.claude.com/docs/en/claude-projects (public docs; no code copied).
This spec captures the behaviour cedian's multi-repo workspace work should match.

## What a project is

One ongoing conversation where a coordinator (Claude) routes a stream of related
tasks. The person sends work to one place; the coordinator decides what becomes a
thread and what gets answered in place. Threads are the workers: separate sessions,
each with its own context window, working on its own branch/PR, reporting back.

## Parts

- **Project conversation**: one long-running coordinator session. Sees what threads
  report back, not every step. Routes each person message.
- **Threads**: workers. Each is a full session; does one piece; reports back when
  done. A cloud thread works on its own branch and opens a PR.
- **Overview**: tracks all threads by state (Ready for review, Waiting on you,
  Working, Landing, Idle, Resolved) plus Library, Pull requests, Scheduled tasks.
- **Standing context**: project memory (notes Claude keeps), project instructions
  (brief every thread starts from, up to 16k chars), repositories/files/environment.

## Routing rules (coordinator)

For each message the person sends in the conversation:
1. A quick question → answer in place, no thread.
2. New work → a new thread, or pass to the thread already working in that area.
   Coordinator says which. Several unrelated tasks in one message → separate threads.
3. Follow-up to a thread → route to that thread (only when coordinator matches it).
4. If the person says "answer here instead of starting a thread", do so.

The person can tune: propose threads before starting, run at most N at a time,
reuse existing threads for follow-ups, shorter updates, don't open PR until seen.

## Thread lifecycle

queued → working → (done | failed | stopped | asking | interrupted)
- `asking`: run ended on a question for the owner; answer is the next prompt.
- Auto-archive: when done + verified + no hunks left to review → archived
  (unless failed/interrupted/unverified/asking/has hunks).

## Shared context given to every new thread

- Project repositories and files, instructions, memory
- Each repo's CLAUDE.md (root only, not skills/settings/mcp)
- Connectors on the account
- Cloud environment (network, env vars, secrets, tools)

## Models/effort

Coordinator model+effort and thread model+effort set separately. New project runs
Opus everywhere (high effort threads, low effort coordinator). Threads compact
automatically; conversation works from recent messages/threads/memory.

## Multi-repo ("one goal across many repositories")

Claude can run a thread per repository, each with its own PR. Overview shows which
are ready for review. cedian maps this to: one coordinator, many roots, one thread
per root in its own worktree.

## What cedian does NOT replicate

Cloud sessions (run while laptop closed), GitHub App, cloud environments,
connectors, multi-user sharing, mobile app. cedian stays local-first and
single-owner; roots are local checkouts; cedia owns thread files.

## Three test inputs (from the docs)

1. "Fix the flaky login test." → single new thread (one task, fits a session).
2. "What's the status of the open threads?" → answer in place (quick question).
3. A batch: "Bring every service up to the new lint config." → one thread per
   repository, each with its own PR.
EOF
echo done