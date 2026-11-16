// The agent pane's view modes (spec §9, prototype `VIEWS`): answers only, answers with thinking,
// or every tool call too. A chip in the header and Ctrl+O cycle them; the default is
// `desktop.view_mode`.
import type { Block } from "./block.js";

export type ViewMode = "answers" | "thinking" | "all";

export const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: "answers", label: "Answers" },
  { mode: "thinking", label: "+ Thinking" },
  { mode: "all", label: "All tools" },
];

export function nextViewMode(mode: ViewMode): ViewMode {
  const at = VIEW_MODES.findIndex((v) => v.mode === mode);
  return VIEW_MODES[(at + 1) % VIEW_MODES.length]!.mode;
}

/** `desktop.view_mode`, or answers when it is missing or not a mode. */
export function viewModeOf(value: unknown): ViewMode {
  return VIEW_MODES.some((v) => v.mode === value) ? (value as ViewMode) : "answers";
}

/**
 * The blocks a mode shows. Answers keep what the person reads to follow the work: their own
 * messages, the answers, sessions and receipts, and a failed or running tool call (something
 * they may need to act on); thinking adds the thinking; all keeps every block.
 */
export function visibleBlocks(blocks: Block[], mode: ViewMode): Block[] {
  if (mode === "all") return blocks;
  return blocks.filter((block) => {
    switch (block.kind) {
      case "thinking":
        return mode === "thinking";
      case "tool":
        return block.is_error || block.state !== "done";
      default:
        return true;
    }
  });
}

/**
 * The blocks without cedia's routing sessions: `triage` decides whether a message needs the
 * planner (its prompt is the message framed for it, its answer a word such as DIRECT), so it
 * is cedia's own step, not part of the conversation, in every mode.
 */
export function withoutTriage(blocks: Block[]): Block[] {
  const out: Block[] = [];
  let skipping = false;
  let answered = false;
  for (const block of blocks) {
    if (block.kind === "session") {
      skipping = block.role === "triage";
      answered = false;
    } else if (skipping && answered && block.kind !== "text") {
      // A run that goes on with the thread's writer session writes no new session line, so
      // triage ends with its answer, not with the next session.
      skipping = false;
    }
    if (skipping && block.kind === "text") answered = true;
    if (!skipping) out.push(block);
  }
  return out;
}
