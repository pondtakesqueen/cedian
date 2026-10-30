//! A thread's folder in git, for the branch chip and the Git menu (spec §11 Phase D, the git
//! pane): its branch against the base and the upstream, and what is uncommitted. Read with the
//! daemon's own git, hooks off, as the worktrees are.

use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::Context as _;
use cedian_wire::{GitAction, GitState};

/// How long a fetch, pull or push may take before it is stopped.
const NETWORK_LIMIT: Duration = Duration::from_secs(120);

/// Runs git in `dir` with hooks off; its stdout, untrimmed, when it succeeds.
fn git(dir: &Path, args: &[&str]) -> anyhow::Result<String> {
    run(dir, args, None)
}

/// As `git`, for a command that talks to the remote: stopped after `NETWORK_LIMIT`.
fn git_remote(dir: &Path, args: &[&str]) -> anyhow::Result<String> {
    run(dir, args, Some(NETWORK_LIMIT))
}

/// Never waits on a terminal prompt for credentials: a remote that wants them fails instead.
fn run(dir: &Path, args: &[&str], limit: Option<Duration>) -> anyhow::Result<String> {
    let mut child = Command::new("git")
        .args(["-c", "core.hooksPath=/dev/null"])
        .args(args)
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| format!("running git {}", args.join(" ")))?;
    if let Some(limit) = limit {
        let started = Instant::now();
        while child.try_wait()?.is_none() {
            if started.elapsed() > limit {
                let _ = child.kill();
                let _ = child.wait();
                anyhow::bail!("git {}: no answer in {} s", args.join(" "), limit.as_secs());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    let output = child.wait_with_output()?;
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

/// Where `dir` stands; with `fetch`, after fetching the remote. A failed fetch is kept in the
/// state, and the counts are then against what was fetched before.
pub fn read(dir: &Path, fetch: bool) -> anyhow::Result<GitState> {
    let git_dir = git(dir, &["rev-parse", "--absolute-git-dir"]).context("not a git repository")?;
    let git_dir = Path::new(git_dir.trim());
    let fetch_error = if fetch && git(dir, &["remote", "get-url", "origin"]).is_ok() {
        git_remote(dir, &["fetch", "--quiet", "origin"])
            .err()
            .map(|e| format!("{e:#}"))
    } else {
        None
    };
    let branch = git(dir, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .ok()
        .map(|b| b.trim().to_owned());
    let mut state = GitState {
        branch: branch.clone(),
        rebasing: git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists(),
        fetch_error,
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

/// Pulls or pushes the branch checked out in `dir`. Uncommitted work (an agent run's usual
/// state) is stashed around a pull and put back; a pull that stops on a conflict is aborted, so
/// the folder is left as it was and the next run does not start inside a rebase.
pub fn act(dir: &Path, action: GitAction) -> anyhow::Result<()> {
    let state = read(dir, false)?;
    anyhow::ensure!(
        !state.rebasing,
        "a rebase is in progress here: finish or abort it in Source Control first"
    );
    match action {
        GitAction::Pull => {
            let pulled = match &state.upstream {
                Some(_) => git_remote(dir, &["pull", "--rebase", "--autostash"]),
                None => {
                    let base = state.base.context("no branch to pull from")?;
                    if base.starts_with("origin/") {
                        git_remote(dir, &["fetch", "--quiet", "origin"])?;
                    }
                    git(dir, &["rebase", "--autostash", &base])
                }
            };
            if let Err(error) = pulled {
                if read(dir, false).is_ok_and(|s| s.rebasing) {
                    // git's own text says to continue or skip, which no longer applies once
                    // aborted, so the person gets the files and the log keeps the rest.
                    let files = git(dir, &["diff", "--name-only", "--diff-filter=U"])
                        .unwrap_or_default()
                        .lines()
                        .collect::<Vec<_>>()
                        .join(", ");
                    git(dir, &["rebase", "--abort"]).context("aborting the rebase")?;
                    log::warn!("pull in {} stopped on a conflict: {error:#}", dir.display());
                    let place = if files.is_empty() {
                        String::new()
                    } else {
                        format!(" in {files}")
                    };
                    anyhow::bail!("Pull stopped on a conflict{place}, so nothing changed");
                }
                return Err(error);
            }
            Ok(())
        }
        GitAction::Push => {
            let branch = state.branch.context("no branch checked out to push")?;
            match state.upstream {
                // The remote and branch it already tracks.
                Some(_) => git_remote(dir, &["push"]).map(drop),
                None => git_remote(dir, &["push", "-u", "origin", &branch]).map(drop),
            }
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

    fn commit(dir: &Path, args: &[&str]) {
        let mut all = vec!["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q"];
        all.extend_from_slice(args);
        run(dir, &all);
    }

    #[test]
    fn a_branch_counts_against_its_base_and_its_upstream() {
        let dir = tempfile::tempdir().expect("tempdir");
        let origin = dir.path().join("origin.git");
        let origin = origin.to_str().expect("path");
        let repo = dir.path().join("repo");
        std::fs::create_dir_all(&repo).expect("repo");
        run(dir.path(), &["init", "-q", "--bare", "-b", "main", origin]);
        run(&repo, &["init", "-q", "-b", "main"]);
        commit(&repo, &["--allow-empty", "-m", "start"]);
        run(&repo, &["remote", "add", "origin", origin]);
        run(&repo, &["push", "-q", "-u", "origin", "main"]);
        run(&repo, &["remote", "set-head", "origin", "main"]);
        let on_main = read(&repo, false).expect("state");
        assert_eq!(
            (on_main.branch.as_deref(), on_main.base.as_deref()),
            (Some("main"), None)
        );

        run(&repo, &["checkout", "-q", "-b", "fix-login"]);
        commit(&repo, &["--allow-empty", "-m", "one"]);
        commit(&repo, &["--allow-empty", "-m", "two"]);
        std::fs::write(repo.join("a.txt"), "a\n").expect("write");
        let state = read(&repo, false).expect("state");
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
                rebasing: false,
                fetch_error: None,
            }
        );

        act(&repo, GitAction::Push).expect("push");
        let pushed = read(&repo, false).expect("state");
        assert_eq!(
            (pushed.upstream.as_deref(), pushed.unpushed),
            (Some("origin/fix-login"), 0)
        );

        // Someone pushes to the branch from another clone: only a fetch shows it, and Pull takes
        // it with the uncommitted edit kept.
        let other = dir.path().join("other");
        run(
            dir.path(),
            &[
                "clone",
                "-q",
                "-b",
                "fix-login",
                origin,
                other.to_str().expect("path"),
            ],
        );
        commit(&other, &["--allow-empty", "-m", "three"]);
        run(&other, &["push", "-q"]);
        assert_eq!(
            apart(&repo, "origin/fix-login", "HEAD").expect("apart"),
            (0, 0)
        );
        assert_eq!(read(&repo, true).expect("state").fetch_error, None);
        assert_eq!(
            apart(&repo, "origin/fix-login", "HEAD").expect("apart"),
            (1, 0)
        );
        std::fs::write(repo.join("tracked.txt"), "x\n").expect("write");
        run(&repo, &["add", "tracked.txt"]);
        commit(&repo, &["-m", "tracked"]);
        std::fs::write(repo.join("tracked.txt"), "edited\n").expect("write");
        act(&repo, GitAction::Pull).expect("pull with uncommitted changes");
        assert!(!read(&repo, false).expect("state").rebasing);
        assert_eq!(
            std::fs::read_to_string(repo.join("tracked.txt")).expect("read"),
            "edited\n"
        );
        assert_eq!(
            apart(&repo, "origin/fix-login", "HEAD").expect("apart"),
            (0, 1)
        );
    }

    #[test]
    fn a_pull_that_conflicts_is_aborted() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = dir.path().to_path_buf();
        run(&repo, &["init", "-q", "-b", "main"]);
        std::fs::write(repo.join("a.txt"), "base\n").expect("write");
        run(&repo, &["add", "a.txt"]);
        commit(&repo, &["-m", "start"]);
        run(&repo, &["checkout", "-q", "-b", "fix"]);
        std::fs::write(repo.join("a.txt"), "ours\n").expect("write");
        commit(&repo, &["-am", "ours"]);
        run(&repo, &["checkout", "-q", "main"]);
        std::fs::write(repo.join("a.txt"), "theirs\n").expect("write");
        commit(&repo, &["-am", "theirs"]);
        run(&repo, &["checkout", "-q", "fix"]);
        let error = act(&repo, GitAction::Pull).expect_err("conflict");
        assert!(
            format!("{error:#}").starts_with("Pull stopped on a conflict in "),
            "{error:#}"
        );
        assert!(!format!("{error:#}").contains("--continue"), "{error:#}");
        assert!(!read(&repo, false).expect("state").rebasing);
        assert_eq!(
            std::fs::read_to_string(repo.join("a.txt")).expect("read"),
            "ours\n"
        );
    }

    #[test]
    fn a_folder_outside_git_says_so() {
        let dir = tempfile::tempdir().expect("tempdir");
        let error = read(dir.path(), false).expect_err("not a repository");
        assert!(
            format!("{error:#}").contains("not a git repository"),
            "{error:#}"
        );
    }
}
