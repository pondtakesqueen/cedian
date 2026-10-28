//! The desktop's lock in cedia's home (`desktop.lock`, cedia's `DesktopLock`): while this daemon
//! serves, it runs the projects' queued threads and due schedules, and `cedia daemon` yields to
//! it so no thread starts twice (CEDIAN_SPEC §9, Q2). The file names this process; a lock whose
//! process is gone holds nothing, so a killed daemon needs no cleanup.

use std::path::{Path, PathBuf};

use anyhow::Context as _;

pub fn path(home: &Path) -> PathBuf {
    home.join("desktop.lock")
}

/// Writes the lock for this process, whole: a reader sees the old file or the new one.
pub fn hold(home: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(home).with_context(|| format!("creating {}", home.display()))?;
    let lock = serde_json::json!({
        "pid": std::process::id(),
        "at": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    });
    let path = path(home);
    let tmp = path.with_extension(format!("lock.{}", std::process::id()));
    std::fs::write(&tmp, serde_json::to_vec(&lock)?)
        .with_context(|| format!("writing {}", tmp.display()))?;
    std::fs::rename(&tmp, &path).with_context(|| format!("writing {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_lock_names_this_process() {
        let dir = tempfile::tempdir().expect("tempdir");
        super::hold(dir.path()).expect("hold");
        let text = std::fs::read_to_string(super::path(dir.path())).expect("lock");
        let lock: cedian_protocol::DesktopLock =
            serde_json::from_str(&text).expect("cedia's shape");
        assert_eq!(lock.pid as u32, std::process::id());
        assert!(
            chrono::DateTime::parse_from_rfc3339(&lock.at).is_ok(),
            "{text}"
        );
    }
}
