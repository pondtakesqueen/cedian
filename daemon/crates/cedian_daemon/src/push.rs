//! Phone notifications for remote control (spec §6.5): when a thread of a project in
//! `desktop.remote.projects` comes to need the person (it asks, failed, stopped short or
//! finished) and no window has shown it since, the daemon posts one line to
//! `desktop.remote.push`, an ntfy topic URL. The ntfy app on the phone shows it, and a tap
//! opens `desktop.remote.link` at that project.
//!
//! The line holds the project's folder name and the thread's title, never the question or
//! the work: the topic's server sees what is posted.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

use cedian_index::project_key;
use cedian_wire::{Status, ThreadInfo};
use serde_json::Value;

use crate::daemon::{Shared, lock};

const EVERY: Duration = Duration::from_secs(5);

/// Where notifications go, read from `desktop.remote` on each round so a change to the
/// settings takes without a restart.
#[derive(Clone, Debug, PartialEq)]
pub struct PushConfig {
    /// The ntfy topic URL, e.g. `https://ntfy.sh/<a long random name>`.
    pub url: String,
    /// The remote page's address as the phone reaches it, e.g. `https://mac.tail1234.ts.net`.
    pub link: Option<String>,
    pub projects: Vec<PathBuf>,
}

pub fn push_config(desktop: &Value) -> Option<PushConfig> {
    let remote = desktop.get("remote")?;
    let url = remote.get("push")?.as_str()?.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return None;
    }
    Some(PushConfig {
        url: url.to_owned(),
        link: remote
            .get("link")
            .and_then(Value::as_str)
            .map(|link| link.trim_end_matches('/').to_owned())
            .filter(|link| link.starts_with("https://") || link.starts_with("http://")),
        projects: remote
            .get("projects")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(PathBuf::from)
                    .collect()
            })
            .unwrap_or_default(),
    })
}

/// One notification.
#[derive(Clone, Debug, PartialEq)]
pub struct Push {
    pub title: &'static str,
    pub message: String,
    pub click: Option<String>,
}

/// What was told already: for each `<project>/<thread>`, the `updated_at` last pushed or
/// found when the project was first looked at.
#[derive(Default)]
pub struct Pushes {
    told: HashMap<String, String>,
    primed: HashSet<String>,
}

impl Pushes {
    /// The notifications `threads` call for. The first look at a project only notes what is
    /// there, so a restart does not repeat the old ones.
    pub fn due(
        &mut self,
        slug: &str,
        cwd: &Path,
        threads: &[ThreadInfo],
        link: Option<&str>,
    ) -> Vec<Push> {
        let first = self.primed.insert(slug.to_owned());
        let mut out = Vec::new();
        for info in threads {
            let key = format!("{slug}/{}", info.thread.id);
            let at = &info.thread.updated_at;
            if self.told.get(&key) == Some(at) {
                continue;
            }
            if first {
                self.told.insert(key, at.clone());
                continue;
            }
            let Some(title) = headline(info.status) else {
                continue;
            };
            if !info.needs_you || info.thread.archived {
                continue;
            }
            self.told.insert(key, at.clone());
            let project = cwd
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| cwd.display().to_string());
            out.push(Push {
                title,
                message: format!("{project}: {}", info.thread.title),
                click: link.map(|link| format!("{link}/?cwd={}", encode(&cwd.to_string_lossy()))),
            });
        }
        out
    }
}

fn headline(status: Status) -> Option<&'static str> {
    match status {
        Status::Asking => Some("cedian: a thread asks you"),
        Status::Failed => Some("cedian: a thread failed"),
        Status::Interrupted => Some("cedian: a thread stopped short"),
        Status::Done => Some("cedian: a thread is done"),
        Status::Queued | Status::Working | Status::Stopped => None,
    }
}

