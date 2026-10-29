//! `CEDIAN_WIRE_RECORD=<file>`: every request a window sends and every notice it is sent, one
//! JSON line each, with the client and the milliseconds since the daemon started recording, so
//! a stutter the owner sees becomes a fixture that `test/smoke/replay.mjs` plays back (spec
//! §3.9). The file holds what the threads say, so only its owner can read it.

use std::{
    fs::File, io::Write as _, os::unix::fs::OpenOptionsExt as _, path::Path, sync::Mutex,
    time::Instant,
};

use anyhow::Context as _;
use cedian_wire::{Notice, Request};
use serde::Serialize;

use crate::daemon::ClientId;

pub struct Recorder {
    file: Mutex<File>,
    started: Instant,
}

#[derive(Serialize)]
struct Entry<'a> {
    ms: u64,
    client: ClientId,
    #[serde(skip_serializing_if = "Option::is_none")]
    request: Option<&'a Request>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notice: Option<&'a Notice>,
}

impl Recorder {
    /// Appends to `path`, created readable by this user only.
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o600)
            .open(path)
            .with_context(|| format!("opening {}", path.display()))?;
        Ok(Self {
            file: Mutex::new(file),
            started: Instant::now(),
        })
    }

    pub fn request(&self, client: ClientId, request: &Request) {
        self.write(Entry {
            ms: self.ms(),
            client,
            request: Some(request),
            notice: None,
        });
    }

    pub fn notice(&self, client: ClientId, notice: &Notice) {
        self.write(Entry {
            ms: self.ms(),
            client,
            request: None,
            notice: Some(notice),
        });
    }

    fn ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    fn write(&self, entry: Entry) {
        let Ok(mut line) = serde_json::to_vec(&entry) else {
            return;
        };
        line.push(b'\n');
        let mut file = self.file.lock().unwrap_or_else(|e| e.into_inner());
        if let Err(error) = file.write_all(&line) {
            log::warn!("wire record: {error}");
        }
    }
}
