//! Replacing one of the daemon's JSON files in one rename, so a crash mid-write leaves the old one.

use std::path::Path;

use anyhow::Context as _;

/// Writes `bytes` beside `path` as `<name>.json.tmp`, then renames it over `path`.
pub fn replace_json(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, bytes).with_context(|| format!("writing {}", temp.display()))?;
    std::fs::rename(&temp, path).with_context(|| format!("replacing {}", path.display()))
}
