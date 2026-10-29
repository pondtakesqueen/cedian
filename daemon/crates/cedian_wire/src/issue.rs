use serde::{Deserialize, Serialize};

use crate::PrComment;

/// One issue of the project's repository, for the Issues list (spec §11 Phase D: review, merge
/// and issues in Cedian), read through the person's own `gh`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct IssueSummary {
    pub number: u64,
    pub url: String,
    pub title: String,
    pub author: String,
    /// The person (`gh`'s login) opened it.
    pub mine: bool,
    pub state: IssueState,
    pub labels: Vec<String>,
    pub comments: u32,
    /// When it was opened, as GitHub says it (RFC 3339).
    pub created: String,
}

#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum IssueState {
    #[default]
    Open,
    Closed,
}

/// Which issues the list asks for: its tabs, and the search box's text.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct IssueFilter {
    pub state: IssueState,
    /// Only the ones assigned to the person.
    #[serde(default)]
    pub assigned: bool,
    /// GitHub search text (`gh issue list --search`); empty for none.
    #[serde(default)]
    pub search: String,
}

/// An issue as the Issues block draws it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct IssueView {
    pub number: u64,
    pub url: String,
    pub title: String,
    /// The description, as Markdown.
    pub body: String,
    pub state: IssueState,
    /// `completed`, `not_planned`, `duplicate` once closed.
    pub state_reason: Option<String>,
    pub author: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    pub milestone: Option<String>,
    /// The person's own login, for Assign me.
    pub me: String,
    /// Oldest first.
    pub comments: Vec<PrComment>,
    /// The pull requests that close it when merged.
    pub linked: Vec<LinkedPr>,
    /// The person may label, assign, close and reopen (triage or more on the repository).
    pub can_triage: bool,
    /// The repository's labels, for + Label.
    pub repo_labels: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct LinkedPr {
    pub number: u64,
    pub title: String,
    pub url: String,
    /// The PR's head branch, which a thread of this project may be on.
    pub head: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CloseReason {
    Completed,
    NotPlanned,
}

/// What the Issues block asks of one issue, each as the `gh` command a person would type.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(tag = "do", rename_all = "snake_case")]
pub enum IssueAction {
    Comment {
        body: String,
    },
    /// Closes it, with a comment first when `body` is not empty.
    Close {
        reason: CloseReason,
        #[serde(default)]
        body: String,
    },
    Reopen,
    Labels {
        #[serde(default)]
        add: Vec<String>,
        #[serde(default)]
        remove: Vec<String>,
    },
    Assignees {
        #[serde(default)]
        add: Vec<String>,
        #[serde(default)]
        remove: Vec<String>,
    },
}

/// A new issue, from New issue.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct NewIssue {
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub labels: Vec<String>,
}
