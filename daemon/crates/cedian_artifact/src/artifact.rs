//! An artifact and its versions: edit, iterate, fork, fix.
//!
//! Recovered loop (support article, "Edit and iterate" + "Fix errors"): ask
//! Claude to change it, edit directly (Docs/Slides/Design canvas), highlight
//! + "Edit with Claude", leave edit requests across several Markdown files and
//! submit as one batch, or edit an earlier message to branch into a different
//! version with its own artifacts. "Try fixing with Claude" re-sends the error
//! text; success is not guaranteed.

use serde::{Deserialize, Serialize};

use crate::ArtifactKind;

/// How a version came to be.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VersionOrigin {
    Model,
    DirectEdit,
    ClaudeEdit,
    Batch,
    Fork,
    Fix,
}

/// One saved version. Content is text; images/files/binary never persist
/// (see `store`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Version {
    pub n: u32,
    pub content: String,
    pub origin: VersionOrigin,
}

/// The daemon-owned record. The window renders it and never keeps a copy it
/// cannot rebuild from the daemon.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Artifact {
    pub id: String,
    pub title: String,
    pub kind: ArtifactKind,
    pub versions: Vec<Version>,
    /// Editing an earlier chat message branches here: the new version line
    /// gets its own artifacts and never touches this one.
    pub forked_from: Option<(String, u32)>,
}

impl Artifact {
    pub fn new(id: &str, title: &str, kind: ArtifactKind, content: &str) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            kind,
            versions: vec![Version {
                n: 1,
                content: content.into(),
                origin: VersionOrigin::Model,
            }],
            forked_from: None,
        }
    }

    pub fn latest(&self) -> Option<&Version> {
        self.versions.last()
    }

    fn push(&mut self, content: &str, origin: VersionOrigin) -> u32 {
        let n = self.versions.last().map(|v| v.n + 1).unwrap_or(1);
        self.versions.push(Version {
            n,
            content: content.into(),
            origin,
        });
        n
    }

    /// Direct edit on the canvas (type in a doc, edit a slide, move elements).
    pub fn edit_direct(&mut self, content: &str) -> u32 {
        self.push(content, VersionOrigin::DirectEdit)
    }

    /// Highlight + "Edit with Claude": the model edits where marked.
    pub fn claude_edit(&mut self, content: &str) -> u32 {
        self.push(content, VersionOrigin::ClaudeEdit)
    }

    /// Batch across several files: every pending request applied in one pass.
    /// `files` holds the per-file results; they land as one version.
    pub fn apply_batch(&mut self, joined: &str) -> u32 {
        self.push(joined, VersionOrigin::Batch)
    }

    /// "Try fixing with Claude": copies the error into a new message. The
    /// caller attempts the fix; this records the attempt either way so the
    /// history shows it was tried.
    pub fn record_fix(&mut self, content: &str) -> u32 {
        self.push(content, VersionOrigin::Fix)
    }

    /// Edit an earlier message: a separate artifact line whose versions are
    /// its own. Nothing here is mutated.
    pub fn fork(&self, id: &str, at_version: u32) -> Self {
        let content = self
            .versions
            .iter()
            .find(|v| v.n == at_version)
            .map(|v| v.content.clone())
            .unwrap_or_default();
        Self {
            id: id.into(),
            title: self.title.clone(),
            kind: self.kind,
            versions: vec![Version {
                n: 1,
                content,
                origin: VersionOrigin::Fork,
            }],
            forked_from: Some((self.id.clone(), at_version)),
        }
    }

    /// Build on a published artifact: a separate copy, the original
    /// untouched. The caller must have shown the trust warning (untrusted
    /// code, treat like a file from an unknown sender).
    pub fn build_on(&self, id: &str, changed: &str) -> Self {
        let mut next = self.fork(id, self.versions.last().map(|v| v.n).unwrap_or(1));
        if let Some(first) = next.versions.first_mut() {
            first.content = changed.into();
        }
        next
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_and_claude_edits_append_versions() {
        let mut a = Artifact::new("a1", "Deck", ArtifactKind::Slides, "v1");
        a.edit_direct("v2");
        a.claude_edit("v3");
        let origins: Vec<VersionOrigin> = a.versions.iter().map(|v| v.origin).collect();
        assert_eq!(
            origins,
            [
                VersionOrigin::Model,
                VersionOrigin::DirectEdit,
                VersionOrigin::ClaudeEdit
            ]
        );
        assert_eq!(a.latest().expect("latest").content, "v3");
    }

    #[test]
    fn batch_lands_as_one_version() {
        let mut a = Artifact::new("a1", "Skill", ArtifactKind::Document, "v1");
        a.apply_batch("file-a + file-b");
        assert_eq!(a.versions.len(), 2);
        assert_eq!(a.latest().expect("latest").origin, VersionOrigin::Batch);
    }

    #[test]
    fn fork_branches_without_touching_the_original() {
        let mut a = Artifact::new("a1", "Doc", ArtifactKind::Docs, "v1");
        a.edit_direct("v2");
        let b = a.fork("a2", 1);
        assert_eq!(b.versions.len(), 1);
        assert_eq!(b.versions[0].content, "v1");
        assert_eq!(b.forked_from, Some(("a1".into(), 1)));
        assert_eq!(a.versions.len(), 2, "original keeps both versions");
    }

    #[test]
    fn build_on_copies_and_leaves_the_original_alone() {
        let a = Artifact::new("a1", "Quiz", ArtifactKind::Tool, "quiz v1");
        let b = a.build_on("a2", "quiz movies + timer");
        assert_eq!(b.versions[0].content, "quiz movies + timer");
        assert_eq!(a.latest().expect("latest").content, "quiz v1");
    }

    #[test]
    fn fix_attempts_are_recorded_even_when_they_fail() {
        let mut a = Artifact::new("a1", "App", ArtifactKind::Website, "broken");
        a.record_fix("still broken");
        assert_eq!(a.latest().expect("latest").origin, VersionOrigin::Fix);
    }
}
