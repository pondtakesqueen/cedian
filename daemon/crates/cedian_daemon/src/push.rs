//! Phone notifications for remote control (spec §6.5): when a thread of a project in
//! `desktop.remote.projects` comes to need the person (it asks, failed, stopped short or
//! finished) and no window has shown it since, the daemon sends a Web Push to each browser
//! that subscribed from the remote page (web_push.rs). A tap opens the page at that project.
//!
//! The notification is encrypted for the subscribed browser, so the push service carrying it
//! cannot read it: it holds the project's folder name, the thread's title and, when the thread
//! asks, its question.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    time::Duration,
};

use cedian_index::project_key;
use cedian_wire::{Status, ThreadInfo};
use serde_json::Value;

use crate::{
    daemon::{Shared, lock},
    web_push::{Sent, Subscriptions, send, vapid_key},
};

const EVERY: Duration = Duration::from_secs(5);
const QUESTION_CHARS: usize = 300;

/// The projects to watch, from `desktop.remote.projects`, read on each round so a change to
/// the settings takes without a restart.
pub fn push_projects(desktop: &Value) -> Vec<PathBuf> {
    desktop
        .pointer("/remote/projects")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(Value::as_str)
                .map(PathBuf::from)
                .collect()
        })
        .unwrap_or_default()
}

/// One notification, as the page's service worker reads it.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Push {
    pub title: String,
    pub body: String,
    /// The page to open on a tap, at the thread, relative to the page's own origin.
    pub url: String,
    /// One notification per thread: a newer one replaces it.
    pub tag: String,
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
    pub fn due(&mut self, slug: &str, cwd: &Path, threads: &[ThreadInfo]) -> Vec<Push> {
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
            let Some(what) = headline(info.status) else {
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
            let question = info
                .thread
                .question
                .as_ref()
                .filter(|_| info.status == Status::Asking)
                .map(|q| clip(&q.question, QUESTION_CHARS));
            out.push(Push {
                title: format!("{}: {what}", info.thread.title),
                body: match question {
                    Some(question) => format!("{project} · {question}"),
                    None => project,
                },
                url: format!(
                    "/?cwd={}&thread={}",
                    encode(&cwd.to_string_lossy()),
                    encode(&info.thread.id)
                ),
                tag: info.thread.id.clone(),
            });
        }
        out
    }
}

fn headline(status: Status) -> Option<&'static str> {
    match status {
        Status::Asking => Some("asks you"),
        Status::Failed => Some("failed"),
        Status::Interrupted => Some("stopped short"),
        Status::Done => Some("done"),
        Status::Queued | Status::Working | Status::Stopped => None,
    }
}

fn clip(text: &str, chars: usize) -> String {
    let text = text.trim();
    match text.char_indices().nth(chars) {
        Some((end, _)) => format!("{}…", &text[..end]),
        None => text.to_owned(),
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

pub fn watch_pushes(shared: Shared, home: PathBuf, state_dir: PathBuf) {
    std::thread::spawn(move || {
        let mut pushes = Pushes::default();
        let settings = crate::desktop_settings::settings_path(&home);
        let subscriptions = Subscriptions::new(&state_dir);
        loop {
            std::thread::sleep(EVERY);
            let projects = match crate::desktop_settings::read_desktop(&settings) {
                Ok(desktop) => push_projects(&desktop),
                Err(error) => {
                    log::warn!("push: {error:#}");
                    continue;
                }
            };
            for cwd in &projects {
                let slug = project_key(cwd);
                let threads = match lock(&shared).threads(&slug) {
                    Ok(threads) => threads,
                    Err(error) => {
                        log::warn!("push: {error:#}");
                        continue;
                    }
                };
                let due = pushes.due(&slug, cwd, &threads);
                if due.is_empty() {
                    continue;
                }
                let browsers = subscriptions.list();
                if browsers.is_empty() {
                    continue;
                }
                let key = match vapid_key(&state_dir) {
                    Ok(key) => key,
                    Err(error) => {
                        log::warn!("push: {error:#}");
                        continue;
                    }
                };
                for push in due {
                    let Ok(message) = serde_json::to_vec(&push) else {
                        continue;
                    };
                    for browser in &browsers {
                        match send(&key, browser, &message) {
                            Ok(Sent::Delivered) => {}
                            Ok(Sent::Gone) => {
                                if let Err(error) = subscriptions.remove(&browser.endpoint) {
                                    log::warn!("push: {error:#}");
                                }
                            }
                            Err(error) => log::warn!("{error:#}"),
                        }
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
            "question": {"question": "Keep the old session cookie?", "options": []},
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
        // The first look notes what is there: an old question is not pushed after a restart.
        let old = [info("t-1", "1", Status::Asking, true)];
        assert!(pushes.due("p", cwd, &old).is_empty());

        let asks = [info("t-1", "2", Status::Asking, true)];
        assert_eq!(
            pushes.due("p", cwd, &asks),
            vec![Push {
                title: "Fix the login: asks you".into(),
                body: "my app · Keep the old session cookie?".into(),
                url: "/?cwd=/Users/me/my%20app&thread=t-1".into(),
                tag: "t-1".into(),
            }]
        );
        assert!(pushes.due("p", cwd, &asks).is_empty(), "once");

        // Working is not news; a window that showed it (needs_you false) is not either.
        assert!(
            pushes
                .due("p", cwd, &[info("t-1", "3", Status::Working, false)])
                .is_empty()
        );
        assert!(
            pushes
                .due("p", cwd, &[info("t-1", "4", Status::Done, false)])
                .is_empty()
        );
        let failed = pushes.due("p", cwd, &[info("t-2", "5", Status::Failed, true)]);
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].title, "Fix the login: failed");
        assert_eq!(failed[0].body, "my app", "a question only while it asks");
    }

    #[test]
    fn a_long_question_is_clipped() {
        assert_eq!(clip("ก".repeat(5).as_str(), 3), "กกก…");
        assert_eq!(clip(" short ", 3 + 10), "short");
    }

    #[test]
    fn watches_the_remote_projects() {
        let desktop = serde_json::json!({"remote": {"port": 7421, "projects": ["/repo", 3]}});
        assert_eq!(push_projects(&desktop), vec![PathBuf::from("/repo")]);
        assert!(push_projects(&serde_json::json!({})).is_empty());
    }
}
