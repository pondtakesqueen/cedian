//! The CDP bridge to native browser pages (native Browser block plan, step 3). A window shows a
//! project's page in VS Code's own browser, a view Electron draws, so the page lives in that
//! window, not in the daemon's Chromium. cedia's browser tool still wants one page's DevTools
//! WebSocket (`--browser ws://…/devtools/page/<id>`), so the daemon serves one per page and
//! passes each message through to the window that holds it, which speaks to the page
//! (`src/browser-panel/relay.ts`). The daemon reads none of it; the window keeps to the page.
//!
//! The socket listens on loopback only, at a path whose id is drawn at random for each page, so
//! another local program can't guess it; nothing else is served there.

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, ErrorKind, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::mpsc,
    time::Duration,
};

use cedian_wire::Notice;
use rand_core::{OsRng, RngCore};
use tungstenite::{Message, WebSocket, handshake::derive_accept_key, protocol::Role};

use crate::daemon::{ClientId, Shared, lock};

/// How long a bridge socket waits for cedia between checks for the window's messages.
const POLL: Duration = Duration::from_millis(5);

/// The native pages windows hold, and the bridge sockets open to them.
#[derive(Default)]
pub struct NativePages {
    /// Each project's page: the window that holds it and the id in its bridge path.
    pages: HashMap<String, Page>,
    /// Each open bridge socket: where the window's messages for it go (`None` ends it).
    conns: HashMap<u64, Conn>,
    next_conn: u64,
    /// The bridge's port, once it listens.
    port: Option<u16>,
}

struct Page {
    window: ClientId,
    id: String,
    /// The window's own name for the project, as it said it.
    cwd: PathBuf,
}

struct Conn {
    window: ClientId,
    to_cedia: mpsc::Sender<Option<String>>,
}

impl NativePages {
    /// The window `window` holds `project`'s page (`open`), or no longer does.
    pub fn set(&mut self, project: &str, cwd: &Path, window: ClientId, open: bool) {
        if open {
            if self
                .pages
                .get(project)
                .is_none_or(|page| page.window != window)
            {
                let page = Page {
                    window,
                    id: random_id(),
                    cwd: cwd.to_owned(),
                };
                self.pages.insert(project.to_owned(), page);
            }
        } else if self
            .pages
            .get(project)
            .is_some_and(|page| page.window == window)
        {
            self.pages.remove(project);
        }
    }

    /// The bridge socket for `project`'s page, for cedia's `--browser`, when a window holds one
    /// and the bridge listens.
    pub fn url(&self, project: &str) -> Option<String> {
        let page = self.pages.get(project)?;
        Some(format!(
            "ws://127.0.0.1:{}/devtools/page/{}",
            self.port?, page.id
        ))
    }

    /// Whether the bridge listens yet.
    pub fn listening(&self) -> bool {
        self.port.is_some()
    }

    /// A message from `window` for bridge socket `conn`, or `None` when its page went.
    pub fn forward(&mut self, window: ClientId, conn: u64, data: Option<String>) {
        let ended = data.is_none();
        if let Some(c) = self.conns.get(&conn).filter(|c| c.window == window) {
            let _ = c.to_cedia.send(data);
        }
        if ended {
            self.conns.remove(&conn);
        }
    }

    /// The window `window` went: its pages, and the sockets to them, go too.
    pub fn gone(&mut self, window: ClientId) {
        self.pages.retain(|_, page| page.window != window);
        self.conns.retain(|_, c| {
            if c.window == window {
                let _ = c.to_cedia.send(None);
                false
            } else {
                true
            }
        });
    }

    fn page(&self, id: &str) -> Option<(PathBuf, ClientId)> {
        self.pages
            .values()
            .find(|page| page.id == id)
            .map(|page| (page.cwd.clone(), page.window))
    }
}

fn random_id() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Starts the bridge on a loopback port of the system's choosing, once.
pub fn listen(shared: &Shared) {
    if lock(shared).native.listening() {
        return;
    }
    let listener = match TcpListener::bind(("127.0.0.1", 0)) {
        Ok(listener) => listener,
        Err(error) => return log::warn!("native browser bridge: {error}"),
    };
    let Ok(address) = listener.local_addr() else {
        return;
    };
    lock(shared).native.port = Some(address.port());
    let shared = shared.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let shared = shared.clone();
            std::thread::spawn(move || {
                if let Err(error) = connection(&shared, stream) {
                    log::debug!("native browser bridge: {error:#}");
                }
            });
        }
    });
}

/// The page id a request for `/devtools/page/<id>` names.
pub fn page_id(path: &str) -> Option<&str> {
    let id = path.strip_prefix("/devtools/page/")?;
    (id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())).then_some(id)
}

