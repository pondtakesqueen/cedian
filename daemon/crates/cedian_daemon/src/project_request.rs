//! cedia's `add_project` on the person's Allow (`Request::AllowProject`): the folder the thread
//! asked for, made when it is new, and `desktop.projects` with it at the end. cedia checked the
//! request when the call ran; it is checked again here, since the folder may have changed while
//! the thread waited and the daemon, not the model, is the one that writes.

use std::path::{Path, PathBuf};

use anyhow::{Context as _, bail, ensure};
use cedian_index::ProjectAsk;
use serde_json::Value;

/// A folder in the system's temporary space, never a project (the window's `isScratch`).
fn scratch(path: &Path) -> bool {
    let text = path.to_string_lossy();
    [
        "/tmp/",
        "/private/tmp/",
        "/var/folders/",
        "/private/var/folders/",
    ]
    .iter()
    .any(|prefix| text.starts_with(prefix))
}

/// The project folder, ready: made (with `git init`) when the request creates it, else checked
/// to be a folder. `home` is the person's home and `cedia_home` cedia's, neither a project.
pub fn prepare(ask: &ProjectAsk, home: &Path, cedia_home: &Path) -> anyhow::Result<PathBuf> {
    let path = PathBuf::from(&ask.path);
    ensure!(path.is_absolute(), "{} is not an absolute path", ask.path);
    ensure!(
        path.parent().is_some() && path != home,
        "{} is too wide to be a project",
        ask.path
    );
    ensure!(!scratch(&path), "{} is a temporary folder", ask.path);
    let cedia_home = cedia_home
        .canonicalize()
        .unwrap_or_else(|_| cedia_home.to_path_buf());
    if ask.create {
        ensure!(
            !path.exists(),
            "{} exists now; ask again without create",
            ask.path
        );
        let parent = path.parent().context("no parent folder")?;
        ensure!(parent.is_dir(), "{} does not exist", parent.display());
        let real = parent
            .canonicalize()?
            .join(path.file_name().context("no folder name")?);
        ensure!(
            !real.starts_with(&cedia_home),
            "{} is inside cedia's folder",
            ask.path
        );
        std::fs::create_dir(&real).with_context(|| format!("creating {}", real.display()))?;
        let init = std::process::Command::new("git")
            .arg("init")
            .arg("--quiet")
            .current_dir(&real)
            .output()
            .context("running git init")?;
        if !init.status.success() {
            bail!(
                "git init in {} failed: {}",
                real.display(),
                String::from_utf8_lossy(&init.stderr).trim()
            );
        }
        Ok(real)
    } else {
        ensure!(path.is_dir(), "{} is not a folder", ask.path);
        let real = path.canonicalize()?;
        ensure!(
            !real.starts_with(&cedia_home),
            "{} is inside cedia's folder",
            ask.path
        );
        ensure!(!scratch(&real), "{} is a temporary folder", ask.path);
        Ok(real)
    }
}

/// `desktop.projects` with `path` at its end, or none when it is there already.
pub fn with_project(desktop: &Value, path: &Path) -> Option<Value> {
    let path = path.to_string_lossy().into_owned();
    let mut projects: Vec<Value> = desktop
        .get("projects")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if projects.iter().any(|p| p.as_str() == Some(path.as_str())) {
        return None;
    }
    projects.push(Value::String(path));
    Some(Value::Array(projects))
}

/// The thread's answer when the chat stays: what the daemon did, after the person's Allow.
pub fn allowed_text(ask: &ProjectAsk, path: &Path) -> String {
    let made = if ask.create {
        " (a new folder, with git init)"
    } else {
        ""
    };
    format!("Allow. Cedian added {}{made} as a project.", path.display())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ask(path: &Path, create: bool) -> ProjectAsk {
        ProjectAsk {
            path: path.to_string_lossy().into_owned(),
            create,
            carry: false,
            why: "w".into(),
        }
    }

    #[test]
    fn a_new_folder_is_made_a_git_repository_and_an_existing_one_is_checked() {
        // Under the build's target folder: the system's temporary space is scratch, never a
        // project.
        let target = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target");
        std::fs::create_dir_all(target).expect("target");
        let dir = tempfile::tempdir_in(target).expect("tempdir");
        let home = dir.path().join("me");
        let cedia_home = home.join(".cedia");
        std::fs::create_dir_all(&cedia_home).expect("mkdir");
        let site = home.join("site");
        let made = prepare(&ask(&site, true), &home, &cedia_home).expect("create");
        assert!(made.join(".git").is_dir());
        assert!(
            prepare(&ask(&site, true), &home, &cedia_home).is_err(),
            "exists now"
        );
        assert_eq!(
            prepare(&ask(&site, false), &home, &cedia_home).expect("add"),
            made
        );
        assert!(prepare(&ask(&home.join("none"), false), &home, &cedia_home).is_err());
        assert!(prepare(&ask(&cedia_home, false), &home, &cedia_home).is_err());
        assert!(prepare(&ask(&home, false), &home, &cedia_home).is_err());
    }

    #[test]
    fn temporary_and_relative_folders_are_refused() {
        let home = Path::new("/Users/me");
        let cedia = Path::new("/Users/me/.cedia");
        assert!(prepare(&ask(Path::new("/tmp/x"), true), home, cedia).is_err());
        assert!(prepare(&ask(Path::new("/var/folders/ab/x"), false), home, cedia).is_err());
        assert!(prepare(&ask(Path::new("code/x"), false), home, cedia).is_err());
        assert!(prepare(&ask(Path::new("/"), false), home, cedia).is_err());
    }

    #[test]
    fn projects_gain_the_folder_once_at_their_end() {
        let desktop = serde_json::json!({"projects": ["/a"]});
        assert_eq!(
            with_project(&desktop, Path::new("/b")),
            Some(serde_json::json!(["/a", "/b"]))
        );
        assert_eq!(with_project(&desktop, Path::new("/a")), None);
        assert_eq!(
            with_project(&serde_json::json!({}), Path::new("/a")),
            Some(serde_json::json!(["/a"]))
        );
    }
}
