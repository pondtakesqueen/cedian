import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs script with no types
import { generate, generateWire } from "../../script/protocol-types.mjs";

describe("protocol types", () => {
  it("cedia's are generated from the pinned schema", async () => {
    const current = readFileSync(new URL("./cedia.ts", import.meta.url), "utf8");
    expect(current).toBe(await generate());
  });

  it("the wire's are generated from the daemon's wire schema", async () => {
    const current = readFileSync(new URL("./wire.ts", import.meta.url), "utf8");
    expect(current).toBe(await generateWire());
  });
});
