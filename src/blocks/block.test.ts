import { describe, expect, test } from "vitest";
import { moveBlock, type BlockMove, type BlockState } from "./block.js";

describe("block states (spec §4.4)", () => {
  test("closed → open → focused → zoomed | parked | torn-off → closed", () => {
    const walk = (moves: BlockMove[]) => moves.reduce<BlockState>(moveBlock, "closed");
    expect(walk(["open", "focus", "zoom"])).toBe("zoomed");
    expect(walk(["open", "focus", "park", "restore"])).toBe("focused");
    expect(walk(["open", "focus", "tear-off", "close"])).toBe("closed");
    expect(walk(["open", "focus", "blur"])).toBe("open");
  });
  test("a move that does not apply leaves the state", () => {
    expect(moveBlock("closed", "zoom")).toBe("closed");
    expect(moveBlock("open", "park")).toBe("open");
    expect(moveBlock("zoomed", "park")).toBe("zoomed");
  });
});
