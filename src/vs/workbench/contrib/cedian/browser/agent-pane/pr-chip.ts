// The chip for a thread's pull request while the daemon follows it (ARCHITECTURE, Phase C
// "Watching a thread's pull request"): `#13` and where it stands, on the thread's header and
// its card in the project chat. A click opens the PR.
import type { PrChip } from "../protocol/wire.js";

export type PrTone = "ok" | "bad" | "wait" | "done";

/** What the chip says after the number, and its color. */
export function prLabel(pr: PrChip): { text: string; tone: PrTone } {
  if (pr.state === "merged") return { text: "merged", tone: "done" };
  if (pr.state === "closed") return { text: "closed", tone: "done" };
  const fixing = pr.fixing ? " · fixing" : "";
  if (pr.conflict) return { text: `conflict${fixing}`, tone: "bad" };
  if (pr.ci === "failing") return { text: `CI failing${fixing}`, tone: "bad" };
  if (pr.ci === "pending") return { text: "CI running", tone: "wait" };
  if (pr.review === "changes_requested") return { text: `changes requested${fixing}`, tone: "bad" };
  if (pr.review === "review_required") return { text: "review required", tone: "wait" };
  if (pr.ci === "passing") return { text: "CI passing", tone: "ok" };
  return { text: "open", tone: "wait" };
}

/** `#13 · CI failing · fixing`. */
export function prText(pr: PrChip): string {
  return `#${pr.number} · ${prLabel(pr).text}`;
}
