//! Remote control: the agent pane in a browser (a phone on the owner's tailnet), served by the
//! daemon itself so it works whenever the daemon runs, with or without a window open.
//!
//! On when `desktop.remote.port` is set in `~/.cedia/settings.json`. It listens on 127.0.0.1
//! only; the owner reaches it from other devices through `tailscale serve <port>`, which keeps it
//! inside the tailnet and adds HTTPS. Every request needs the token in `remote-token` (state
//! dir, mode 0600): `/?token=<t>` once sets it as a strict, http-only cookie. A request whose
//! Host (or a socket's Origin) is not localhost or a `*.ts.net` name is refused, so a web page
//! elsewhere cannot reach it through DNS rebinding or a cross-site socket.
//!
//! `/ws` speaks the window's own protocol (`cedian_wire`): one JSON request or notice per text
//! frame, the same lines `daemon.sock` carries, so the browser is just another window.
//! Everything else is a file of the web build (`CEDIAN_REMOTE_WEB`, else `remote-web` beside
//! the binary).

use std::{
    io::{BufRead as _, BufReader, ErrorKind, Read as _, Write as _},
    net::{TcpListener, TcpStream},
    os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _},
    path::{Path, PathBuf},
    sync::{Arc, mpsc},
    time::Duration,
};

use anyhow::Context as _;
use cedian_wire::{Notice, Request};
use serde_json::Value;
use tungstenite::{Message, WebSocket, handshake::derive_accept_key, protocol::Role};

use crate::{
    daemon::{Daemon, Shared, lock},
    record::Recorder,
};

pub const COOKIE: &str = "cedian_remote";
const MAX_HEAD: usize = 16 * 1024;

pub struct RemoteConfig {
    pub port: u16,
    pub token: String,
    pub web: Option<PathBuf>,
}

/// The remote's settings, or `None` when `desktop.remote.port` is not set.
pub fn remote_config(home: &Path, state_dir: &Path) -> anyhow::Result<Option<RemoteConfig>> {
    let desktop =
        crate::desktop_settings::read_desktop(&crate::desktop_settings::settings_path(home))?;
    let Some(port) = desktop.pointer("/remote/port").and_then(Value::as_u64) else {
        return Ok(None);
    };
    let port = u16::try_from(port).context("desktop.remote.port must be a port number")?;
    let web = std::env::var_os("CEDIAN_REMOTE_WEB")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|dir| dir.join("remote-web")))
        });
    Ok(Some(RemoteConfig {
        port,
        token: token(state_dir)?,
        web: web.filter(|dir| dir.is_dir()),
    }))
}

/// The token in `remote-token`, made on first use: 32 random bytes as hex, readable only by
/// the owner.
pub fn token(state_dir: &Path) -> anyhow::Result<String> {
    let path = state_dir.join("remote-token");
    match std::fs::read_to_string(&path) {
        Ok(text) if text.trim().len() == 64 => return Ok(text.trim().to_owned()),
        Ok(_) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error).with_context(|| format!("reading {}", path.display())),
    }
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut random| random.read_exact(&mut bytes))
        .context("reading /dev/urandom")?;
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    std::fs::create_dir_all(state_dir)?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&path)
        .with_context(|| format!("writing {}", path.display()))?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    file.write_all(token.as_bytes())?;
    Ok(token)
}

/// Listens on 127.0.0.1 in a thread of its own.
pub fn serve_remote(shared: Shared, config: RemoteConfig, recorder: Option<Arc<Recorder>>) {
    let listener = match TcpListener::bind(("127.0.0.1", config.port)) {
        Ok(listener) => listener,
        Err(error) => {
            log::warn!(
                "remote: cannot listen on 127.0.0.1:{}: {error}",
                config.port
            );
            return;
        }
    };
    log::info!(
        "remote: serving 127.0.0.1:{}{}",
        config.port,
        if config.web.is_some() {
            ""
        } else {
            " (no web build found: only /ws)"
        }
    );
    let config = Arc::new(config);
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let (shared, config, recorder) = (shared.clone(), config.clone(), recorder.clone());
            std::thread::spawn(move || {
                if let Err(error) = connection(&shared, &config, stream, recorder) {
                    log::debug!("remote: {error:#}");
                }
            });
        }
    });
}

/// A request's line and headers, names lowercased.
#[derive(Debug, PartialEq)]
pub struct Head {
    pub method: String,
    pub target: String,
    pub headers: Vec<(String, String)>,
}

impl Head {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }

    pub fn path(&self) -> &str {
        self.target.split('?').next().unwrap_or("")
    }

    pub fn query(&self, key: &str) -> Option<&str> {
        let (_, query) = self.target.split_once('?')?;
        query.split('&').find_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            (k == key).then_some(v)
        })
    }
}

pub fn parse_head(text: &str) -> Option<Head> {
    let mut lines = text.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let (method, target) = (first.next()?.to_owned(), first.next()?.to_owned());
    let headers = lines
        .take_while(|line| !line.is_empty())
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            Some((name.trim().to_ascii_lowercase(), value.trim().to_owned()))
        })
        .collect();
    Some(Head {
        method,
        target,
        headers,
    })
}