fn connection(shared: &Shared, mut stream: TcpStream) -> anyhow::Result<()> {
    let (path, key) = read_upgrade(&mut stream)?;
    let found = page_id(&path).and_then(|id| lock(shared).native.page(id));
    let (Some((cwd, window)), Some(key)) = (found, key) else {
        stream.write_all(
            b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )?;
        return Ok(());
    };
    let accept = derive_accept_key(key.as_bytes());
    write!(
        stream,
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
    )?;
    stream.flush()?;
    stream.set_read_timeout(Some(POLL))?;
    let mut socket = WebSocket::from_raw_socket(stream, Role::Server, None);
    let (tx, rx) = mpsc::channel();
    let conn = {
        let mut daemon = lock(shared);
        let conn = daemon.native.next_conn;
        daemon.native.next_conn += 1;
        daemon.native.conns.insert(
            conn,
            Conn {
                window,
                to_cedia: tx,
            },
        );
        daemon.send_to(window, Notice::BrowserCdpOpen { conn, cwd });
        conn
    };
    let result = pump(shared, &mut socket, window, conn, &rx);
    let mut daemon = lock(shared);
    if daemon.native.conns.remove(&conn).is_some() {
        daemon.send_to(window, Notice::BrowserCdpClose { conn });
    }
    drop(daemon);
    let _ = socket.close(None);
    result
}

/// One bridge socket: cedia's messages to the window, the window's to cedia, until either ends.
/// One thread does both, polling the socket between the window's messages, since a socket
/// cannot be read and written from two threads.
fn pump(
    shared: &Shared,
    socket: &mut WebSocket<TcpStream>,
    window: ClientId,
    conn: u64,
    rx: &mpsc::Receiver<Option<String>>,
) -> anyhow::Result<()> {
    loop {
        loop {
            match rx.try_recv() {
                Ok(Some(data)) => socket.send(Message::Text(data.into()))?,
                Ok(None) | Err(mpsc::TryRecvError::Disconnected) => return Ok(()),
                Err(mpsc::TryRecvError::Empty) => break,
            }
        }
        match socket.read() {
            Ok(Message::Text(text)) => {
                lock(shared).send_to(
                    window,
                    Notice::BrowserCdp {
                        conn,
                        data: text.to_string(),
                    },
                );
            }
            Ok(Message::Close(_)) => return Ok(()),
            Ok(_) => {}
            Err(tungstenite::Error::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed) => {
                return Ok(());
            }
            Err(error) => return Err(error.into()),
        }
    }
}

/// The path and `Sec-WebSocket-Key` of an HTTP upgrade request.
fn read_upgrade(stream: &mut TcpStream) -> anyhow::Result<(String, Option<String>)> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let path = line
        .split_whitespace()
        .nth(1)
        .unwrap_or_default()
        .to_owned();
    let mut key = None;
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 || line.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':')
            && name.trim().eq_ignore_ascii_case("sec-websocket-key")
        {
            key = Some(value.trim().to_owned());
        }
    }
    Ok((path, key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_path_names_a_drawn_id_and_nothing_else() {
        let id = random_id();
        assert_eq!(page_id(&format!("/devtools/page/{id}")), Some(id.as_str()));
        assert_eq!(page_id("/devtools/page/../../etc"), None);
        assert_eq!(page_id("/json/list"), None);
        assert_eq!(page_id("/devtools/page/abc"), None);
    }

    #[test]
    fn a_page_belongs_to_the_window_that_holds_it() {
        let mut pages = NativePages {
            port: Some(9),
            ..NativePages::default()
        };
        assert_eq!(pages.url("p"), None);
        pages.set("p", Path::new("/p"), 1, true);
        let url = pages.url("p").unwrap();
        assert!(url.starts_with("ws://127.0.0.1:9/devtools/page/"));
        // Saying it again keeps the id; another window closing it changes nothing.
        pages.set("p", Path::new("/p"), 1, true);
        pages.set("p", Path::new("/p"), 2, false);
        assert_eq!(pages.url("p"), Some(url));
        pages.gone(1);
        assert_eq!(pages.url("p"), None);
    }

    #[test]
    fn a_window_that_goes_ends_its_sockets() {
        let mut pages = NativePages::default();
        let (tx, rx) = mpsc::channel();
        pages.conns.insert(
            0,
            Conn {
                window: 1,
                to_cedia: tx,
            },
        );
        // Another window can't write to it.
        pages.forward(2, 0, Some("{}".into()));
        assert!(rx.try_recv().is_err());
        pages.forward(1, 0, Some("{}".into()));
        assert_eq!(rx.try_recv().unwrap(), Some("{}".into()));
        pages.gone(1);
        assert_eq!(rx.try_recv().unwrap(), None);
        assert!(pages.conns.is_empty());
    }
}
