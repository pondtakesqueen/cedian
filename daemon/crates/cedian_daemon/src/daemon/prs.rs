//! The daemon's side of following each thread's pull request (`pr_watch`): which threads it
//! follows, when it looks, and how what it finds reaches the thread. `gh` runs outside the lock.

use std::{
    path::{Path, PathBuf},
    time::Instant,
};

use cedian_index::{project_key, read_thread, threads_dir};
use cedian_wire::{Helpers, PrState};

use super::{Daemon, Shared, lock};
use crate::{
    cedia::Flags,
    desktop_settings::{read_desktop, settings_path},
    pr_watch::{self, Action, Watch},
};

/// A run the watch asks for goes without the planner and the reviewer: it has one failure or
/// a few comments to answer, and the person's plan and review roles cost a model round each.
fn fix_helpers() -> Helpers {
    Helpers {
        plan: Some("none".into()),
        review: Some("none".into()),
        ..Helpers::default()
    }
}

impl Daemon {
    /// Whether the person left `desktop.prWatch` on (the default).
    fn pr_watch_on(&self) -> bool {
        read_desktop(&settings_path(&self.home))
            .ok()
            .and_then(|desktop| desktop.get("prWatch").and_then(serde_json::Value::as_bool))
            .unwrap_or(true)
    }

    /// After a run of `thread` ends: follow its branch's PR, or look again soon when it is
    /// already followed (the run may have pushed). The first look finds out whether there is one.
    pub fn follow_pr(shared: &Shared, project: &Path, thread: &str) {
        let cwd = {
            let mut daemon = lock(shared);
            if !daemon.pr_watch_on() || daemon.pr_unwatched.contains(&project_key(project), thread)
            {
                return;
            }
            if let Some(watch) = daemon.prs.get_mut(thread) {
                watch.next_check = Instant::now();
                if !std::mem::take(&mut watch.asked) {
                    return;
                }
                // The run the watch asked for ended: its commits go up from here.
                let (cwd, branch) = (watch.cwd.clone(), watch.branch.clone());
                let env = daemon.gh.env().clone();
                daemon.refresh(&project_key(project));
                drop(daemon);
                match pr_watch::push(&env, &cwd, &branch) {
                    Ok(said) => log::info!("{thread}: pushed {branch}: {said}"),
                    Err(error) => log::warn!("{thread}: pushing {branch}: {error:#}"),
                }
                return;
            }
            let slug = project_key(project);
            let Ok(summary) = read_thread(&threads_dir(&daemon.home, &slug), thread) else {
                return;
            };
            // Where its latest session ran, else the project itself.
            daemon
                .thread_cwd(&slug, &summary)
                .unwrap_or_else(|| project.to_path_buf())
        };
        let Some(branch) = pr_watch::branch(&cwd).filter(|_| pr_watch::has_remote(&cwd)) else {
            return;
        };
        let since = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        lock(shared)
            .prs
            .entry(thread.to_string())
            .or_insert_with(|| Watch::new(project.to_path_buf(), cwd, branch, since));
    }

    /// หยุดเฝ้า and เฝ้า PR: the person's choice for one thread, which outlasts a restart. Watching
    /// again looks at once; stopping drops the watch and its chip, and a run it asked for
    /// that is still going is no longer pushed for.
    pub fn watch_pr(shared: &Shared, cwd: &Path, thread: &str, watch: bool) {
        let slug = project_key(cwd);
        {
            let mut daemon = lock(shared);
            if !daemon.pr_unwatched.set(&slug, thread, watch) {
                return;
            }
            if !watch {
                daemon.prs.remove(thread);
            }
            daemon.refresh(&slug);
        }
        if watch {
            Self::follow_pr(shared, cwd, thread);
        }
    }

    /// Looks at each followed PR that is due, each on a thread of its own.
    pub fn check_prs(shared: &Shared) {
        let due: Vec<(String, PathBuf, String)> = {
            let mut daemon = lock(shared);
            if daemon.prs.is_empty() || !daemon.pr_watch_on() {
                return;
            }
            let now = Instant::now();
            daemon
                .prs
                .iter_mut()
                .filter(|(_, w)| {
                    !w.checking && w.next_check <= now && !(w.pr.is_some() && w.over())
                })
                .map(|(thread, w)| {
                    w.checking = true;
                    (thread.clone(), w.cwd.clone(), w.branch.clone())
                })
                .collect()
        };
        for (thread, cwd, branch) in due {
            let shared = shared.clone();
            std::thread::spawn(move || Self::check_pr(&shared, &thread, &cwd, &branch));
        }
    }

