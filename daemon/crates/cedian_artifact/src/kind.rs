//! What kind of artifact a candidate is.
//!
//! Recovered from the public support article (no code copied): Claude can make
//! an artifact out of almost anything, including documents, code snippets,
//! single-page websites, images, diagrams and flowcharts, dashboards, and small
//! interactive tools. Templates are the named starting points: Docs, Slides,
//! Design, Dashboards (beta), Motion (beta).

use serde::{Deserialize, Serialize};

/// Template or detected kind. The five templates are the named starting
/// points; the rest are what the generic "make an artifact" path can produce.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKind {
    Docs,
    Slides,
    Design,
    Dashboard,
    Motion,
    Code,
    Website,
    Image,
    Diagram,
    Tool,
    Document,
}

impl ArtifactKind {
    /// The template names the article lists, as the user picks them.
    pub fn from_template(name: &str) -> Option<Self> {
        match name.to_ascii_lowercase().as_str() {
            "docs" | "doc" => Some(Self::Docs),
            "slides" | "deck" => Some(Self::Slides),
            "design" => Some(Self::Design),
            "dashboard" | "dashboards" => Some(Self::Dashboard),
            "motion" => Some(Self::Motion),
            _ => None,
        }
    }

    /// Whether this kind is a beta template in the original.
    pub fn is_beta(self) -> bool {
        matches!(self, Self::Dashboard | Self::Motion)
    }

    /// What Claude Desktop / web offers as export for this kind.
    /// Source: "View and export" section of the support article.
    pub fn claude_exports(self) -> &'static [&'static str] {
        match self {
            Self::Docs => &["word", "pdf", "markdown", "google-docs"],
            Self::Slides => &["powerpoint", "pdf", "google-slides"],
            Self::Design => &["zip", "pdf", "powerpoint", "standalone-html", "other-tool"],
            Self::Motion => &["mp4"],
            // Legacy (non-template) artifacts.
            _ => &["view-code", "copy", "download"],
        }
    }

    /// What cedian v1 offers locally (single-owner, no Google integration,
    /// no cloud render). VS Code provides the viewers; the daemon persists
    /// the files. Google Docs/Slides handoff and MP4 render are deferred.
    pub fn cedian_exports(self) -> &'static [&'static str] {
        match self {
            Self::Docs => &["markdown", "pdf", "copy", "download"],
            Self::Slides => &["pdf", "copy", "download"],
            Self::Design => &["standalone-html", "pdf", "copy", "download"],
            // Dashboards / Motion have no local renderer in v1.
            Self::Dashboard | Self::Motion => &["copy", "download"],
            _ => &["view-code", "copy", "download"],
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_names_resolve() {
        assert_eq!(ArtifactKind::from_template("Docs"), Some(ArtifactKind::Docs));
        assert_eq!(
            ArtifactKind::from_template("deck"),
            Some(ArtifactKind::Slides)
        );
        assert_eq!(ArtifactKind::from_template("plain"), None);
    }

    #[test]
    fn beta_templates_are_dashboard_and_motion() {
        assert!(ArtifactKind::Dashboard.is_beta());
        assert!(ArtifactKind::Motion.is_beta());
        assert!(!ArtifactKind::Docs.is_beta());
    }

    #[test]
    fn cedian_has_no_google_handoff_or_mp4_in_v1() {
        for kind in [
            ArtifactKind::Docs,
            ArtifactKind::Slides,
            ArtifactKind::Design,
            ArtifactKind::Motion,
        ] {
            let local = kind.cedian_exports();
            assert!(
                !local.contains(&"google-docs") && !local.contains(&"google-slides"),
                "{kind:?} must not offer Google handoff locally"
            );
        }
        assert!(
            !ArtifactKind::Motion.cedian_exports().contains(&"mp4"),
            "MP4 render is deferred in cedian v1"
        );
        // The original does offer them.
        assert!(ArtifactKind::Docs.claude_exports().contains(&"google-docs"));
        assert!(ArtifactKind::Motion.claude_exports().contains(&"mp4"));
    }
}
