// cedia's model settings as the settings window shows them (spec §7.1, "Models (cedia's keys,
// edited through schema)"). The window never writes these keys: each change is one `set_cedia`,
// which the daemon hands to `cedia settings set|unset`, and cedia checks the value as a run would
// read it before it writes.
import type { EditableSettings, Effort } from "../protocol/wire.js";

export type RoleName = keyof EditableSettings["roles"];

export interface RoleRow {
  role: RoleName;
  label: string;
  hint: string;
  /** Whether `claude-code[:<model>][@<effort>]` is offered (plan and review only). */
  claudeCode?: boolean;
  /** Whether `none` turns the role off. */
  none?: boolean;
}

export const ROLE_ROWS: RoleRow[] = [
  { role: "code", label: "Code", hint: "The writer's model where a thread names none (background runs, schedules); the picker above wins for new threads" },
  { role: "plan", label: "Plan", hint: "A model that plans before the writer starts; ref@effort sets its effort", claudeCode: true, none: true },
  { role: "review", label: "Review", hint: "A model that reviews the writer's work before it ends", claudeCode: true, none: true },
  { role: "triage", label: "Triage", hint: "Says whether a message needs the planner" },
  { role: "advisor", label: "Advisor", hint: "Reads each writer turn and may leave a note; costs one reply a turn", none: true },
  { role: "classifier", label: "Classifier", hint: "Reads each command no allow rule names and may block it", none: true },
  { role: "swarm", label: "Explore", hint: "The model of explore sub-threads" },
  { role: "workers", label: "Workers", hint: "Other models a split plan's parts may run on, comma-separated", none: true },
  { role: "complete", label: "Tab completion", hint: "The model tab completion asks; pick a fast one" },
];

export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** What a role takes while it is unset, as cedia reads it. */
export function roleDefault(s: EditableSettings, role: RoleName): string {
  switch (role) {
    case "code":
      return s.defaults.code;
    case "swarm":
      return s.defaults.swarm;
    case "triage":
    case "complete":
      return "the code model";
    default:
      return "off";
  }
}

/** The values a role's box suggests: the models, then the words that role takes. */
export function roleSuggestions(row: RoleRow, models: string[]): string[] {
  const out = [...models];
  if (row.claudeCode) out.push("claude-code", "claude-code:opus@medium", "claude-code:sonnet@high");
  if (row.none) out.push("none");
  return out;
}

/** A box's text as the change to send: empty unsets the key. */
export function changeOf(key: string, text: string): { op: "set_cedia"; key: string; value?: string } {
  const value = text.trim();
  return value ? { op: "set_cedia", key, value } : { op: "set_cedia", key };
}

/** onQuota's choices, with the file's own value kept when it is not one of them. */
export function quotaOptions(current: string | null | undefined): { value: string; label: string }[] {
  const out = [
    { value: "", label: "Fall back at once (default)" },
    ...[15, 30, 60, 120].map((m) => ({ value: `wait:${m}`, label: `Wait up to ${m} minutes, then fall back` })),
  ];
  if (current && !out.some((o) => o.value === current)) out.push({ value: current, label: current });
  return out;
}

/** The fallback rows: the code model's first, then every other model the file names. */
export function fallbackRows(s: EditableSettings, codeModel: string): { model: string; value?: string; fallbackDefault?: string }[] {
  const rows = [{ model: codeModel, value: s.fallback[codeModel], fallbackDefault: s.defaults.fallback[codeModel] }];
  for (const [model, value] of Object.entries(s.fallback)) {
    if (model !== codeModel) rows.push({ model, value, fallbackDefault: s.defaults.fallback[model] });
  }
  return rows;
}
