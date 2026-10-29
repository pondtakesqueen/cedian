//! A thread's folder in git, for the branch chip and the Git menu (spec §11 Phase D, the git
//! pane): its branch against the base and the upstream, and what is uncommitted. Read with the
//! daemon's own git, hooks off, as the worktrees are.

use std::path::Path;
use std::process::Command;

use anyhow::Context as _;
use cedian_wire::{GitAction, GitState};

/// Runs git in `dir` with hooks off; its stdout, untrimmed, when it succeeds.
fn git(dir: &Path, args: &[&str]) -> anyhow::Result<String> {
    let output = Command::new("git")
        .args(["-c", "core.hooksPath=/dev/null"])
        .args(args)
        .current_dir(dir)
        .output()
        .with_context(|| format!("running git {}", args.join(" ")))?;
    anyhow::ensure!(
        output.status.success(),
        "git {}: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr).trim()
    );
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// `git rev-list --left-right --count a...b`: the commits only `a` has, and only `b` has.
fn apart(dir: &Path, a: &str, b: &str) -> anyhow::Result<(u32, u32)> {
    let out = git(
        dir,
        &["rev-list", "--left-right", "--count", &format!("{a}...{b}")],
    )?;
    let mut counts = out.split_whitespace().map(str::parse::<u32>);
    match (counts.next(), counts.next()) {
        (Some(Ok(left)), Some(Ok(right))) => Ok((left, right)),
        _ => anyhow::bail!("git rev-list: {out:?}"),
    }
}

/// The branch a thread's work merges into: the remote's default, else a local main or master.
fn base(dir: &Path) -> Option<String> {
    if let Ok(head) = git(
        dir,
        &[
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/origin/HEAD",
        ],
    ) {
        return Some(head.trim().to_owned());
    }
    ["main", "master"].into_iter().find_map(|name| {
        git(
            dir,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/heads/{name}"),
            ],
        )
        .ok()
        .map(|_| name.to_owned())
    })
}

pub fn read(dir: &Path) -> anyhow::Result<GitState> {
    git(dir, &["rev-parse", "--git-dir"]).context("not a git repository")?;
    let branch = git(dir, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .ok()
        .map(|b| b.trim().to_owned());
    let mut state = GitState {
        branch: branch.clone(),
        ..GitState::default()
    };
    if let Some(base) = base(dir)
        && Some(base.trim_start_matches("origin/")) != branch.as_deref()
    {
        (state.behind, state.ahead) = apart(dir, &base, "HEAD").unwrap_or((0, 0));
        state.base = Some(base);
    }
    state.upstream = git(
        dir,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .ok()
    .map(|u| u.trim().to_owned());
    state.unpushed = match &state.upstream {
        Some(upstream) => apart(dir, upstream, "HEAD")
            .map(|(_, ahead)| ahead)
            .unwrap_or(0),
        None => state.ahead,
    };
    let status = git(
        dir,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    let mut entries = status.split('\0').filter(|e| !e.is_empty());
    while let Some(entry) = entries.next() {
        state.changed += 1;
        // A rename names its old path next.
        if entry.starts_with('R') || entry.starts_with('C') {
            entries.next();
        }
    }
    Ok(state)
}

/// Pulls or pushes the branch checked out in `dir`.
pub fn act(dir: &Path, action: GitAction) -> anyhow::Result<()> {
    let state = read(dir)?;
    match action {
        GitAction::Pull if state.upstream.is_some() => git(dir, &["pull", "--rebase"]).map(drop),
        GitAction::Pull => {
            let base = state.base.context("no branch to pull from")?;
            if base.starts_with("origin/") {
                git(dir, &["fetch", "origin"])?;
            }
            git(dir, &["rebase", &base]).map(drop)
        }
        GitAction::Push => {
            let branch = state.branch.context("no branch checked out to push")?;
            git(dir, &["push", "-u", "origin", &branch]).map(drop)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .expect("git");
        assert!(
            out.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    #[test]
    fn a_branch_counts_against_its_base_and_its_upstream() {
        let dir = tempfile::tempdir().expect("tempdir");
        let origin = dir.path().join("origin.git");
        let repo = dir.path().join("repo");
        std::fs::create_dir_all(&repo).expect("repo");
        run(
            dir.path(),
            &[
                "init",
                "-q",
                "--bare",
                "-b",
                "main",
                origin.to_str().expect("path"),
            ],
        );
        run(&repo, &["init", "-q", "-b", "main"]);
        let commit = |message: &str| {
            run(
                &repo,
                &[
                    "-c",
                    "user.name=t",
                    "-c",
                    "user.email=t@t",
                    "commit",
                    "-q",
                    "--allow-empty",
                    "-m",
                    message,
                ],
            );
        };
        commit("start");
        run(
            &repo,
            &["remote", "add", "origin", origin.to_str().expect("path")],
        );
        run(&repo, &["push", "-q", "-u", "origin", "main"]);
        run(&repo, &["remote", "set-head", "origin", "main"]);
        let on_main = read(&repo).expect("state");
        assert_eq!(
            (on_main.branch.as_deref(), on_main.base.as_deref()),
            (Some("main"), None)
        );

        run(&repo, &["checkout", "-q", "-b", "fix-login"]);
        commit("one");
        commit("two");
        std::fs::write(repo.join("a.txt"), "a\n").expect("write");
        let state = read(&repo).expect("state");
        assert_eq!(
            state,
            GitState {
                branch: Some("fix-login".into()),
                base: Some("origin/main".into()),
                ahead: 2,
                behind: 0,
                upstream: None,
                unpushed: 2,
                changed: 1,
            }
        );

        act(&repo, GitAction::Push).expect("push");
        let pushed = read(&repo).expect("state");
        assert_eq!(
            (pushed.upstream.as_deref(), pushed.unpushed),
            (Some("origin/fix-login"), 0)
        );
    }

    #[test]
    fn a_folder_outside_git_says_so() {
        let dir = tempfile::tempdir().expect("tempdir");
        let error = read(dir.path()).expect_err("not a repository");
        assert!(
            format!("{error:#}").contains("not a git repository"),
            "{error:#}"
        );
    }
}
