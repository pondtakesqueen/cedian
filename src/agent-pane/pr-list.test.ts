// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { PrList, PrSummary } from "../protocol/wire";
import { firstTab, prListCard } from "./pr-list";

const pr = (over: Partial<PrSummary>): PrSummary => ({ number: 11, url: "u11", title: "Cache the CSV", author: "ton-s", head: "csv", base: "main", draft: false, additions: 84, deletions: 12, ci: "passing", review_requested: true, ...over });
const list: PrList = { to_review: [pr({})], mine: [], open: [pr({}), pr({ number: 10, title: "Drop Node 18", draft: true, ci: "pending", review_requested: false })] };

describe("Pull requests card", () => {
  it("opens on what waits on the person, and reviews one in a thread", () => {
    expect(firstTab(list)).toBe("to_review");
    expect(firstTab({ to_review: [], mine: [], open: list.open })).toBe("open");
    const asked: string[] = [];
    const card = prListCard(document, list, "to_review", { tab: (t) => asked.push(t), review: (n) => asked.push(`review ${n}`), openUrl: (u) => asked.push(u), close: () => asked.push("close") });
    expect(card.textContent).toContain("To review 1");
    expect(card.textContent).toContain("#11 Cache the CSV");
    expect(card.textContent).toContain("ton-s · csv → main · +84 −12 · review requested from you");
    [...card.querySelectorAll("button")].find((b) => b.textContent === "Review in a thread")!.click();
    [...card.querySelectorAll("button")].find((b) => b.textContent === "All open 2")!.click();
    expect(asked).toEqual(["review 11", "open"]);
    const all = prListCard(document, list, "open", { tab: () => {}, review: () => {}, openUrl: () => {}, close: () => {} });
    expect(all.textContent).toContain("Draft");
    expect(all.textContent).toContain("● running");
  });

  it("says why there is no list", () => {
    const card = prListCard(document, "gh: not logged in", "open", { tab: () => {}, review: () => {}, openUrl: () => {}, close: () => {} });
    expect(card.textContent).toContain("gh: not logged in");
  });
});
