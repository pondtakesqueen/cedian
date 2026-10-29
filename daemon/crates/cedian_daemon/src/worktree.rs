//! A new thread's own git worktree, so parallel threads never edit the same checkout. It lives
//! in `<main worktree>/.cedian/worktrees/<name>` on a new branch `cedian/<name>` from the main
//! worktree's HEAD; `.cedian/` goes in the repository's `info/exclude`, never its `.gitignore`.
//! What git ignores in the main worktree is cloned in where the filesystem can (`clone_ignored`).

use std::{
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::Context as _;

/// Longest branch name taken from the first message, before any `-2` suffix.
const NAME_LENGTH: usize = 40;

/// A branch-safe name from the first line of the first message: ASCII words, lowercased and
/// joined by `-`. A message with none (Thai, say) gets `thread-<time>`.
pub fn name_from(text: &str, now_secs: u64) -> String {
    let line = text.lines().next().unwrap_or_default().to_ascii_lowercase();
    let mut name = String::new();
    for word in line.split(|c: char| !c.is_ascii_alphanumeric()) {
        if word.is_empty() {
            continue;
        }
        if name.len() + word.len() + 1 > NAME_LENGTH {
            break;
        }
        if !name.is_empty() {
            name.push('-');
        }
        name.push_str(word);
    }
    if name.is_empty() {
        format!("thread-{now_secs}")
    } else {
        name
    }
}

fn git(dir: &Path, args: &[&str]) -> anyhow::Result<String> {
    // A repository's hooks are code nobody has trusted yet; the daemon's git runs none.
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
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// Creates the worktree for a thread whose first message is `text`, in the project `cwd`
/// belongs to. Returns its path and branch.
pub fn create(cwd: &Path, text: &str) -> anyhow::Result<(PathBuf, String)> {
    let common = PathBuf::from(
        git(
            cwd,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )
        .context("a worktree needs the project to be a git repository")?,
    );
    let root = match common.parent() {
        Some(root) if common.file_name().is_some_and(|name| name == ".git") => root.to_path_buf(),
        _ => anyhow::bail!("{} is a bare repository", common.display()),
    };
    exclude(&common)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    let base = name_from(text, now);
    let mut name = base.clone();
    for n in 2.. {
        let taken = git(
            &root,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/heads/cedian/{name}"),
            ],
        )
        .is_ok()
            || root.join(".cedian/worktrees").join(&name).exists();
        if !taken {
            break;
        }
        name = format!("{base}-{n}");
    }
    let branch = format!("cedian/{name}");
    let dir = root.join(".cedian/worktrees").join(&name);
    git(
        &root,
        &[
            "worktree",
            "add",
            "-b",
            &branch,
            &dir.display().to_string(),
            "HEAD",
        ],
    )?;
    let cloned = crate::clone_ignored::clone_into(&root, &dir);
    if !cloned.is_empty() {
        log::info!("cloned into {}: {cloned:?}", dir.display());
    }
    Ok((dir, branch))
}

/// The files one of Cedian's worktrees holds uncommitted (changed, staged or untracked), as
/// `git status` names them; none for a folder that is not such a worktree (spec §3.7 archive
/// guard: the worktree is removed some days after archiving, and these would go with it).
pub fn uncommitted(dir: &Path) -> anyhow::Result<Vec<String>> {
    let ours = dir.to_string_lossy().contains(&format!(
        "{0}.cedian{0}worktrees{0}",
        std::path::MAIN_SEPARATOR
    ));
    if !ours || !dir.exists() {
        return Ok(Vec::new());
    }
    // Not through `git`, which trims: a status line starts with its two columns, often a space.
    let output = Command::new("git")
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
        ])
        .current_dir(dir)
        .output()
        .context("running git status")?;
    anyhow::ensure!(
        output.status.success(),
        "git status: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    );
    let status = String::from_utf8_lossy(&output.stdout);
    let mut files = Vec::new();
    let mut entries = status.split('\0').filter(|e| !e.is_empty());
    while let Some(entry) = entries.next() {
        if let Some(path) = entry.get(3..) {
            files.push(path.to_owned());
        }
        // A rename names its old path next.
        if entry.starts_with('R') || entry.starts_with('C') {
            entries.next();
        }
    }
    Ok(files)
}

/// Adds `/.cedian/` to the repository's `info/exclude` once.
fn exclude(common: &Path) -> anyhow::Result<()> {
    let path = common.join("info/exclude");
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    if text.lines().any(|line| line.trim() == "/.cedian/") {
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let separator = if text.is_empty() || text.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    std::fs::write(&path, format!("{text}{separator}/.cedian/\n"))
        .with_context(|| format!("writing {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_come_from_the_first_line() {
        assert_eq!(
            name_from("Fix the login bug!\nmore", 7),
            "fix-the-login-bug"
        );
        assert_eq!(name_from("แก้บั๊กหน้า login", 7), "login");
        assert_eq!(name_from("ทดสอบ", 7), "thread-7");
        let long = name_from(&"word ".repeat(30), 7);
        assert!(long.len() <= NAME_LENGTH, "{long}");
    }

    #[test]
    fn a_worktree_names_its_uncommitted_files_and_another_folder_none() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("repo");
        std::fs::create_dir_all(&root).expect("repo");
        let run = |args: &[&str]| {
            assert!(
                Command::new("git")
                    .args(args)
                    .current_dir(&root)
                    .output()
                    .expect("git")
                    .status
                    .success(),
                "{args:?}"
            );
        };
        run(&["init", "-q", "-b", "main"]);
        std::fs::write(root.join("a.txt"), "a\n").expect("write");
        run(&["add", "."]);
        run(&[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit",
            "-q",
            "-m",
            "init",
        ]);
        let (tree, _) = create(&root, "fix the thing").expect("worktree");
        assert_eq!(uncommitted(&tree).expect("status"), Vec::<String>::new());
        std::fs::write(tree.join("a.txt"), "changed\n").expect("write");
        std::fs::write(tree.join("new.txt"), "new\n").expect("write");
        let mut files = uncommitted(&tree).expect("status");
        files.sort();
        assert_eq!(files, ["a.txt", "new.txt"]);
        // The project itself is not a worktree of Cedian's: archiving it never asks.
        std::fs::write(root.join("a.txt"), "dirty\n").expect("write");
        assert!(uncommitted(&root).expect("status").is_empty());
    }
}
