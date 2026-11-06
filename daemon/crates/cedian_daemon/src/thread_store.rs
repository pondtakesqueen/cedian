//! A value kept per thread as one JSON file under the daemon's state directory, so a window that
//! opens the thread later, or after a restart, sees the same one.

use std::{
    marker::PhantomData,
    path::{Path, PathBuf},
};

use anyhow::Context as _;
use serde::{Serialize, de::DeserializeOwned};

use crate::atomic::replace_json;

pub struct ThreadStore<T> {
    dir: PathBuf,
    kept: PhantomData<T>,
}

impl<T: Serialize + DeserializeOwned + Default> ThreadStore<T> {
    /// The store in `<state dir>/<name>`.
    pub fn new(state_dir: &Path, name: &str) -> Self {
        Self {
            dir: state_dir.join(name),
            kept: PhantomData,
        }
    }

    /// The thread's value; the default when it has none, or when its file does not parse.
    pub fn load(&self, thread: &str) -> T {
        let path = self.path(thread);
        match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                log::warn!("{}: {error}", path.display());
                T::default()
            }),
            Err(_) => T::default(),
        }
    }

    pub fn save(&self, thread: &str, value: &T) -> anyhow::Result<()> {
        std::fs::create_dir_all(&self.dir)
            .with_context(|| format!("creating {}", self.dir.display()))?;
        replace_json(&self.path(thread), &serde_json::to_vec_pretty(value)?)
    }

    /// The thread's file: its id with anything but letters, digits and `-` made `_`.
    fn path(&self, thread: &str) -> PathBuf {
        let name: String = thread
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        self.dir.join(format!("{name}.json"))
    }
}
