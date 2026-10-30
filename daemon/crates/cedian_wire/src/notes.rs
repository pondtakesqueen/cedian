use cedian_protocol::CodeReview;
use serde::{Deserialize, Serialize};

/// A comment the person left on one line of a thread's diff (spec §3.7, diff comments; §3.8,
/// Annotate AI Diff). It is anchored by the lines around it, not by its line number, so it
/// follows its code when the agent's edits move it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct LineComment {
    /// The window's own id for it, so one comment can be edited or removed.
    pub id: String,
    /// The file, relative to the thread's working tree.
    pub path: String,
    /// The line in the file as it is now, from 1; the daemon moves it after each run.
    pub line: u32,
    /// The line's text, trimmed, when the comment was left (or last followed), quoted to the
    /// agent with it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote: Option<String>,
    /// Up to three lines above the line, nearest last: the hunk context it is found by.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub before: Vec<String>,
    /// Up to three lines below the line, nearest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub after: Vec<String>,
    #[serde(default, skip_serializing_if = "CommentState::is_draft")]
    pub state: CommentState,
    pub text: String,
}

/// Where a line comment is in its round trip with the agent.
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum CommentState {
    /// Left, not sent yet: goes with the next batch.
    #[default]
    Draft,
    /// Sent; the run that reads it has not ended.
    Sent,
    /// The run ended and left the commented code as it was: goes with the next batch again.
    Open,
    /// The run changed the commented code, or the person resolved it: shown collapsed, not sent.
    Resolved,
}

impl CommentState {
    pub fn is_draft(&self) -> bool {
        *self == Self::Draft
    }

    /// Whether the next batch carries a comment in this state.
    pub fn goes_next(&self) -> bool {
        matches!(self, Self::Draft | Self::Open)
    }
}

/// What the person has left on a thread's diff: line comments not yet sent, and the latest
/// `/code-review` with the findings they dismissed. The daemon keeps it per thread.
#[derive(Clone, Debug, Default, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Notes {
    pub comments: Vec<LineComment>,
    /// The latest `cedia review` of the thread, or why there is none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review: Option<CodeReview>,
    /// Findings of `review` the person dismissed, by id.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dismissed: Vec<String>,
    /// A review is being written now.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub reviewing: bool,
}
