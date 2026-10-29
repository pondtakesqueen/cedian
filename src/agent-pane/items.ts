// Blocks grouped into what the agent pane draws (the prototype's conversation column): a run
// of tool calls is one line, a handoff is a divider, a receipt sums up its checks.
import type { ResultSubtype } from "../protocol/cedia.js";
import type { Block, ToolCall } from "./block.js";

export interface ToolRow {
  name: string;
  /** What the call acted on: its command, path or pattern. */
  detail: string;
  failed: boolean;
}

export interface Check {
  command: string;
  exitCode: number;
}

export type Item =
  | { k: "divider"; text: string }
  | { k: "user"; text: string; images: number }
  | { k: "think"; text: string; seconds: number | null; streaming: boolean }
  | { k: "answer"; text: string; streaming: boolean }
  | { k: "tools"; calls: ToolRow[]; running: boolean; failure: string | null }
  | {
      k: "receipt";
      subtype: ResultSubtype;
      verified: boolean;
      unverified: number;
      verdict: string;
      turns: number;
      seconds: number | null;
      costUsd: number;
      checks: Check[];
    };

export function items(blocks: Block[]): Item[] {
  const out: Item[] = [];
  let sessions = 0;
  for (const block of blocks) {
    switch (block.kind) {
      case "session":
        // The first session is the thread itself; a later one is a handoff or another role.
        if (sessions++ > 0 || block.role !== "code") {
          out.push({ k: "divider", text: `${block.role} · ${block.model}` });
        }
        break;
      case "user":
        out.push({ k: "user", text: shownText(block.text), images: block.images.length });
        break;
      case "thinking":
        out.push({
          k: "think",
          text: block.text,
          seconds: block.ms === null ? null : Math.max(1, Math.round(block.ms / 1000)),
          streaming: block.streaming,
        });
        break;
      case "text":
        out.push({ k: "answer", text: block.text, streaming: block.streaming });
        break;
      case "tool": {
        const last = out[out.length - 1];
        const group =
          last?.k === "tools" ? last : { k: "tools" as const, calls: [], running: false, failure: null };
        if (group !== last) out.push(group);
        const failed = toolFailed(block);
        group.calls.push({ name: block.name, detail: detail(block), failed });
        group.running ||= block.state !== "done";
        if (failed && group.failure === null) group.failure = failure(block);
        break;
      }
      case "result": {
        const evidence = block.evidence;
        const unverified = (evidence?.unverified.length ?? 0) + (evidence?.flags?.length ?? 0);
        out.push({
          k: "receipt",
          subtype: block.subtype,
          // As `cedian_agent::Block::verified`: a success whose evidence leaves nothing open.
          verified: block.subtype === "success" && evidence !== null && unverified === 0,
          unverified,
          verdict: block.text,
          turns: block.turns,
          seconds: block.wall_ms === null ? null : Math.round(block.wall_ms / 1000),
          costUsd: block.cost_usd,
          checks: (evidence?.checks ?? []).map((c) => ({ command: c.command, exitCode: c.exitCode })),
        });
        break;
      }
    }
  }
  return out;
}

/** As `cedian_agent::ToolCall::failed`: it ran and failed, was refused, or never finished. */
export function toolFailed(call: ToolCall): boolean {
  return (
    call.is_error ||
    (call.state === "done" && call.status !== "completed") ||
    call.permission?.allowed === false
  );
}

function detail(call: ToolCall): string {
  for (const key of ["command", "path", "pattern", "url", "question", "task"]) {
    const value = call.input[key];
    if (typeof value === "string") return value.split("\n")[0];
  }
  return "";
}

function failure(call: ToolCall): string {
  if (call.permission?.allowed === false) {
    return `denied by ${call.permission.rule}${call.permission.reason ? `: ${call.permission.reason}` : ""}`;
  }
  const output = call.output ?? (call.state === "done" ? call.status : "");
  return output.split("\n").slice(-6).join("\n");
}

/**
 * The person's message as they wrote it: cedia adds a `<plan-pending>` note for the model while a
 * plan is being written, which is not theirs to see or to have read out.
 */
export function shownText(text: string): string {
  return text.replace(/\s*<plan-pending\b[^>]*>[\s\S]*?<\/plan-pending>\s*/g, "\n").trim();
}
