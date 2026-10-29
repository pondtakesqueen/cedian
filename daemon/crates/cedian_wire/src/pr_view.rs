use serde::{Deserialize, Serialize};

/// A thread's pull request as the PR block draws it (spec §11 Phase D: review, merge and
/// issues in Cedian), read through the person's own `gh` (`Request::PrView`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct PrView {
    pub number: u64,
    pub url: String,
    pub title: String,
    /// The description, as Markdown.
    pub body: String,
    pub state: PrViewState,
    pub draft: bool,
    pub author: String,
    /// The person (`gh`'s login) opened it, so Approve and Request changes are not theirs.
    pub mine: bool,
    pub head: String,
    pub base: String,
    pub additions: u32,
    pub deletions: u32,
    pub commits: u32,
    pub changed_files: u32,
    /// GitHub cannot merge it without a conflict.
    pub conflict: bool,
    /// The base has commits the head does not (`mergeStateStatus` BEHIND).
    pub behind: bool,
    /// `approved`, `changes_requested`, `review_required`; none when no review is asked.
    pub review_decision: Option<String>,
    /// Each reviewer's latest say, and the ones asked who have not said yet.
    pub reviewers: Vec<PrReviewer>,
    pub labels: Vec<String>,
    /// The issues it closes when merged.
    pub closes: Vec<u64>,
    pub checks: Vec<PrCheck>,
    /// The conversation's own comments, oldest first.
    pub comments: Vec<PrComment>,
    /// Line comments, grouped as GitHub threads them.
    pub threads: Vec<PrThread>,
    /// The merge method GitHub will use once checks and reviews allow, when merge when ready
    /// is on.
    pub auto_merge: Option<MergeMethod>,
}

#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum PrViewState {
    #[default]
    Open,
    Merged,
    Closed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct PrReviewer {
    pub login: String,
    /// `approved`, `changes_requested`, `commented`; none while asked and not yet reviewed.
    pub state: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct PrCheck {
    pub name: String,
    pub state: CheckState,
    /// Where it ran, to open.
    pub url: String,
    /// The Actions run it belongs to, whose failed log `Request::PrAct` `log` reads.
    pub run: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CheckState {
    Pending,
    Passed,
    Failed,
    Skipped,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct PrComment {
    pub author: String,
    pub body: String,
    pub at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct PrThread {
    /// GitHub's node id, which a reply or Resolve names.
    pub id: String,
    pub path: String,
    pub line: Option<u32>,
    pub resolved: bool,
    /// The diff lines the first comment was made on, ending at its line.
    pub hunk: String,
    pub comments: Vec<PrComment>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MergeMethod {
    Squash,
    Merge,
    Rebase,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReviewEvent {
    Comment,
    Approve,
    RequestChanges,
}

/// What the PR block asks of the thread's PR, each through `gh`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(tag = "do", rename_all = "snake_case")]
pub enum PrAction {
    /// A comment on the conversation.
    Comment {
        body: String,
    },
    /// A reply in a line comment's thread.
    Reply {
        thread: String,
        body: String,
    },
    Resolve {
        thread: String,
    },
    Unresolve {
        thread: String,
    },
    /// A review with the person's verdict; Approve and RequestChanges only on someone else's PR.
    Review {
        event: ReviewEvent,
        body: String,
    },
    /// Merges now; `delete_branch` deletes the head after.
    Merge {
        method: MergeMethod,
        delete_branch: bool,
    },
    /// Merge when ready on (`method`) or off (none).
    AutoMerge {
        method: Option<MergeMethod>,
    },
    /// Merges the base into the head on GitHub.
    UpdateBranch,
    /// Marks a draft ready for review.
    Ready,
    RequestReviewers {
        logins: Vec<String>,
    },
}

/// One open pull request of the project's repository, for the Pull requests list.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct PrSummary {
    pub number: u64,
    pub url: String,
    pub title: String,
    pub author: String,
    pub head: String,
    pub base: String,
    pub draft: bool,
    pub additions: u32,
    pub deletions: u32,
    pub ci: crate::CiState,
    /// The person's review is asked for.
    pub review_requested: bool,
}

/// The repository's open pull requests, as the list's tabs split them.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct PrList {
    pub to_review: Vec<PrSummary>,
    pub mine: Vec<PrSummary>,
    pub open: Vec<PrSummary>,
}
