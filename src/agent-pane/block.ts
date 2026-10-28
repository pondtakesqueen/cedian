// The agent pane's blocks as the daemon sends them (`cedian_agent::Block`, folded from cedia's
// stream in Rust; `Notice::Blocks` on `cedian_wire`). Kept by hand next to the Rust types:
// `isBlock` checks every recorded fixture's blocks, so a change on either side fails a test.
import type { EffectStatus, Evidence, ImageRef, ResultSubtype } from "../protocol/cedia";

export type ToolState =
  | { state: "requested" }
  | { state: "running" }
  | { state: "done"; status: EffectStatus };

export interface Permission {
  allowed: boolean;
  rule: string;
  reason: string | null;
}

export type ToolCall = {
  call_id: string;
  name: string;
  input: Record<string, unknown>;
  permission: Permission | null;
  output: string | null;
  is_error: boolean;
  exit_code: number | null;
  started_at: string | null;
  ms: number | null;
} & ToolState;

export type Block =
  | { kind: "session"; model: string; role: string }
  | { kind: "user"; text: string; images: ImageRef[] }
  | { kind: "text"; text: string; streaming: boolean }
  | { kind: "thinking"; text: string; streaming: boolean; ms: number | null }
  | ({ kind: "tool" } & ToolCall)
  | {
      kind: "result";
      subtype: ResultSubtype;
      text: string;
      cost_usd: number;
      turns: number;
      wall_ms: number | null;
      evidence: Evidence | null;
    };

const KEYS: Record<Block["kind"], string[]> = {
  session: ["model", "role"],
  user: ["text", "images"],
  text: ["text", "streaming"],
  thinking: ["text", "streaming", "ms"],
  tool: [
    "call_id",
    "name",
    "input",
    "permission",
    "output",
    "is_error",
    "exit_code",
    "started_at",
    "ms",
    "state",
  ],
  result: ["subtype", "text", "cost_usd", "turns", "wall_ms", "evidence"],
};

/** True when `value` has exactly the keys its kind of block has. */
export function isBlock(value: unknown): value is Block {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !(kind in KEYS)) return false;
  const want = new Set(["kind", ...KEYS[kind as Block["kind"]]]);
  if (kind === "tool" && (value as { state?: unknown }).state === "done") want.add("status");
  const have = Object.keys(value);
  return have.length === want.size && have.every((key) => want.has(key));
}
