use serde::{Deserialize, Serialize};

/// Where a thread's folder (its worktree, else the project) stands in git, for the branch chip
/// and the Git menu (spec §11 Phase D, the git pane).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct GitState {
    /// The checked-out branch; none on a detached HEAD.
    #[serde(default)]
    pub branch: Option<String>,
    /// The branch it will merge into: the remote's default (`origin/HEAD`), else a local
    /// `main` or `master`; none when there is neither, or it is the base itself.
    #[serde(default)]
    pub base: Option<String>,
    /// Commits on the branch the base does not have.
    pub ahead: u32,
    /// Commits on the base the branch does not have.
    pub behind: u32,
    /// The branch's upstream (`origin/<branch>`) once it has been pushed.
    #[serde(default)]
    pub upstream: Option<String>,
    /// Commits not pushed to the upstream; all of `ahead` when there is no upstream.
    pub unpushed: u32,
    /// Commits on the upstream the branch does not have yet, which Pull brings in.
    #[serde(default)]
    pub unpulled: u32,
    /// Files with uncommitted changes, untracked ones included.
    pub changed: u32,
    /// A rebase stopped part way (a conflict git left), which the next run would start inside.
    #[serde(default)]
    pub rebasing: bool,
    /// Why fetching from the remote failed, when it was asked for and did; the counts are then
    /// against what was last fetched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fetch_error: Option<String>,
}

/// What the Git menu asks of a thread's folder. Each runs git with hooks off.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum GitAction {
    /// `git pull --rebase --autostash` from the upstream, else a rebase onto the base; a
    /// conflict is aborted, leaving the folder as it was.
    Pull,
    /// `git push` to the upstream, else `git push -u origin <branch>`.
    Push,
}
