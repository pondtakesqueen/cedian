use cedian_protocol::CodeReview;
use serde::{Deserialize, Serialize};

/// A comment the person left on one line of a thread's diff, waiting to be sent with the rest
/// (spec §3.7, diff comments).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct LineComment {
    /// The window's own id for it, so one comment can be edited or removed.
    pub id: String,
    /// The file, relative to the thread's working tree.
    pub path: String,
    /// The line in the file as the thread left it, from 1.
    pub line: u32,
    /// The line's text when the comment was left, quoted to the agent with it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote: Option<String>,
    pub text: String,
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
