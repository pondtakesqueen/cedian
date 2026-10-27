import { describe, expect, it } from "vitest";
import { cedianExports, claudeExports, fromTemplate, isBeta } from "./kinds";
import {
  checkStore,
  needsPublish,
  shouldBeArtifact,
  templateAllowed,
} from "./policy";

describe("artifact trigger (recovered: >15 lines + reusable + standalone + referable)", () => {
  const content = (lines: number) => ({
    lines,
    explicitRequest: false,
    template: null,
    reusable: true,
    standalone: true,
    referable: true,
    capabilityEnabled: true,
  });

  it("treats 15 lines as inline and 16 as an artifact", () => {
    expect(shouldBeArtifact(content(15))).toBe(false);
    expect(shouldBeArtifact(content(16))).toBe(true);
  });

  it("requires every content flag without an explicit ask", () => {
    for (const flags of [
      { reusable: false, standalone: true, referable: true },
      { reusable: true, standalone: false, referable: true },
      { reusable: true, standalone: true, referable: false },
    ]) {
      expect(shouldBeArtifact({ ...content(100), ...flags })).toBe(false);
    }
  });

  it("lets an explicit request or template override short content", () => {
    expect(shouldBeArtifact({ ...content(2), explicitRequest: true })).toBe(true);
    expect(shouldBeArtifact({ ...content(2), template: "docs" })).toBe(true);
  });

  it("blocks everything when the capability is off", () => {
    expect(
      shouldBeArtifact({
        ...content(100),
        explicitRequest: true,
        template: "docs",
        capabilityEnabled: false,
      }),
    ).toBe(false);
  });
});

describe("template plan gating (recovered table)", () => {
  it("gates beta templates and leaves Docs/Slides/Design open", () => {
    expect(templateAllowed("dashboard", "pro", false)).toBe(true);
    expect(templateAllowed("dashboard", "free", false)).toBe(false);
    expect(templateAllowed("dashboard", "enterprise", false)).toBe(false);
    expect(templateAllowed("dashboard", "enterprise", true)).toBe(true);
    expect(templateAllowed("motion", "team", false)).toBe(true);
    expect(templateAllowed("motion", "pro", false)).toBe(false);
    expect(templateAllowed("motion", "enterprise", true)).toBe(true);
    expect(templateAllowed("docs", "free", false)).toBe(true);
  });
});

describe("kinds and exports", () => {
  it("resolves template names", () => {
    expect(fromTemplate("Docs")).toBe("docs");
    expect(fromTemplate("deck")).toBe("slides");
    expect(fromTemplate("plain")).toBeNull();
  });

  it("marks only dashboards and motion as beta", () => {
    expect(isBeta("dashboard")).toBe(true);
    expect(isBeta("motion")).toBe(true);
    expect(isBeta("docs")).toBe(false);
  });

  it("keeps Google handoff and MP4 out of cedian v1", () => {
    for (const kind of ["docs", "slides", "design", "motion"] as const) {
      const local = cedianExports(kind);
      expect(local).not.toContain("google-docs");
      expect(local).not.toContain("google-slides");
    }
    expect(cedianExports("motion")).not.toContain("mp4");
    expect(claudeExports("docs")).toContain("google-docs");
    expect(claudeExports("motion")).toContain("mp4");
  });
});

describe("storage policy (recovered: 20 MB text-only, legacy needs publish)", () => {
  it("refuses binary and shared and over-quota writes", () => {
    expect(() => checkStore("x", true, false)).toThrow(/text only/);
    expect(() => checkStore("x", false, true)).toThrow(/personal only/);
    expect(() => checkStore("a".repeat(20 * 1024 * 1024 + 1), false, false)).toThrow(/20 MB/);
    expect(() => checkStore("hello", false, false)).not.toThrow();
  });

  it("requires publish for legacy only", () => {
    expect(needsPublish(true)).toBe(true);
    expect(needsPublish(false)).toBe(false);
  });
});