    fn check_pr(shared: &Shared, thread: &str, cwd: &Path, branch: &str) {
        let gh = lock(shared).gh.clone();
        let pr = match gh.view(cwd, branch) {
            Ok(pr) => pr,
            Err(error) if error.to_string().contains("no git remotes") => {
                lock(shared).prs.remove(thread);
                return;
            }
            Err(error) => {
                log::warn!("watching {thread}'s PR: {error:#}");
                if let Some(watch) = lock(shared).prs.get_mut(thread) {
                    watch.checking = false;
                    watch.next_check = Instant::now() + pr_watch::SLOWER;
                }
                return;
            }
        };
        let open = pr.as_ref().is_some_and(|pr| pr.state() == PrState::Open);
        let lines = match &pr {
            Some(pr) if open => gh.line_comments(cwd, pr.number).unwrap_or_else(|error| {
                log::warn!("{error:#}");
                Vec::new()
            }),
            _ => Vec::new(),
        };
        let me = {
            let known = lock(shared).gh_login.clone();
            match known {
                Some(me) => me,
                None if open => match gh.me(cwd) {
                    Ok(me) => {
                        lock(shared).gh_login = Some(me.clone());
                        me
                    }
                    Err(error) => {
                        log::warn!("{error:#}");
                        String::new()
                    }
                },
                None => String::new(),
            }
        };
        let (action, project, merged) = {
            let mut daemon = lock(shared);
            let Some(watch) = daemon.prs.get_mut(thread) else {
                return;
            };
            watch.checking = false;
            let before = watch.chip();
            watch.saw(pr.clone(), Instant::now());
            let action = pr
                .as_ref()
                .and_then(|pr| pr_watch::next(pr, &lines, &me, &mut watch.seen));
            let project = watch.project.clone();
            let merged = watch.chip().is_some_and(|c| c.state == PrState::Merged);
            let changed = before != watch.chip() || action.is_some();
            // A thread with no PR is not followed; a merged or closed one keeps its chip.
            if pr.is_none() {
                daemon.prs.remove(thread);
            }
            if changed {
                daemon.refresh(&project_key(&project));
            }
            (
                action,
                project,
                merged && before.is_none_or(|c| c.state != PrState::Merged),
            )
        };
        if merged {
            // A merged PR is nothing owed.
            Self::archive_merged(shared, &project, thread);
        }
        let (Some(action), Some(pr)) = (action, pr) else {
            return;
        };
        let logs: Vec<(String, String)> = match &action {
            Action::FixCi { runs, .. } => runs
                .iter()
                .map(|run| (run.clone(), Self::failed_log(&gh, cwd, run)))
                .collect(),
            _ => Vec::new(),
        };
        if pr_watch::never_ran(&logs) {
            log::warn!(
                "{thread}: PR #{} failed CI with no log; not asking for a fix",
                pr.number
            );
            return;
        }
        let text = pr_watch::prompt(&pr, &action, &logs);
        log::info!("{thread}: PR #{} asks for {action:?}", pr.number);
        Self::tell_thread(shared, &project, cwd, thread, &text);
    }

    /// Gives the thread `text`: a message while a run works, else its next run, on its own model
    /// and under its last permission.
    fn tell_thread(shared: &Shared, project: &Path, cwd: &Path, thread: &str, text: &str) {
        let (running, cedia, model, permission) = {
            let mut daemon = lock(shared);
            if let Some(watch) = daemon.prs.get_mut(thread) {
                watch.asked = true;
            }
            let summary =
                read_thread(&threads_dir(&daemon.home, &project_key(project)), thread).ok();
            let model = summary
                .as_ref()
                .and_then(|s| s.writer_model().map(str::to_string));
            let permission = summary
                .as_ref()
                .and_then(|s| s.runs.iter().rev().find_map(|r| r.permission.clone()));
            (
                daemon.running(thread),
                daemon.cedia.clone(),
                model,
                permission,
            )
        };
        if running {
            if let Err(error) = cedia.send(project, thread, text, &[]) {
                log::warn!("{error:#}");
            }
            return;
        }
        let helpers = fix_helpers();
        Self::prompt(
            shared,
            None,
            project.to_path_buf(),
            cwd.to_path_buf(),
            text,
            Some(thread.to_string()),
            Flags {
                model: model.as_deref(),
                permission: permission.as_deref(),
                helpers: Some(&helpers),
                ..Flags::default()
            },
        );
    }

    /// The end of a failed run's log. GitHub may not have it the moment the check fails, so
    /// it is asked again a few times, 15 seconds apart.
    fn failed_log(gh: &pr_watch::Gh, cwd: &Path, run: &str) -> String {
        let mut log = gh.failed_log(cwd, run);
        for _ in 0..3 {
            if !log.starts_with("(no log") {
                break;
            }
            std::thread::sleep(std::time::Duration::from_secs(15));
            log = gh.failed_log(cwd, run);
        }
        log
    }

    fn archive_merged(shared: &Shared, project: &Path, thread: &str) {
        let cedia = {
            let daemon = lock(shared);
            if daemon.running(thread) {
                return;
            }
            daemon.cedia.clone()
        };
        match cedia.archive(project, thread, true) {
            Ok(()) => {
                log::info!("archived {thread}: its PR merged");
                lock(shared).mark_seen(project, thread);
            }
            Err(error) => log::warn!("archiving {thread}: {error:#}"),
        }
    }
}