/// Whether a Host or Origin names this machine or the owner's tailnet.
pub fn allowed_host(value: &str) -> bool {
    let host = value
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let name = if let Some(rest) = host.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        host.split([':', '/']).next().unwrap_or("")
    };
    let name = name.to_ascii_lowercase();
    matches!(name.as_str(), "localhost" | "127.0.0.1" | "::1") || name.ends_with(".ts.net")
}

/// Equal in time that does not depend on where they differ.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

pub fn has_token(head: &Head, token: &str) -> bool {
    let cookie = head
        .header("cookie")
        .into_iter()
        .flat_map(|c| c.split(';'))
        .find_map(|pair| {
            let (k, v) = pair.trim().split_once('=')?;
            (k == COOKIE).then_some(v)
        });
    let bearer = head
        .header("authorization")
        .and_then(|a| a.strip_prefix("Bearer "));
    cookie.or(bearer).is_some_and(|given| same(given, token))
}

/// What to answer a request that is not a socket, as status, extra headers and body.
pub enum Reply {
    Status(u16, &'static str),
    Login,
    File(PathBuf),
}

pub fn route(head: &Head, token: &str, web: Option<&Path>) -> Reply {
    if !head.header("host").is_some_and(allowed_host) {
        return Reply::Status(421, "this host name is not served");
    }
    if head.method != "GET" {
        return Reply::Status(405, "only GET here; the window speaks over /ws");
    }
    if head.path() == "/" && head.query("token").is_some_and(|t| same(t, token)) {
        return Reply::Login;
    }
    if !has_token(head, token) {
        return Reply::Status(
            401,
            "open the link with ?token= from `cedian-daemon remote-url`",
        );
    }
    let Some(web) = web else {
        return Reply::Status(404, "no web build: set CEDIAN_REMOTE_WEB");
    };
    let path = head.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    if path
        .split('/')
        .any(|part| part.is_empty() || part.starts_with('.'))
    {
        return Reply::Status(404, "not found");
    }
    let file = web.join(path);
    if file.is_file() {
        Reply::File(file)
    } else {
        Reply::Status(404, "not found")
    }
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("woff2") => "font/woff2",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
}

const SECURITY: &str = "Content-Security-Policy: default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nCache-Control: no-store\r\n";

fn respond(stream: &mut TcpStream, reply: Reply, token: &str) -> anyhow::Result<()> {
    match reply {
        Reply::Status(code, text) => write!(
            stream,
            "HTTP/1.1 {code} {text}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\n{SECURITY}Connection: close\r\n\r\n{text}\n",
            text.len() + 1
        )?,
        Reply::Login => write!(
            stream,
            "HTTP/1.1 303 See Other\r\nLocation: /\r\nSet-Cookie: {COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000\r\n{SECURITY}Content-Length: 0\r\nConnection: close\r\n\r\n"
        )?,
        Reply::File(path) => {
            let body = std::fs::read(&path)?;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\n{SECURITY}Connection: close\r\n\r\n",
                content_type(&path),
                body.len()
            )?;
            stream.write_all(&body)?;
        }
    }
    stream.flush()?;
    Ok(())
}

fn read_head(stream: &mut TcpStream) -> anyhow::Result<Option<Head>> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut text = String::new();
    loop {
        let read = reader.read_line(&mut text)?;
        if read == 0 || text.len() > MAX_HEAD {
            return Ok(None);
        }
        if text.ends_with("\r\n\r\n") {
            break;
        }
    }
    // A GET has no body to leave unread; a request that would is refused before it matters.
    Ok(parse_head(&text))
}

fn connection(
    shared: &Shared,
    config: &RemoteConfig,
    mut stream: TcpStream,
    recorder: Option<Arc<Recorder>>,
) -> anyhow::Result<()> {
    let Some(head) = read_head(&mut stream)? else {
        return Ok(());
    };
    if head.path() != "/ws" {
        return respond(
            &mut stream,
            route(&head, &config.token, config.web.as_deref()),
            &config.token,
        );
    }
    let host_ok = head.header("host").is_some_and(allowed_host);
    // A browser always sends Origin on a socket; a page on another site cannot fake it.
    let origin_ok = head.header("origin").is_none_or(allowed_host);
    let upgrade = head
        .header("upgrade")
        .is_some_and(|u| u.eq_ignore_ascii_case("websocket"));
    let key = head.header("sec-websocket-key");
    let refused = if !host_ok || !origin_ok {
        Some(Reply::Status(421, "this host name is not served"))
    } else if !has_token(&head, &config.token) {
        Some(Reply::Status(401, "no token"))
    } else if !upgrade || key.is_none() || head.method != "GET" {
        Some(Reply::Status(400, "a WebSocket upgrade is expected here"))
    } else {
        None
    };
    if let Some(reply) = refused {
        return respond(&mut stream, reply, &config.token);
    }
    let accept = derive_accept_key(key.unwrap_or_default().as_bytes());
    write!(
        stream,
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
    )?;
    stream.flush()?;
    window(
        shared,
        WebSocket::from_raw_socket(stream, Role::Server, None),
        recorder,
    )
}

