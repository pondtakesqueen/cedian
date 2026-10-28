//! When a reply becomes an artifact instead of staying inline.
//!
//! Recovered rule (support article, "What is an artifact"): Claude creates an
//! artifact when the content is significant and self-contained (typically over
//! 15 lines), is something the person is likely to edit, iterate on, or reuse
//! outside the conversation, stands on its own without extra context, and is
//! likely to be referred back to. An explicit request ("ask for one in any
//! conversation") or a template choice also triggers one. The capability
//! switch ("Create and edit files") must be on, and beta templates are
//! plan-gated.

use serde::{Deserialize, Serialize};

use crate::ArtifactKind;

/// What the agent saw that could become an artifact.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Candidate {
    /// Non-empty lines of the content.
    pub lines: usize,
    /// The person explicitly asked for an artifact.
    pub explicit_request: bool,
    /// A template was picked (Output menu or Artifacts tab).
    pub template: Option<ArtifactKind>,
    /// Likely to be edited, iterated on, or reused outside the chat.
    pub reusable: bool,
    /// Stands alone without the conversation's context.
    pub standalone: bool,
    /// Likely to be referred back to or used later.
    pub referable: bool,
    /// The "Create and edit files" capability is on.
    pub capability_enabled: bool,
}

impl Candidate {
    /// The four content criteria, with the >15-line bar as "typically".
    pub fn meets_content_rule(&self) -> bool {
        self.lines > 15 && self.reusable && self.standalone && self.referable
    }

    /// Whether cedian should open an artifact pane for this candidate.
    /// cedian does not run the agent loop: cedia decides the flags, the
    /// daemon applies this predicate, the window only renders the result.
    pub fn should_be_artifact(&self) -> bool {
        if !self.capability_enabled {
            return false;
        }
        self.explicit_request || self.template.is_some() || self.meets_content_rule()
    }
}

/// Plans in the article's table. Kept as strings so new plans do not break
/// the daemon; unknown plans get the Free row.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Plan {
    Free,
    Pro,
    Max,
    Team,
    Enterprise,
}

impl Plan {
    pub fn parse(name: &str) -> Self {
        match name.to_ascii_lowercase().as_str() {
            "pro" => Self::Pro,
            "max" => Self::Max,
            "team" => Self::Team,
            "enterprise" => Self::Enterprise,
            _ => Self::Free,
        }
    }
}

/// Whether the template can start on the given plan. Enterprise
/// Dashboards/Motion need an owner toggle; the daemon models that as
/// `enterprise_enabled`.
pub fn template_allowed(kind: ArtifactKind, plan: Plan, enterprise_enabled: bool) -> bool {
    match kind {
        ArtifactKind::Docs | ArtifactKind::Slides | ArtifactKind::Design => true,
        ArtifactKind::Dashboard => match plan {
            Plan::Free => false,
            Plan::Enterprise => enterprise_enabled,
            _ => true,
        },
        ArtifactKind::Motion => match plan {
            Plan::Team => true,
            Plan::Enterprise => enterprise_enabled,
            _ => false,
        },
        // Non-template kinds follow the generic "create in a chat" row.
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content(lines: usize) -> Candidate {
        Candidate {
            lines,
            explicit_request: false,
            template: None,
            reusable: true,
            standalone: true,
            referable: true,
            capability_enabled: true,
        }
    }

    #[test]
    fn fifteen_lines_is_not_significant_sixteen_is() {
        assert!(!content(15).should_be_artifact());
        assert!(content(16).should_be_artifact());
    }

    #[test]
    fn each_content_flag_is_required_without_an_explicit_ask() {
        for (reusable, standalone, referable) in [
            (false, true, true),
            (true, false, true),
            (true, true, false),
        ] {
            let c = Candidate {
                reusable,
                standalone,
                referable,
                ..content(100)
            };
            assert!(
                !c.should_be_artifact(),
                "reusable={reusable} standalone={standalone} referable={referable}"
            );
        }
    }

    #[test]
    fn explicit_request_or_template_overrides_short_content() {
        let asked = Candidate {
            explicit_request: true,
            ..content(2)
        };
        assert!(asked.should_be_artifact());
        let templated = Candidate {
            template: Some(ArtifactKind::Docs),
            ..content(2)
        };
        assert!(templated.should_be_artifact());
    }

    #[test]
    fn capability_off_blocks_everything() {
        let c = Candidate {
            capability_enabled: false,
            explicit_request: true,
            template: Some(ArtifactKind::Docs),
            ..content(100)
        };
        assert!(!c.should_be_artifact());
    }

    #[test]
    fn beta_templates_follow_the_plan_table() {
        // Dashboards: Pro+ yes, Free no, Enterprise needs the owner toggle.
        assert!(template_allowed(ArtifactKind::Dashboard, Plan::Pro, false));
        assert!(!template_allowed(
            ArtifactKind::Dashboard,
            Plan::Free,
            false
        ));
        assert!(!template_allowed(
            ArtifactKind::Dashboard,
            Plan::Enterprise,
            false
        ));
        assert!(template_allowed(
            ArtifactKind::Dashboard,
            Plan::Enterprise,
            true
        ));
        // Motion: Team (+Enterprise toggle) only.
        assert!(template_allowed(ArtifactKind::Motion, Plan::Team, false));
        assert!(!template_allowed(ArtifactKind::Motion, Plan::Pro, false));
        assert!(!template_allowed(
            ArtifactKind::Motion,
            Plan::Enterprise,
            false
        ));
        assert!(template_allowed(
            ArtifactKind::Motion,
            Plan::Enterprise,
            true
        ));
        // Docs/Slides/Design are on for every plan.
        for plan in [Plan::Free, Plan::Pro, Plan::Enterprise] {
            assert!(template_allowed(ArtifactKind::Docs, plan, false));
        }
    }
}
