use std::{
    io::{BufReader, ErrorKind},
    os::unix::{
        fs::PermissionsExt as _,
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    sync::{Arc, Mutex, mpsc},
};

use anyhow::Context as _;
use cedian_wire::{Notice, Request, read_message, write_message};

use crate::{
    Cedia,
    daemon::{Daemon, Shared, lock},
    record::Recorder,
    thread_watch::watch_threads,
};

pub struct Config {
    pub socket: PathBuf,
    pub cedia: Cedia,
    /// cedia's home, where its threads and sessions are read from.
    pub home: PathBuf,
    /// `CEDIAN_WIRE_RECORD`: where every request and notice is written as JSON lines.
    pub record: Option<PathBuf>,
}

/// Serves until the process ends. Returns at once when another daemon already answers on the
/// socket.
pub fn serve(config: Config) -> anyhow::Result<()> {
    let Some(listener) = bind(&config.socket)? else {
        log::info!("a daemon already serves {}", config.socket.display());
        return Ok(());
    };
    log::info!("serving {}", config.socket.display());
    // From here this daemon runs the queued threads and schedules; `cedia daemon` yields.
    if let Err(error) = crate::desktop_lock::hold(&config.home) {
        log::warn!("desktop lock: {error:#}");
    }
    let state_dir = config
        .socket
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    let shared: Shared = Arc::new(Mutex::new(Daemon::new(
        config.cedia,
        config.home,
        &state_dir,
    )));
    Daemon::adopt(&shared);
    watch_threads(shared.clone());
    let recorder = match &config.record {
        Some(path) => match Recorder::open(path) {
            Ok(recorder) => {
                log::info!("recording the wire to {}", path.display());
                Some(Arc::new(recorder))
            }
            Err(error) => {
                log::warn!("wire record: {error:#}");
                None
            }
        },
        None => None,
    };
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let shared = shared.clone();
                let recorder = recorder.clone();
                std::thread::spawn(move || {
                    if let Err(error) = client(&shared, stream, recorder) {
                        log::warn!("client: {error:#}");
                    }
                });
            }
            Err(error) => log::warn!("accept: {error}"),
        }
    }
    Ok(())
}

/// The socket, in a directory only this user can enter. A socket file nobody answers on is
/// left from a daemon that died, and is replaced.
fn bind(path: &Path) -> anyhow::Result<Option<UnixListener>> {
    // `sun_path` holds 104 bytes on macOS and 108 on Linux, with the terminating NUL.
    let limit = if cfg!(target_os = "macos") { 104 } else { 108 };
    let length = path.as_os_str().len();
    anyhow::ensure!(
        length < limit,
        "the socket path {} is {length} bytes; a Unix socket path must be under {limit}. \
         Set CEDIAN_STATE_DIR to a shorter directory",
        path.display()
    );
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    match UnixStream::connect(path) {
        Ok(_) => return Ok(None),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(_) => match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("removing the stale {}", path.display()));
            }
        },
    }
    let listener =
        UnixListener::bind(path).with_context(|| format!("binding {}", path.display()))?;
    Ok(Some(listener))
}

fn client(
    shared: &Shared,
    stream: UnixStream,
    recorder: Option<Arc<Recorder>>,
) -> anyhow::Result<()> {
    let mut writer = stream.try_clone()?;
    let (tx, rx) = mpsc::channel::<Notice>();
    let id = lock(shared).connect(tx);
    let out = recorder.clone();
    std::thread::spawn(move || {
        for notice in rx {
            if let Some(recorder) = &out {
                recorder.notice(id, &notice);
            }
            if let Err(error) = write_message(&mut writer, &notice) {
                log::debug!("client gone: {error:#}");
                break;
            }
        }
    });
    let mut reader = BufReader::new(stream);
    let result = loop {
        match read_message::<Request>(&mut reader) {
            Ok(Some(request)) => {
                if let Some(recorder) = &recorder {
                    recorder.request(id, &request);
                }
                Daemon::handle(shared, id, request)
            }
            Ok(None) => break Ok(()),
            Err(error) => {
                lock(shared).disconnect(id);
                break Err(error);
            }
        }
    };
    lock(shared).disconnect(id);
    result
}
