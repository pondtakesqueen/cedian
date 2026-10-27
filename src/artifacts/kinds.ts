// Artifact kinds and per-kind exports.
// Mirrors daemon/crates/cedian_artifact/src/kind.rs (daemon decides, window renders).

export type ArtifactKind =
  | "docs"
  | "slides"
  | "design"
  | "dashboard"
  | "motion"
  | "code"
  | "website"
  | "image"
  | "diagram"
  | "tool"
  | "document";

export function fromTemplate(name: string): ArtifactKind | null {
  switch (name.toLowerCase()) {
    case "docs":
    case "doc":
      return "docs";
    case "slides":
    case "deck":
      return "slides";
    case "design":
      return "design";
    case "dashboard":
    case "dashboards":
      return "dashboard";
    case "motion":
      return "motion";
    default:
      return null;
  }
}

export function isBeta(kind: ArtifactKind): boolean {
  return kind === "dashboard" || kind === "motion";
}

/** What Claude Desktop / web offers (support article, "View and export"). */
export function claudeExports(kind: ArtifactKind): string[] {
  switch (kind) {
    case "docs":
      return ["word", "pdf", "markdown", "google-docs"];
    case "slides":
      return ["powerpoint", "pdf", "google-slides"];
    case "design":
      return ["zip", "pdf", "powerpoint", "standalone-html", "other-tool"];
    case "motion":
      return ["mp4"];
    default:
      return ["view-code", "copy", "download"];
  }
}

/** What cedian v1 offers locally: no Google handoff, no cloud MP4 render. */
export function cedianExports(kind: ArtifactKind): string[] {
  switch (kind) {
    case "docs":
      return ["markdown", "pdf", "copy", "download"];
    case "slides":
      return ["pdf", "copy", "download"];
    case "design":
      return ["standalone-html", "pdf", "copy", "download"];
    case "dashboard":
    case "motion":
      return ["copy", "download"];
    default:
      return ["view-code", "copy", "download"];
  }
}