/// One browser window: requests from its frames, notices to it, until either side goes.
/// One thread does both, polling the socket between notices, since a socket cannot be read and
/// written from two threads.
fn window(
    shared: &Shared,
    mut socket: WebSocket<TcpStream>,
    recorder: Option<Arc<Recorder>>,
) -> anyhow::Result<()> {
    socket
        .get_mut()
        .set_read_timeout(Some(Duration::from_millis(50)))?;
    let (tx, rx) = mpsc::channel::<Notice>();
    let id = lock(shared).connect(tx);
    let result = loop {
        let mut gone = false;
        loop {
            match rx.try_recv() {
                Ok(notice) => {
                    if let Some(recorder) = &recorder {
                        recorder.notice(id, &notice);
                    }
                    if socket
                        .send(Message::Text(serde_json::to_string(&notice)?.into()))
                        .is_err()
                    {
                        gone = true;
                        break;
                    }
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => {
                    gone = true;
                    break;
                }
            }
        }
        if gone {
            break Ok(());
        }
        match socket.read() {
            Ok(Message::Text(text)) => match serde_json::from_str::<Request>(&text) {
                Ok(request) => {
                    if let Some(recorder) = &recorder {
                        recorder.request(id, &request);
                    }
                    Daemon::handle(shared, id, request);
                }
                Err(error) => log::warn!("remote: unreadable request: {error}"),
            },
            Ok(Message::Close(_)) => break Ok(()),
            Ok(_) => {}
            Err(tungstenite::Error::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed) => {
                break Ok(());
            }
            Err(error) => break Err(error.into()),
        }
    };
    Daemon::gone(shared, id);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn head(text: &str) -> Head {
        parse_head(text).expect("head")
    }

    #[test]
    fn reads_a_request_head() {
        let h = head(
            "GET /ws?token=abc HTTP/1.1\r\nHost: localhost:7421\r\nCookie: a=1; cedian_remote=t\r\n\r\n",
        );
        assert_eq!(h.method, "GET");
        assert_eq!(h.path(), "/ws");
        assert_eq!(h.query("token"), Some("abc"));
        assert_eq!(h.header("host"), Some("localhost:7421"));
        assert!(has_token(&h, "t"));
        assert!(!has_token(&h, "u"));
    }

    #[test]
    fn serves_this_machine_and_the_tailnet_only() {
        for ok in [
            "localhost:7421",
            "127.0.0.1",
            "[::1]:7421",
            "mac.tail1234.ts.net",
            "https://mac.tail1234.ts.net",
        ] {
            assert!(allowed_host(ok), "{ok}");
        }
        for bad in [
            "evil.example",
            "evil.example:7421",
            "ts.net.evil.example",
            "http://localhost.evil.example",
            "192.168.1.9:7421",
        ] {
            assert!(!allowed_host(bad), "{bad}");
        }
    }

    #[test]
    fn routes_by_token_host_and_method() {
        let dir = tempfile::tempdir().expect("dir");
        std::fs::write(dir.path().join("index.html"), "<html>").expect("index");
        let web = Some(dir.path());
        let get = |text: &str| route(&head(text), "t", web);
        assert!(matches!(
            get("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n"),
            Reply::Status(401, _)
        ));
        assert!(matches!(
            get("GET /?token=t HTTP/1.1\r\nHost: localhost\r\n\r\n"),
            Reply::Login
        ));
        assert!(matches!(
            get("GET /?token=x HTTP/1.1\r\nHost: localhost\r\n\r\n"),
            Reply::Status(401, _)
        ));
        assert!(matches!(
            get("GET / HTTP/1.1\r\nHost: localhost\r\nCookie: cedian_remote=t\r\n\r\n"),
            Reply::File(_)
        ));
        assert!(matches!(
            get("GET / HTTP/1.1\r\nHost: evil.example\r\nCookie: cedian_remote=t\r\n\r\n"),
            Reply::Status(421, _)
        ));
        assert!(matches!(
            get("POST / HTTP/1.1\r\nHost: localhost\r\nCookie: cedian_remote=t\r\n\r\n"),
            Reply::Status(405, _)
        ));
        assert!(matches!(
            get("GET /../secret HTTP/1.1\r\nHost: localhost\r\nCookie: cedian_remote=t\r\n\r\n"),
            Reply::Status(404, _)
        ));
        assert!(matches!(
            get("GET /.env HTTP/1.1\r\nHost: localhost\r\nCookie: cedian_remote=t\r\n\r\n"),
            Reply::Status(404, _)
        ));
    }

    #[test]
    fn the_token_is_made_once_and_kept_to_the_owner() {
        let dir = tempfile::tempdir().expect("dir");
        let a = token(dir.path()).expect("token");
        assert_eq!(a.len(), 64);
        assert_eq!(token(dir.path()).expect("again"), a);
        let mode = std::fs::metadata(dir.path().join("remote-token"))
            .expect("meta")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
