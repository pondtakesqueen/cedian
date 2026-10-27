// Artifact trigger + storage policy for the window.
// Mirrors daemon/crates/cedian_artifact/src/{trigger,store}.rs.
// The daemon applies these rules; the window uses them for instant gating only.

import type { ArtifactKind } from "./kinds";

export interface Candidate {
  lines: number;
  explicitRequest: boolean;
  template: ArtifactKind | null;
  reusable: boolean;
  standalone: boolean;
  referable: boolean;
  capabilityEnabled: boolean;
}

export function meetsContentRule(c: Candidate): boolean {
  return c.lines > 15 && c.reusable && c.standalone && c.referable;
}

export function shouldBeArtifact(c: Candidate): boolean {
  if (!c.capabilityEnabled) return false;
  return c.explicitRequest || c.template !== null || meetsContentRule(c);
}

export type Plan = "free" | "pro" | "max" | "team" | "enterprise";

export function parsePlan(name: string): Plan {
  switch (name.toLowerCase()) {
    case "pro":
      return "pro";
    case "max":
      return "max";
    case "team":
      return "team";
    case "enterprise":
      return "enterprise";
    default:
      return "free";
  }
}

export function templateAllowed(
  kind: ArtifactKind,
  plan: Plan,
  enterpriseEnabled: boolean,
): boolean {
  switch (kind) {
    case "docs":
    case "slides":
    case "design":
      return true;
    case "dashboard":
      if (plan === "free") return false;
      if (plan === "enterprise") return enterpriseEnabled;
      return true;
    case "motion":
      if (plan === "team") return true;
      if (plan === "enterprise") return enterpriseEnabled;
      return false;
    default:
      return true;
  }
}

export const MAX_BYTES = 20 * 1024 * 1024;

export function checkStore(text: string, isBinary: boolean, shared: boolean): void {
  if (isBinary) throw new Error("artifacts store text only: no images, files, or binary data");
  if (shared) throw new Error("shared storage is not available in cedian v1 (personal only)");
  if (text.length > MAX_BYTES) throw new Error("artifact storage is 20 MB per artifact");
}

/** Legacy (pre-2026-09-16) storage works only after publish. */
export function needsPublish(legacy: boolean): boolean {
  return legacy;
}
