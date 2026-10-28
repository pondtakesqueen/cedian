import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs script with no types
import { generate } from "../../script/protocol-types.mjs";

describe("cedia protocol types", () => {
  it("are generated from the pinned schema", async () => {
    const current = readFileSync(new URL("./cedia.ts", import.meta.url), "utf8");
    expect(current).toBe(await generate());
  });
});
