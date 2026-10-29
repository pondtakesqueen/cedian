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
    /// Files with uncommitted changes, untracked ones included.
    pub changed: u32,
}

/// What the Git menu asks of a thread's folder. Each runs git with hooks off.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum GitAction {
    /// `git pull --rebase` from the upstream, else a rebase onto the base.
    Pull,
    /// `git push -u origin <branch>`.
    Push,
}
