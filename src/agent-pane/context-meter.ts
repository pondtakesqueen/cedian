// The header's context ring (spec §3.1 "Context usage ring", §3.7 Session details): the tokens
// in the context after the latest turn, against the model's window from `cedia models`.
import type { ModelList } from "../protocol/wire.js";

export interface ContextMeter {
  tokens: number;
  window: number;
  /** 0 to 100, rounded down. */
  percent: number;
  /** Past 80%: the next turns may hand off (cedia's handoff point is near). */
  high: boolean;
}

export function contextMeter(tokens: number | undefined, model: string | undefined, models: ModelList | undefined): ContextMeter | undefined {
  if (tokens === undefined || model === undefined) return undefined;
  const entry = models?.models.find((m) => m.ref === model || m.ref.endsWith(`/${model}`));
  const window = entry?.contextWindow;
  if (!window || window <= 0) return undefined;
  const percent = Math.min(100, Math.floor((tokens / window) * 100));
  return { tokens, window, percent, high: percent >= 80 };
}

/** `76k / 200k`, as the ring's title says it. */
export function meterLabel(meter: ContextMeter): string {
  const k = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`);
  return `context ${k(meter.tokens)} / ${k(meter.window)}`;
}

/** The ring's arc for an SVG circle of radius `r`: the dash length and the gap. */
export function ringDash(meter: ContextMeter, r = 6): string {
  const length = 2 * Math.PI * r;
  const on = (length * meter.percent) / 100;
  return `${on.toFixed(2)} ${(length - on).toFixed(2)}`;
}
