//! Daemon-owned artifact records: trigger, kind, versions, storage.
//!
//! The window renders what the daemon decides; cedia (the agent) decides what
//! qualifies. This crate holds the pure rules so daemon, tests, and the
//! generated TS types cannot drift. No agent loop, model client, or tool lives
//! here.

mod artifact;
mod kind;
mod store;
mod trigger;

pub use artifact::{Artifact, Version, VersionOrigin};
pub use kind::ArtifactKind;
pub use store::{MAX_BYTES, StorageMode, check_load, check_store, needs_publish, unpublish_deletes};
pub use trigger::{Candidate, Plan, template_allowed};
