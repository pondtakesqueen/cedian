import { describe, expect, it } from "vitest";

describe("entrypoint", () => {
  it("loads", async () => {
    await expect(import("./index")).resolves.toBeDefined();
  });
});
