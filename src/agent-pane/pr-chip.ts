// The chip for a thread's pull request while the daemon follows it (ARCHITECTURE, Phase C
// "Watching a thread's pull request"): `#13` and where it stands, on the thread's header and
// its card in the project chat. A click opens the PR.
import type { PrChip } from "../protocol/wire.js";

export type PrTone = "ok" | "bad" | "wait" | "done";

/** What the chip says after the number, and its color. */
export function prLabel(pr: PrChip): { text: string; tone: PrTone } {
  if (pr.state === "merged") return { text: "merge แล้ว", tone: "done" };
  if (pr.state === "closed") return { text: "ปิดแล้ว", tone: "done" };
  const fixing = pr.fixing ? " · กำลังแก้" : "";
  if (pr.conflict) return { text: `มี conflict${fixing}`, tone: "bad" };
  if (pr.ci === "failing") return { text: `CI ไม่ผ่าน${fixing}`, tone: "bad" };
  if (pr.ci === "pending") return { text: "CI กำลังรัน", tone: "wait" };
  if (pr.review === "changes_requested") return { text: `ขอให้แก้${fixing}`, tone: "bad" };
  if (pr.review === "review_required") return { text: "รอรีวิว", tone: "wait" };
  if (pr.ci === "passing") return { text: "CI ผ่าน", tone: "ok" };
  return { text: "เปิดอยู่", tone: "wait" };
}

/** `#13 · CI ไม่ผ่าน · กำลังแก้`. */
export function prText(pr: PrChip): string {
  return `#${pr.number} · ${prLabel(pr).text}`;
}