/// Percent-encodes everything but unreserved characters and `/`.
fn encode(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Posts one notification with curl, as ntfy takes it: the message as the body, the title and
/// the tap's link as headers (ASCII only, so the thread's title goes in the body).
pub fn send(url: &str, push: &Push) -> anyhow::Result<()> {
    let mut command = Command::new("curl");
    command
        .args(["-fsS", "--max-time", "10", "-o", "/dev/null"])
        .args(["-H", &format!("Title: {}", push.title)])
        .args(["-H", "Tags: speech_balloon"]);
    if let Some(click) = &push.click {
        command.args(["-H", &format!("Click: {click}")]);
    }
    let output = command
        .args(["--data-binary", "@-", "--", url])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write as _;
            if let Some(mut stdin) = child.stdin.take() {
                stdin.write_all(push.message.as_bytes())?;
            }
            child.wait_with_output()
        })?;
    if !output.status.success() {
        anyhow::bail!(
            "push to {url}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

pub fn watch_pushes(shared: Shared, home: PathBuf) {
    std::thread::spawn(move || {
        let mut pushes = Pushes::default();
        let settings = crate::desktop_settings::settings_path(&home);
        loop {
            std::thread::sleep(EVERY);
            let config = match crate::desktop_settings::read_desktop(&settings) {
                Ok(desktop) => push_config(&desktop),
                Err(error) => {
                    log::warn!("push: {error:#}");
                    None
                }
            };
            let Some(config) = config else {
                continue;
            };
            for cwd in &config.projects {
                let slug = project_key(cwd);
                let threads = match lock(&shared).threads(&slug) {
                    Ok(threads) => threads,
                    Err(error) => {
                        log::warn!("push: {error:#}");
                        continue;
                    }
                };
                for push in pushes.due(&slug, cwd, &threads, config.link.as_deref()) {
                    if let Err(error) = send(&config.url, &push) {
                        log::warn!("{error:#}");
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use cedian_index::ThreadSummary;

    fn info(id: &str, at: &str, status: Status, needs_you: bool) -> ThreadInfo {
        let thread: ThreadSummary = serde_json::from_value(serde_json::json!({
            "id": id, "title": "Fix the login", "task": "t", "state": "done", "result": null,
            "parent": null, "archived": false, "sessions": [], "messages": [],
            "pending": [], "updated_at": at,
        }))
        .expect("summary");
        ThreadInfo {
            thread,
            status,
            cwd: None,
            needs_you,
            pr: None,
            pr_unwatched: false,
        }
    }

    #[test]
    fn a_thread_that_comes_to_need_you_is_pushed_once() {
        let mut pushes = Pushes::default();
        let cwd = Path::new("/Users/me/my app");
        let link = Some("https://mac.tail1234.ts.net");
        // The first look notes what is there: an old question is not pushed after a restart.
        let old = [info("t-1", "1", Status::Asking, true)];
        assert!(pushes.due("p", cwd, &old, link).is_empty());

        let asks = [info("t-1", "2", Status::Asking, true)];
        assert_eq!(
            pushes.due("p", cwd, &asks, link),
            vec![Push {
                title: "cedian: a thread asks you",
                message: "my app: Fix the login".into(),
                click: Some("https://mac.tail1234.ts.net/?cwd=/Users/me/my%20app".into()),
            }]
        );
        assert!(pushes.due("p", cwd, &asks, link).is_empty(), "once");

        // Working is not news; a window that showed it (needs_you false) is not either.
        assert!(
            pushes
                .due("p", cwd, &[info("t-1", "3", Status::Working, false)], link)
                .is_empty()
        );
        assert!(
            pushes
                .due("p", cwd, &[info("t-1", "4", Status::Done, false)], link)
                .is_empty()
        );
        let failed = pushes.due("p", cwd, &[info("t-2", "5", Status::Failed, true)], None);
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].title, "cedian: a thread failed");
        assert_eq!(failed[0].click, None);
    }

    #[test]
    fn push_is_on_with_an_http_topic_url() {
        let desktop = serde_json::json!({"remote": {
            "push": "https://ntfy.sh/cedian-abc", "link": "https://mac.tail1234.ts.net/",
            "projects": ["/repo"]}});
        assert_eq!(
            push_config(&desktop),
            Some(PushConfig {
                url: "https://ntfy.sh/cedian-abc".into(),
                link: Some("https://mac.tail1234.ts.net".into()),
                projects: vec![PathBuf::from("/repo")],
            })
        );
        assert_eq!(
            push_config(&serde_json::json!({"remote": {"push": "file:///etc"}})),
            None
        );
        assert_eq!(push_config(&serde_json::json!({})), None);
    }

    #[test]
    fn send_posts_the_message_with_its_title_and_link() {
        use std::io::{BufRead as _, BufReader, Read as _, Write as _};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            let mut reader = BufReader::new(stream);
            let mut head = Vec::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).expect("line");
                if line == "\r\n" {
                    break;
                }
                if let Some(n) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = n.trim().parse().expect("length");
                }
                head.push(line.trim_end().to_owned());
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).expect("body");
            reader
                .get_mut()
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .expect("reply");
            (head, String::from_utf8(body).expect("utf8"))
        });
        send(
            &format!("http://127.0.0.1:{port}/cedian-abc"),
            &Push {
                title: "cedian: a thread asks you",
                message: "แอป: แก้หน้า login".into(),
                click: Some("https://mac.tail1234.ts.net/?cwd=/repo".into()),
            },
        )
        .expect("send");
        let (head, body) = server.join().expect("server");
        assert_eq!(head[0], "POST /cedian-abc HTTP/1.1");
        assert!(head.contains(&"Title: cedian: a thread asks you".to_owned()));
        assert!(head.contains(&"Click: https://mac.tail1234.ts.net/?cwd=/repo".to_owned()));
        assert_eq!(body, "แอป: แก้หน้า login");
    }
}
