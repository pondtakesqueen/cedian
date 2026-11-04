//! Remote control end to end: the daemon binary with `desktop.remote.port` set serves a
//! browser window over a WebSocket, and refuses one without the token or from another site.

use std::{
    io::{Read as _, Write as _},
    net::{TcpListener, TcpStream},
    os::unix::net::UnixStream,
    path::Path,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

use cedian_wire::Notice;
use tungstenite::{Message, client::IntoClientRequest as _, http::HeaderValue};

struct Daemon(Child);

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind")
        .local_addr()
        .expect("addr")
        .port()
}

fn start(dir: &Path, port: u16, web: &Path) -> Daemon {
    let home = dir.join("home");
    std::fs::create_dir_all(&home).expect("home");
    std::fs::write(
        home.join("settings.json"),
        format!(r#"{{"desktop":{{"remote":{{"port":{port},"projects":["/repo"]}}}}}}"#),
    )
    .expect("settings");
    let child = Command::new(env!("CARGO_BIN_EXE_cedian-daemon"))
        .env("CEDIAN_NO_LOGIN_ENV", "1")
        .env("CEDIAN_STATE_DIR", dir.join("state"))
        .env(
            "CEDIAN_CEDIA_BIN",
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fake/cedia"),
        )
        .env("CEDIA_HOME", &home)
        .env("CEDIAN_REMOTE_WEB", web)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("daemon");
    let start = Instant::now();
    while UnixStream::connect(dir.join("state/daemon.sock")).is_err()
        || TcpStream::connect(("127.0.0.1", port)).is_err()
    {
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "daemon never bound"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    Daemon(child)
}

fn http(port: u16, request: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
    stream.write_all(request.as_bytes()).expect("write");
    let mut out = String::new();
    stream.read_to_string(&mut out).expect("read");
    out
}

#[test]
fn a_browser_window_with_the_token_gets_the_daemon_s_notices() {
    let dir = tempfile::tempdir().expect("dir");
    let web = dir.path().join("web");
    std::fs::create_dir_all(&web).expect("web");
    std::fs::write(
        web.join("index.html"),
        "<!doctype html><title>cedian</title>",
    )
    .expect("index");
    let port = free_port();
    let _daemon = start(dir.path(), port, &web);
    let token = std::fs::read_to_string(dir.path().join("state/remote-token")).expect("token");

    // The page: not without the token; the token link sets the cookie; the cookie opens it.
    assert!(http(port, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n").starts_with("HTTP/1.1 401"));
    let login = http(
        port,
        &format!("GET /?token={token} HTTP/1.1\r\nHost: localhost\r\n\r\n"),
    );
    assert!(login.starts_with("HTTP/1.1 303"), "{login}");
    assert!(login.contains("HttpOnly; SameSite=Strict"));
    let page = http(
        port,
        &format!("GET / HTTP/1.1\r\nHost: localhost\r\nCookie: cedian_remote={token}\r\n\r\n"),
    );
    assert!(
        page.starts_with("HTTP/1.1 200") && page.contains("<title>cedian</title>"),
        "{page}"
    );
    assert!(
        http(
            port,
            &format!(
                "GET / HTTP/1.1\r\nHost: evil.example\r\nCookie: cedian_remote={token}\r\n\r\n"
            )
        )
        .starts_with("HTTP/1.1 421")
    );

    let config = http(
        port,
        &format!(
            "GET /config.json HTTP/1.1\r\nHost: localhost\r\nCookie: cedian_remote={token}\r\n\r\n"
        ),
    );
    assert!(config.ends_with(r#"{"projects":["/repo"]}"#), "{config}");

    let socket = |cookie: Option<&str>, origin: &str| {
        let mut request = format!("ws://127.0.0.1:{port}/ws")
            .into_client_request()
            .expect("request");
        request
            .headers_mut()
            .insert("Origin", HeaderValue::from_str(origin).expect("origin"));
        if let Some(cookie) = cookie {
            request.headers_mut().insert(
                "Cookie",
                HeaderValue::from_str(&format!("cedian_remote={cookie}")).expect("cookie"),
            );
        }
        tungstenite::client::client(
            request,
            TcpStream::connect(("127.0.0.1", port)).expect("tcp"),
        )
        .ok()
    };
    assert!(
        socket(None, "http://localhost").is_none(),
        "a socket without the token"
    );
    assert!(
        socket(Some(&token), "https://evil.example").is_none(),
        "a socket from another site"
    );

    let (mut ws, _) = socket(Some(&token), "https://mac.tail1234.ts.net").expect("socket");
    ws.get_mut()
        .set_read_timeout(Some(Duration::from_secs(10)))
        .expect("timeout");
    let Message::Text(first) = ws.read().expect("first notice") else {
        panic!("a text frame")
    };
    let notice: Notice = serde_json::from_str(&first).expect("a notice");
    assert!(matches!(notice, Notice::Welcome { .. }), "{first}");
}
