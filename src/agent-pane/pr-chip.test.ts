import { describe, expect, it } from "vitest";
import type { PrChip } from "../protocol/wire";
import { prLabel, prText } from "./pr-chip";

const pr = (over: Partial<PrChip>): PrChip => ({ number: 13, url: "u", state: "open", ci: "none", conflict: false, review: null, fixing: false, ...over });

describe("PR chip", () => {
  it("says what is owed first: merged, a conflict, a red CI, then the review", () => {
    expect(prLabel(pr({ state: "merged", ci: "failing" }))).toEqual({ text: "merged", tone: "done" });
    expect(prLabel(pr({ conflict: true, ci: "failing", fixing: true }))).toEqual({ text: "conflict · fixing", tone: "bad" });
    expect(prLabel(pr({ ci: "failing" }))).toEqual({ text: "CI failing", tone: "bad" });
    expect(prLabel(pr({ ci: "pending" }))).toEqual({ text: "CI running", tone: "wait" });
    expect(prLabel(pr({ ci: "passing", review: "review_required" }))).toEqual({ text: "review required", tone: "wait" });
    expect(prLabel(pr({ ci: "passing", review: "approved" }))).toEqual({ text: "CI passing", tone: "ok" });
    expect(prText(pr({ ci: "passing" }))).toBe("#13 · CI passing");
  });
});
