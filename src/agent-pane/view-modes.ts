// The agent pane's view modes (spec §9, prototype `VIEWS`): answers only, answers with thinking,
// or every tool call too. A chip in the header and Ctrl+O cycle them; the default is
// `desktop.view_mode`.
import type { Block } from "./block.js";

export type ViewMode = "answers" | "thinking" | "all";

export const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: "answers", label: "คำตอบ" },
  { mode: "thinking", label: "+ ความคิด" },
  { mode: "all", label: "ทุก tool" },
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
