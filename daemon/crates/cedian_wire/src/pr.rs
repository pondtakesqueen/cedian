use serde::{Deserialize, Serialize};

/// A thread's pull request as the daemon last saw it through `gh` (ARCHITECTURE, Phase C
/// "Watching a thread's pull request"), for the chip on its row and its card.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct PrChip {
    pub number: u64,
    pub url: String,
    pub state: PrState,
    pub ci: CiState,
    /// GitHub cannot merge it into its base without a conflict.
    #[serde(default)]
    pub conflict: bool,
    /// GitHub's review decision (`approved`, `changes_requested`, `review_required`); none
    /// when the repository asks for no review.
    #[serde(default)]
    pub review: Option<String>,
    /// A run the watch started for the PR's head is going or has not pushed yet.
    #[serde(default)]
    pub fixing: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PrState {
    Open,
    Merged,
    Closed,
}

/// The checks on the PR's head commit, taken together.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CiState {
    /// No check reports on the head.
    None,
    Pending,
    Passing,
    Failing,
}
