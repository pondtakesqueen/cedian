//! Where artifact data lives and what can break.
//!
//! Recovered rules (support article, "Store data in an artifact"): storage is
//! personal or shared; the first use of shared storage shows a confirmation
//! because others see the data. Limit is 20 MB per artifact, text only (no
//! images, files, or binary). Personal and shared are kept separate, and
//! unpublishing a legacy artifact permanently deletes its stored data. Legacy
//! storage works only after publish; new artifacts store without publishing.
//! cedian v1 is single-owner and local-first, so only personal storage ships;
//! shared storage, publish URLs, and per-plan metering stay excluded.

use anyhow::{Context as _, bail};
use serde::{Deserialize, Serialize};

/// 20 MB per artifact, as published.
pub const MAX_BYTES: usize = 20 * 1024 * 1024;

/// Personal data stays private; shared data is visible to others using the
/// artifact. cedian v1 stores personal only.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageMode {
    Personal,
    Shared,
}

/// Pre-publish check for one write.
pub fn check_store(text: &str, is_binary: bool, mode: StorageMode) -> anyhow::Result<()> {
    if is_binary {
        bail!("artifacts store text only: no images, files, or binary data");
    }
    if mode == StorageMode::Shared {
        // Local-only v1 has no one to share with; the caller renders the
        // confirmation the article requires before refusing.
        bail!("shared storage is not available in cedian v1 (personal only)");
    }
    if text.len() > MAX_BYTES {
        bail!("artifact storage is 20 MB per artifact");
    }
    Ok(())
}

/// Legacy (pre-2026-09-16) storage works only after publish; new artifacts do
/// not need publishing. cedian imports legacy artifacts read-only.
pub fn needs_publish(legacy: bool) -> bool {
    legacy
}

/// Unpublishing a legacy artifact permanently deletes its stored data.
pub fn unpublish_deletes(legacy: bool) -> bool {
    legacy
}

/// Read one stored value back, refusing binary payloads the same way writes
/// do. Kept beside `check_store` so the rule cannot drift.
pub fn check_load(bytes: &[u8]) -> anyhow::Result<String> {
    let text = std::str::from_utf8(bytes).with_context(|| "artifact storage holds text only")?;
    if text.len() > MAX_BYTES {
        bail!("artifact storage is 20 MB per artifact");
    }
    Ok(text.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_under_quota_passes() {
        check_store("hello", false, StorageMode::Personal).expect("small text stores");
    }

    #[test]
    fn binary_is_refused() {
        let err = check_store("x", true, StorageMode::Personal).expect_err("binary");
        assert!(err.to_string().contains("text only"));
    }

    #[test]
    fn twenty_mb_is_the_cap() {
        let big = "a".repeat(MAX_BYTES + 1);
        let err = check_store(&big, false, StorageMode::Personal).expect_err("over quota");
        assert!(err.to_string().contains("20 MB"));
        check_store(&"a".repeat(MAX_BYTES), false, StorageMode::Personal)
            .expect("exactly 20 MB fits");
    }

    #[test]
    fn shared_storage_needs_a_confirmation_cedian_v1_has_no_share_with() {
        let err = check_store("x", false, StorageMode::Shared).expect_err("shared in v1");
        assert!(err.to_string().contains("personal only"));
    }

    #[test]
    fn legacy_needs_publish_new_does_not_unpublish_deletes_legacy() {
        assert!(needs_publish(true));
        assert!(!needs_publish(false));
        assert!(unpublish_deletes(true));
        assert!(!unpublish_deletes(false));
    }

    #[test]
    fn load_refuses_non_utf8() {
        check_load(b"ok").expect("utf8 loads");
        check_load(&[0xff, 0xfe]).expect_err("binary load fails");
    }
}
