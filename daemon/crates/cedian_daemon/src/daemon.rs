//! The daemon's state: connected windows, runs, and which window reads which thread. Every
//! piece can be rebuilt from cedia's files except the lines of a run in progress.

mod background;
mod prs;

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard, mpsc::Sender},
};

use cedian_agent::{Change, Transcript};
use cedian_index::{
    ThreadSummary, list_threads, memory_path, opener_model, project_key, project_outputs,
    read_memory, read_thread, session_cwd, session_lines, session_path, threads_dir,
};
use cedian_protocol::{Line, SessionEvent, ThreadState, VersionInfo};
use cedian_wire::{Build, Notice, Request, Status, ThreadInfo};

use crate::{
    Cedia, auto_archive,
    browser::Browser,
    cedia::Flags,
    desktop_settings::{read_desktop, set_desktop_key, settings_path},
    flow::{Flow, Held},
    follow::{Offsets, follow},
    keep_awake::KeepAwake,
    ledger::{Ledger, RunRecord, still_running},
    review::{Changes, DecisionStore, decide},
    run::{Run, RunId, watch},
    seen::Seen,
    thread_watch::{Fingerprints, fingerprint},
};

pub type Shared = Arc<Mutex<Daemon>>;
pub type ClientId = u64;

/// The state stays usable after a panic in another thread; each change to it is one step.
pub fn lock(shared: &Shared) -> MutexGuard<'_, Daemon> {
    shared
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

struct Client {
    tx: Sender<Notice>,
    /// Threads whose lines this client reads.
    open: HashSet<String>,
    /// Projects whose thread lists this client shows: cwd to project key.
    watching: HashMap<PathBuf, String>,
    /// Projects whose Background tasks block this client shows: cwd to project key.
    background: HashMap<PathBuf, String>,
    /// The open threads this client acks, and its credit for each (`flow`).
    flows: HashMap<String, Flow>,
}

pub struct Daemon {
    cedia: Cedia,
    home: PathBuf,
    version: Result<VersionInfo, String>,
    /// This daemon's binary as it was when the daemon started, for `Notice::Welcome`.
    build: Option<Build>,
    /// The models and permission modes this cedia lists, as `Notice::Choices`, sent to each
    /// window that connects.
    choices: Notice,
    clients: HashMap<ClientId, Client>,
    /// Each open thread's lines folded into the agent pane's blocks, while a window reads it.
    folds: HashMap<String, Transcript>,
    runs: HashMap<RunId, Run>,
    /// Each thread's latest run.
    by_thread: HashMap<String, RunId>,
    keep_awake: KeepAwake,
    ledger: Ledger,
    decisions: DecisionStore,
    /// Line comments and code reviews, by thread (`notes`).
    notes: crate::notes::NoteStore,
    /// The threads directories windows show, as last listed.
    prints: Fingerprints,
    seen: Seen,
    /// Queued threads this daemon has started, by project slug and id, so a slow first run
    /// is not started twice.
    started: HashSet<(String, String)>,
    /// Each shown project's scheduled runs, as last listed.
    schedules: background::Schedules,
    /// The shared Chromium, locked on its own: starting it takes a moment, and only a
    /// Browser block starts it.
    browser: Arc<Mutex<Browser>>,
    /// The pull requests followed, by thread (`pr_watch`).
    prs: HashMap<String, crate::pr_watch::Watch>,
    gh: crate::pr_watch::Gh,
    /// The login `gh` acts as, once asked.
    gh_login: Option<String>,
    /// Threads whose PR the person stopped watching.
    pr_unwatched: crate::pr_watch::Unwatched,
    /// Each window's latest tab completion: its id, and the pid of the cedia answering it once
    /// started. A newer ask stops the one before.
    completing: HashMap<ClientId, (String, Option<u32>)>,
    next_id: u64,
}

/// A thread the person writes in is one they come back to after a pause, often past the
/// five minutes Anthropic keeps a cached prompt by default; an hour costs 2x the input price to
/// write instead of 1.25x and saves rereading the whole thread uncached after each pause.
/// Threads the coordinator queues and scheduled runs keep cedia's default.
const PERSON_CACHE_TTL: &str = "1h";

/// `Notice::Choices` from cedia's `models` and `permissions`, each asked only when this cedia
/// offers it: an older cedia would read the word as a prompt.
fn choices(cedia: &Cedia, version: &Result<VersionInfo, String>) -> Notice {
    let can = |capability| {
        version
            .as_ref()
            .is_ok_and(|v| v.capabilities.contains(&capability))
    };
    fn listed<T>(list: Result<T, String>) -> Option<T> {
        list.inspect_err(|e| log::warn!("{e}")).ok()
    }
    Notice::Choices {
        models: can(cedian_protocol::Capability::Models)
            .then(|| listed(cedia.models()))
            .flatten(),
        permissions: can(cedian_protocol::Capability::Permissions)
            .then(|| listed(cedia.permissions()))
            .flatten(),
    }
}

impl Daemon {
    pub fn new(cedia: Cedia, home: PathBuf, state_dir: &Path) -> Self {
        let version = cedia.version();
        match &version {
            Ok(version) => log::info!("cedia {} at {}", version.version, cedia.bin.display()),
            Err(error) => log::warn!("{error}"),
        }
        let choices = choices(&cedia, &version);
        let browser = Arc::new(Mutex::new(Browser::new(state_dir, cedia.env.clone())));
        let gh = crate::pr_watch::Gh::of(&cedia.env);
        Self {
            cedia,
            home,
            version,
            build: Build::current(),
            choices,
            clients: HashMap::new(),
            folds: HashMap::new(),
            runs: HashMap::new(),
            by_thread: HashMap::new(),
            keep_awake: KeepAwake::default(),
            ledger: Ledger::new(state_dir),
            decisions: DecisionStore::new(state_dir),
            notes: crate::notes::NoteStore::new(state_dir),
            prints: Fingerprints::default(),
            seen: Seen::new(state_dir),
            started: HashSet::new(),
            schedules: background::Schedules::default(),
            browser,
            prs: HashMap::new(),
            gh,
            gh_login: None,
            pr_unwatched: crate::pr_watch::Unwatched::new(state_dir),
            completing: HashMap::new(),
            next_id: 1,
        }
    }

    /// Takes over the runs a previous daemon left going, following each through its session
    /// logs until its process ends.
    pub fn adopt(shared: &Shared) {
        let mut daemon = lock(shared);
        let mut adopted = Vec::new();
        for record in daemon.ledger.load() {
            if !still_running(record.pid) {
                continue;
            }
            let id = daemon.id();
            log::info!(
                "run {id}: following pid {} of {}",
                record.pid,
                record.thread
            );
            daemon.runs.insert(
                id,
                Run {
                    asked_in: record.cwd.clone(),
                    cwd: record.cwd,
                    slug: record.slug,
                    thread: Some(record.thread.clone()),
                    pid: record.pid,
                    alive: true,
                    lines: Vec::new(),
                    before: record.before.into_iter().collect(),
                    requester: None,
                    stderr: Default::default(),
                    followed: Some(Offsets::default()),
                },
            );
            daemon.by_thread.insert(record.thread, id);
            adopted.push(id);
        }
        daemon.save_ledger();
        let working = !adopted.is_empty();
        daemon.keep_awake.set(working);
        drop(daemon);
        for id in adopted {
            follow(shared.clone(), id);
        }
    }

    /// Writes the live runs with known threads, for the next daemon to adopt.
    fn save_ledger(&self) {
        let records: Vec<RunRecord> = self
            .runs
            .values()
            .filter(|run| run.alive)
            .filter_map(|run| {
                Some(RunRecord {
                    pid: run.pid,
                    thread: run.thread.clone()?,
                    cwd: run.cwd.clone(),
                    slug: run.slug.clone(),
                    before: run.before.iter().cloned().collect(),
                })
            })
            .collect();
        if let Err(error) = self.ledger.save(&records) {
            log::warn!("{error:#}");
        }
    }

    /// One poll of a followed run: new session log lines go to its readers, and a process that
    /// is gone ends the run. Returns whether to poll again.
    pub fn poll_followed(&mut self, id: RunId) -> bool {
        let Some(run) = self.runs.get(&id) else {
            return false;
        };
        let (Some(thread), pid) = (run.thread.clone(), run.pid) else {
            return false;
        };
        let running = still_running(pid);
        let sessions = match read_thread(&threads_dir(&self.home, &run.slug), &thread) {
            Ok(summary) => summary.sessions,
            Err(error) => {
                log::warn!("{error:#}");
                Vec::new()
            }
        };
        let paths: Vec<PathBuf> = sessions
            .iter()
            .filter(|s| !run.before.contains(&s.session_id))
            .map(|s| session_path(&self.home, &run.slug, &s.session_id, s.path.as_deref()))
            .collect();
        let mut lines = Vec::new();
        if let Some(Run {
            followed: Some(offsets),
            ..
        }) = self.runs.get_mut(&id)
        {
            for path in &paths {
                lines.extend(offsets.read_new(path));
            }
        }
        for line in lines {
            self.on_line(id, line);
        }
        if !running {
            self.on_exit(id, "ended while another daemon had it".to_owned());
        }
        running
    }

    fn id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    pub fn connect(&mut self, tx: Sender<Notice>) -> ClientId {
        let id = self.id();
        self.clients.insert(
            id,
            Client {
                tx,
                open: HashSet::new(),
                watching: HashMap::new(),
                background: HashMap::new(),
                flows: HashMap::new(),
            },
        );
        self.send(
            id,
            Notice::Welcome {
                daemon: env!("CARGO_PKG_VERSION").to_owned(),
                cedia: self.version.clone(),
                build: self.build.clone(),
                protocol: Some(cedian_protocol::PROTOCOL_HASH.trim().to_owned()),
            },
        );
        self.send(id, self.choices.clone());
        id
    }

    pub fn disconnect(&mut self, id: ClientId) {
        self.clients.remove(&id);
        if let Some((_, Some(pid))) = self.completing.remove(&id) {
            stop_child(pid);
        }
        for run in self.runs.values_mut() {
            if run.requester == Some(id) {
                run.requester = None;
            }
        }
    }

    fn send(&mut self, id: ClientId, notice: Notice) {
        let gone = match self.clients.get(&id) {
            Some(client) => client.tx.send(notice).is_err(),
            None => false,
        };
        if gone {
            self.disconnect(id);
        }
    }

    /// An error for the client that asked, or the log when the daemon asked itself.
    fn error_to(&mut self, id: Option<ClientId>, message: String) {
        match id {
            Some(id) => self.error(id, message),
            None => log::warn!("{message}"),
        }
    }

    fn error(&mut self, id: ClientId, message: String) {
        log::warn!("client {id}: {message}");
        self.send(
            id,
            Notice::Error {
                message,
                thread: None,
                settings: false,
            },
        );
    }

    /// An error about one thread, shown in the pane only while that thread is open.
    fn thread_error(&mut self, id: ClientId, thread: &str, message: String) {
        log::warn!("client {id}, {thread}: {message}");
        self.send(
            id,
            Notice::Error {
                message,
                thread: Some(thread.to_owned()),
                settings: false,
            },
        );
    }

    /// An error for the settings window, shown there.
    fn settings_error(&mut self, id: ClientId, message: String) {
        log::warn!("client {id}, settings: {message}");
        self.send(
            id,
            Notice::Error {
                message,
                thread: None,
                settings: true,
            },
        );
    }

    /// Sends a notice to every client that has the thread open.
    fn tell_readers(&mut self, thread: &str, notice: &Notice) {
        let readers: Vec<ClientId> = self
            .clients
            .iter()
            .filter(|(_, client)| client.open.contains(thread))
            .map(|(id, _)| *id)
            .collect();
        for id in readers {
            self.send(id, notice.clone());
        }
    }

    fn running(&self, thread: &str) -> bool {
        self.by_thread
            .get(thread)
            .and_then(|id| self.runs.get(id))
            .is_some_and(|run| run.alive)
    }

    fn threads(&mut self, slug: &str) -> anyhow::Result<Vec<ThreadInfo>> {
        let mut threads = Vec::new();
        for thread in list_threads(&threads_dir(&self.home, slug))? {
            // A window showing the thread as it changes counts as seeing it.
            if self.clients.values().any(|c| c.open.contains(&thread.id)) {
                self.seen.mark(slug, &thread.id, &thread.updated_at);
            }
            let status = Status::of(thread.state, self.running(&thread.id));
            threads.push(ThreadInfo {
                needs_you: self
                    .seen
                    .needs_you(slug, &thread.id, &thread.updated_at, status),
                status,
                cwd: self.thread_cwd(slug, &thread),
                pr: self
                    .prs
                    .get(&thread.id)
                    .and_then(crate::pr_watch::Watch::chip),
                pr_unwatched: self.pr_unwatched.contains(slug, &thread.id),
                thread,
            });
        }
        Ok(threads)
    }

    /// The directory the thread's latest session ran in, if it is still there.
    fn thread_cwd(&self, slug: &str, thread: &ThreadSummary) -> Option<PathBuf> {
        let session = thread.sessions.last()?;
        let path = session_path(
            &self.home,
            slug,
            &session.session_id,
            session.path.as_deref(),
        );
        session_cwd(&path).filter(|cwd| cwd.is_dir())
    }

    fn status(&self, slug: &str, thread: &str) -> Status {
        match read_thread(&threads_dir(&self.home, slug), thread) {
            Ok(summary) => Status::of(summary.state, self.running(thread)),
            Err(_) if self.running(thread) => Status::Working,
            Err(error) => {
                log::warn!("{error:#}");
                Status::Failed
            }
        }
    }

    /// The threads directory of each project some window shows.
    pub fn shown_thread_dirs(&self) -> Vec<(String, PathBuf)> {
        let mut slugs: Vec<String> = self
            .clients
            .values()
            .flat_map(|client| client.watching.values().cloned())
            .collect();
        slugs.sort();
        slugs.dedup();
        slugs
            .into_iter()
            .map(|slug| {
                let dir = threads_dir(&self.home, &slug);
                (slug, dir)
            })
            .collect()
    }

    /// Refreshes each project whose threads directory changed since it was last listed.
    pub fn threads_seen(&mut self, prints: Vec<(String, u64)>) {
        let shown: Vec<String> = prints.iter().map(|(slug, _)| slug.clone()).collect();
        self.prints.retain(&shown);
        for (slug, print) in prints {
            if self.prints.changed(&slug, print) {
                self.refresh(&slug);
            }
        }
    }

    /// Sends the project's thread list to every client showing it.
    fn refresh(&mut self, slug: &str) {
        let watchers: Vec<(ClientId, PathBuf)> = self
            .clients
            .iter()
            .flat_map(|(id, client)| {
                client
                    .watching
                    .iter()
                    .filter(|(_, key)| key.as_str() == slug)
                    .map(|(cwd, _)| (*id, cwd.clone()))
            })
            .collect();
        if watchers.is_empty() {
            return;
        }
        match self.threads(slug) {
            Ok(threads) => {
                for (id, cwd) in watchers {
                    self.send(
                        id,
                        Notice::Threads {
                            cwd,
                            threads: threads.clone(),
                        },
                    );
                }
            }
            Err(error) => log::warn!("{error:#}"),
        }
    }

    pub fn handle(shared: &Shared, client: ClientId, request: Request) {
        match request {
            Request::Threads { cwd } => {
                let mut daemon = lock(shared);
                let slug = project_key(&cwd);
                let print = fingerprint(&threads_dir(&daemon.home, &slug));
                daemon.prints.changed(&slug, print);
                match daemon.threads(&slug) {
                    Ok(threads) => {
                        if let Some(c) = daemon.clients.get_mut(&client) {
                            c.watching.insert(cwd.clone(), slug);
                        }
                        daemon.send(client, Notice::Threads { cwd, threads });
                    }
                    Err(error) => daemon.error(client, format!("{error:#}")),
                }
            }
            Request::Open { cwd, thread } => lock(shared).open(client, &cwd, &thread),
            Request::Ack { thread } => lock(shared).ack(client, &thread),
            Request::Close { thread } => {
                let mut daemon = lock(shared);
                if let Some(c) = daemon.clients.get_mut(&client) {
                    c.open.remove(&thread);
                    c.flows.remove(&thread);
                }
                if !daemon.clients.values().any(|c| c.open.contains(&thread)) {
                    daemon.folds.remove(&thread);
                }
            }
            Request::Prompt {
                cwd,
                text,
                thread,
                worktree,
                profile,
                model,
                permission,
                effort,
                helpers,
                images,
            } => {
                let with = Flags {
                    profile: profile.as_deref(),
                    model: model.as_deref(),
                    permission: permission.as_deref(),
                    effort: effort.as_deref(),
                    helpers: Some(&helpers),
                    images: &images,
                    cache_ttl: Some(PERSON_CACHE_TTL),
                    ..Flags::default()
                };
                let running = thread.as_deref().is_some_and(|t| lock(shared).running(t));
                match thread {
                    // A cedia older than `threads.send-images` sends text only; an image then
                    // goes with the next run.
                    Some(_)
                        if running
                            && !images.is_empty()
                            && !Self::can(
                                shared,
                                cedian_protocol::Capability::ThreadsSendImages,
                            )
                            .1 =>
                    {
                        lock(shared).thread_error(
                            client,
                            thread.as_deref().unwrap_or_default(),
                            "an image goes with a new run: send it once this one ends".into(),
                        )
                    }
                    // A run is already working on it: the text joins at its next turn.
                    Some(thread) if running => {
                        Self::message(shared, client, &cwd, &thread, &text, &images)
                    }
                    None if worktree => Self::prompt_in_worktree(shared, client, cwd, &text, with),
                    thread => {
                        Self::prompt(shared, Some(client), cwd.clone(), cwd, &text, thread, with)
                    }
                }
            }
            Request::Commands { cwd } => {
                let (cedia, can) = {
                    let daemon = lock(shared);
                    let can = daemon.version.as_ref().is_ok_and(|v| {
                        v.capabilities
                            .contains(&cedian_protocol::Capability::Commands)
                    });
                    (daemon.cedia.clone(), can)
                };
                // An older cedia would read the word as a prompt.
                if !can {
                    return;
                }
                match cedia.commands(&cwd) {
                    Ok(list) => lock(shared).send(
                        client,
                        Notice::Commands {
                            cwd,
                            commands: list.commands,
                        },
                    ),
                    Err(error) => log::warn!("{error}"),
                }
            }
            Request::Background { cwd } => Self::background(shared, client, cwd),
            Request::Schedule { cwd, id, enabled } => {
                Self::set_schedule(shared, client, &cwd, &id, enabled)
            }
            Request::Usage { cwd, since } => {
                let (cedia, can) = {
                    let daemon = lock(shared);
                    let can = daemon.version.as_ref().is_ok_and(|v| {
                        v.capabilities.contains(&cedian_protocol::Capability::Usage)
                    });
                    (daemon.cedia.clone(), can)
                };
                if !can {
                    lock(shared).error(client, "this cedia does not split its usage yet".into());
                    return;
                }
                match cedia.usage(cwd.as_deref(), &since) {
                    Ok(report) => lock(shared).send(
                        client,
                        Notice::Usage {
                            cwd,
                            since,
                            report: Box::new(report),
                        },
                    ),
                    Err(error) => lock(shared).error(client, error),
                }
            }
            Request::Fork {
                cwd,
                thread,
                run,
                text,
                model,
                permission,
                effort,
                helpers,
                images,
            } => {
                let (cedia, can) = {
                    let daemon = lock(shared);
                    let can = daemon.version.as_ref().is_ok_and(|v| {
                        v.capabilities
                            .contains(&cedian_protocol::Capability::ThreadsFork)
                    });
                    (daemon.cedia.clone(), can)
                };
                if !can {
                    return lock(shared).thread_error(
                        client,
                        &thread,
                        "this cedia cannot fork a thread".into(),
                    );
                }
                match cedia.fork(&cwd, &thread, &run) {
                    Ok((forked, kept)) => {
                        // Unnamed, the resent message keeps the forked run's images, when this
                        // cedia shows images at all.
                        let images = images.unwrap_or_else(|| {
                            if Self::can(shared, cedian_protocol::Capability::Images).1 {
                                kept
                            } else {
                                Vec::new()
                            }
                        });
                        lock(shared).send(
                            client,
                            Notice::Forked {
                                cwd: cwd.clone(),
                                from: thread,
                                thread: forked.clone(),
                            },
                        );
                        let with = Flags {
                            model: model.as_deref(),
                            permission: permission.as_deref(),
                            effort: effort.as_deref(),
                            helpers: Some(&helpers),
                            images: &images,
                            cache_ttl: Some(PERSON_CACHE_TTL),
                            ..Flags::default()
                        };
                        // No requester: the window opens the fork itself, for the history the
                        // fork copied, and then reads the run as any open thread's.
                        Self::prompt(shared, None, cwd.clone(), cwd, &text, Some(forked), with);
                    }
                    Err(error) => lock(shared).thread_error(client, &thread, format!("{error:#}")),
                }
            }
            Request::Restore {
                cwd,
                thread,
                redo,
                force,
            } => {
                let (cedia, can) =
                    Self::can(shared, cedian_protocol::Capability::ThreadsRestoreJson);
                if !can {
                    return lock(shared).thread_error(
                        client,
                        &thread,
                        "this cedia cannot undo a turn here".into(),
                    );
                }
                match cedia.restore(&cwd, &thread, redo, force) {
                    Ok(result) => lock(shared).send(
                        client,
                        Notice::Restored {
                            cwd,
                            thread,
                            result,
                        },
                    ),
                    Err(error) => lock(shared).thread_error(client, &thread, format!("{error:#}")),
                }
            }
            Request::Rewind {
                cwd,
                thread,
                n,
                force,
            } => {
                let (cedia, can) =
                    Self::can(shared, cedian_protocol::Capability::ThreadsRestoreJson);
                if !can {
                    return lock(shared).thread_error(
                        client,
                        &thread,
                        "this cedia cannot rewind here".into(),
                    );
                }
                match cedia.rewind(&cwd, &thread, n, force) {
                    Ok(result) => lock(shared).send(
                        client,
                        Notice::Rewound {
                            cwd,
                            thread,
                            n,
                            result,
                        },
                    ),
                    Err(error) => lock(shared).thread_error(client, &thread, format!("{error:#}")),
                }
            }
            Request::Send {
                cwd,
                thread,
                text,
                images,
            } => {
                if !images.is_empty()
                    && !Self::can(shared, cedian_protocol::Capability::ThreadsSendImages).1
                {
                    return lock(shared).thread_error(
                        client,
                        &thread,
                        "this cedia sends text only to a running thread".into(),
                    );
                }
                Self::message(shared, client, &cwd, &thread, &text, &images)
            }
            Request::InlineEdit {
                id,
                cwd,
                file,
                range,
                instruction,
                text,
                model,
            } => {
                let (cedia, can) = Self::can(shared, cedian_protocol::Capability::InlineEdit);
                // The refusal answers the ask, so the window's wait for it ends.
                if !can {
                    let edit = cedian_protocol::InlineEdit::Variant1 {
                        error: "this cedia has no inline edit".into(),
                    };
                    return lock(shared).send(client, Notice::InlineEdit { id, edit });
                }
                // A model answers it: it holds none of the window's other asks.
                let shared = shared.clone();
                std::thread::spawn(move || {
                    let edit = cedia
                        .inline_edit(
                            &cwd,
                            &file,
                            &range,
                            &instruction,
                            text.as_deref(),
                            model.as_deref(),
                        )
                        .unwrap_or_else(|error| cedian_protocol::InlineEdit::Variant1 { error });
                    lock(&shared).send(client, Notice::InlineEdit { id, edit });
                });
            }
            Request::Complete {
                id,
                cwd,
                file,
                at,
                text,
                model,
            } => {
                let (cedia, can) = Self::can(shared, cedian_protocol::Capability::Complete);
                // Answered like any completion, not as an error in the agent pane on every pause.
                if !can {
                    let completion = cedian_protocol::Completion::Variant1 {
                        error: "this cedia has no tab completion".into(),
                    };
                    return lock(shared).send(client, Notice::Completion { id, completion });
                }
                // The window typed on: the ask before this one is stale, so its cedia stops.
                if let Some((_, Some(pid))) =
                    lock(shared).completing.insert(client, (id.clone(), None))
                {
                    stop_child(pid);
                }
                let shared = shared.clone();
                std::thread::spawn(move || {
                    let mine =
                        |d: &Daemon| d.completing.get(&client).is_some_and(|(i, _)| *i == id);
                    let completion = cedia.complete(
                        &cwd,
                        &file,
                        &at,
                        text.as_deref(),
                        model.as_deref(),
                        |pid| {
                            let mut d = lock(&shared);
                            if mine(&d) {
                                d.completing.insert(client, (id.clone(), Some(pid)));
                            } else {
                                stop_child(pid);
                            }
                        },
                    );
                    let mut d = lock(&shared);
                    // A stopped ask gets no answer: the window has moved on to a newer one.
                    if !mine(&d) {
                        return;
                    }
                    d.completing.remove(&client);
                    let completion = completion
                        .unwrap_or_else(|error| cedian_protocol::Completion::Variant1 { error });
                    d.send(client, Notice::Completion { id, completion });
                });
            }
            Request::Stop { thread } => lock(shared).stop(client, &thread),
            Request::Unsend { cwd, thread, ids } => {
                let cedia = lock(shared).cedia.clone();
                if let Err(error) = cedia.unsend(&cwd, &thread, &ids) {
                    lock(shared).thread_error(client, &thread, format!("{error:#}"));
                }
            }
            Request::Rate {
                cwd,
                thread,
                rating,
            } => {
                let cedia = lock(shared).cedia.clone();
                if let Err(error) = cedia.rate(&cwd, &thread, rating) {
                    lock(shared).thread_error(client, &thread, format!("{error:#}"));
                }
            }
            Request::PrWatch { cwd, thread, watch } => Self::watch_pr(shared, &cwd, &thread, watch),
            Request::Archive {
                cwd,
                thread,
                archived,
                force,
            } => {
                let (cedia, quiet, files) = {
                    let daemon = lock(shared);
                    let files = if archived && !force {
                        daemon.uncommitted(&cwd, &thread)
                    } else {
                        Vec::new()
                    };
                    (
                        daemon.cedia.clone(),
                        !daemon.needs_you(&cwd, &thread),
                        files,
                    )
                };
                if !files.is_empty() {
                    lock(shared).send(client, Notice::ArchiveGuard { cwd, thread, files });
                    return;
                }
                match cedia.archive(&cwd, &thread, archived) {
                    // Archiving is the person's own change: a thread that did not need them
                    // still does not.
                    Ok(()) if quiet => lock(shared).mark_seen(&cwd, &thread),
                    Ok(()) => {}
                    Err(error) => lock(shared).thread_error(client, &thread, format!("{error:#}")),
                }
            }
            Request::Rename { cwd, thread, title } => {
                let cedia = lock(shared).cedia.clone();
                if let Err(error) = cedia.rename(&cwd, &thread, &title) {
                    lock(shared).thread_error(client, &thread, format!("{error:#}"));
                }
            }
            Request::Delete { cwd, thread } => {
                let cedia = lock(shared).cedia.clone();
                if let Err(error) = cedia.delete(&cwd, &thread) {
                    lock(shared).thread_error(client, &thread, format!("{error:#}"));
                }
            }
            Request::Git { cwd, thread, fetch } => {
                let dir = lock(shared).folder(&cwd, &thread);
                // A fetch talks to the remote: it holds none of the window's other asks.
                let shared = shared.clone();
                std::thread::spawn(move || {
                    let state = crate::git_state::read(&dir, fetch).map_err(|e| format!("{e:#}"));
                    let after = None;
                    lock(&shared).send(
                        client,
                        Notice::Git {
                            thread,
                            state,
                            after,
                        },
                    );
                });
            }
            Request::GitAction {
                cwd,
                thread,
                action,
            } => {
                let dir = lock(shared).folder(&cwd, &thread);
                let shared = shared.clone();
                std::thread::spawn(move || {
                    if let Err(error) = crate::git_state::act(&dir, action) {
                        lock(&shared).thread_error(client, &thread, format!("{error:#}"));
                    }
                    let state = crate::git_state::read(&dir, false).map_err(|e| format!("{e:#}"));
                    let after = Some(action);
                    lock(&shared).send(
                        client,
                        Notice::Git {
                            thread,
                            state,
                            after,
                        },
                    );
                });
            }
            Request::PrView { cwd, thread } => {
                let (gh, dir) = {
                    let daemon = lock(shared);
                    (daemon.gh.clone(), daemon.folder(&cwd, &thread))
                };
                // gh asks GitHub: it holds none of the window's other asks.
                let shared = shared.clone();
                std::thread::spawn(move || {
                    let view = crate::pr_view::read(&gh, &dir).map_err(|e| format!("{e:#}"));
                    let notice = Notice::PrView {
                        thread,
                        view,
                        acted: false,
                    };
                    lock(&shared).send(client, notice);
                });
            }
            Request::PrAct {
                cwd,
                thread,
                action,
            } => {
                let (gh, dir) = {
                    let daemon = lock(shared);
                    (daemon.gh.clone(), daemon.folder(&cwd, &thread))
                };
                let shared = shared.clone();
                std::thread::spawn(move || {
                    if let Err(error) = crate::pr_view::act(&gh, &dir, &action) {
                        lock(&shared).thread_error(client, &thread, format!("{error:#}"));
                    }
                    let view = crate::pr_view::read(&gh, &dir).map_err(|e| format!("{e:#}"));
                    let notice = Notice::PrView {
                        thread,
                        view,
                        acted: true,
                    };
                    lock(&shared).send(client, notice);
                });
            }
            Request::PrLog { cwd, thread, run } => {
                let (gh, dir) = {
                    let daemon = lock(shared);
                    (daemon.gh.clone(), daemon.folder(&cwd, &thread))
                };
                let shared = shared.clone();
                std::thread::spawn(move || {
                    let log = gh.failed_log(&dir, &run);
                    lock(&shared).send(client, Notice::PrLog { thread, run, log });
                });
            }
            Request::Browser { cwd } => {
                let browser = lock(shared).browser.clone();
                let page = browser
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .page(&project_key(&cwd))
                    .map_err(|e| format!("{e:#}"));
                if let Err(error) = &page {
                    log::warn!("browser: {error}");
                }
                lock(shared).send(client, Notice::Browser { cwd, page });
            }
            Request::CommitDraft { .. }
            | Request::Commit { .. }
            | Request::PrCheck { .. }
            | Request::Pr { .. } => {
                let (cedia, can_commit, can_pr) = {
                    let daemon = lock(shared);
                    let can = |capability| {
                        daemon
                            .version
                            .as_ref()
                            .is_ok_and(|v| v.capabilities.contains(&capability))
                    };
                    (
                        daemon.cedia.clone(),
                        can(cedian_protocol::Capability::Commit),
                        can(cedian_protocol::Capability::Pr),
                    )
                };
                let can = match request {
                    Request::CommitDraft { .. } | Request::Commit { .. } => can_commit,
                    _ => can_pr,
                };
                if !can {
                    lock(shared).error(client, "this cedia does not commit or open PRs yet".into());
                    return;
                }
                // A draft asks a model and a PR pushes: neither holds the window's other asks.
                let shared = shared.clone();
                std::thread::spawn(move || {
                    let notice = match request {
                        Request::CommitDraft { cwd, thread } => cedia
                            .commit_draft(&cwd, &thread)
                            .map(|draft| Notice::CommitDraft { thread, draft }),
                        Request::Commit {
                            cwd,
                            thread,
                            message,
                            files,
                        } => cedia
                            .commit(&cwd, &thread, &message, &files)
                            .map(|result| Notice::Committed { thread, result }),
                        Request::PrCheck { cwd, thread } => cedia
                            .pr_check(&cwd)
                            .map(|plan| Notice::PrPlan { thread, plan }),
                        Request::Pr { cwd, thread } => cedia
                            .pr(&cwd)
                            .map(|result| Notice::PrOpened { thread, result }),
                        _ => return,
                    };
                    match notice {
                        Ok(notice) => lock(&shared).send(client, notice),
                        Err(error) => lock(&shared).error(client, error),
                    }
                });
            }
            Request::McpList
            | Request::McpCheck { .. }
            | Request::McpAdd { .. }
            | Request::McpRemove { .. } => {
                let (cedia, can) = {
                    let daemon = lock(shared);
                    let can = daemon.version.as_ref().is_ok_and(|v| {
                        v.capabilities
                            .contains(&cedian_protocol::Capability::McpManage)
                    });
                    (daemon.cedia.clone(), can)
                };
                if !can {
                    lock(shared).settings_error(
                        client,
                        "this cedia does not manage MCP servers yet".into(),
                    );
                    return;
                }
                let refused = match request {
                    Request::McpCheck { name } => {
                        match cedia.mcp_check(&name) {
                            Ok(check) => lock(shared).send(client, Notice::McpChecked { check }),
                            Err(error) => lock(shared).settings_error(client, error),
                        }
                        return;
                    }
                    Request::McpAdd { name, server } => cedia.mcp_add(&name, &server).err(),
                    Request::McpRemove { name } => cedia.mcp_remove(&name).err(),
                    _ => None,
                };
                match cedia.mcp_list() {
                    Ok(list) => lock(shared).send(client, Notice::Mcp { list, refused }),
                    Err(error) => lock(shared).settings_error(client, error),
                }
            }
            Request::Settings => lock(shared).settings(client),
            Request::SetDesktop { key, value } => lock(shared).set_desktop(client, &key, value),
            Request::Review { cwd, thread } => {
                lock(shared).review(client, &cwd, &thread, None);
            }
            // Read without the lock: Outputs reads every session log of the project.
            Request::Memory { cwd } => {
                let home = lock(shared).home.clone();
                let notes = read_memory(&memory_path(&home, &project_key(&cwd)));
                let mut daemon = lock(shared);
                match notes {
                    Ok(notes) => daemon.send(client, Notice::Memory { cwd, notes }),
                    Err(error) => daemon.error(client, format!("{error:#}")),
                }
            }
            Request::Outputs { cwd } => {
                let home = lock(shared).home.clone();
                let outputs = project_outputs(&home, &project_key(&cwd));
                let mut daemon = lock(shared);
                match outputs {
                    Ok(outputs) => daemon.send(client, Notice::Outputs { cwd, outputs }),
                    Err(error) => daemon.error(client, format!("{error:#}")),
                }
            }
            Request::Comments { thread, comments } => {
                lock(shared).change_notes(client, &thread, |notes| {
                    notes.comments = comments;
                    Ok(())
                });
            }
            Request::Dismiss {
                thread,
                finding,
                dismissed,
            } => {
                lock(shared).change_notes(client, &thread, |notes| {
                    notes.dismissed.retain(|id| *id != finding);
                    if dismissed {
                        notes.dismissed.push(finding);
                    }
                    Ok(())
                });
            }
            Request::SendComments { cwd, thread } => {
                let mut text = None;
                lock(shared).change_notes(client, &thread, |notes| {
                    if notes.comments.is_empty() {
                        return Err("no line comments to send".into());
                    }
                    text = Some(crate::notes::comments_message(&notes.comments));
                    notes.comments.clear();
                    Ok(())
                });
                if let Some(text) = text {
                    Self::deliver(shared, client, cwd, &thread, &text);
                }
            }
            Request::FixFindings {
                cwd,
                thread,
                findings,
            } => {
                let notes = lock(shared).notes.load(&thread);
                let text = notes.review.as_ref().and_then(|review| {
                    let open = crate::notes::open_findings(review, &notes.dismissed, &findings);
                    (!open.is_empty()).then(|| crate::notes::fix_message(review, &open))
                });
                match text {
                    Some(text) => Self::deliver(shared, client, cwd, &thread, &text),
                    None => {
                        lock(shared).thread_error(client, &thread, "no open finding to fix".into())
                    }
                }
            }
            Request::CodeReview { cwd, thread } => {
                let (cedia, can) = Self::can(shared, cedian_protocol::Capability::CodeReview);
                if !can {
                    lock(shared).thread_error(
                        client,
                        &thread,
                        "this cedia does not review a thread yet".into(),
                    );
                    return;
                }
                let mut busy = false;
                lock(shared).change_notes(client, &thread, |notes| {
                    busy = notes.reviewing;
                    notes.reviewing = true;
                    Ok(())
                });
                if busy {
                    return;
                }
                // A review asks a model: it holds none of the window's other asks.
                let shared = shared.clone();
                std::thread::spawn(move || {
                    let review = cedia
                        .code_review(&cwd, &thread)
                        .unwrap_or_else(|error| cedian_protocol::CodeReview::Variant1 { error });
                    lock(&shared).change_notes(client, &thread, |notes| {
                        notes.review = Some(review);
                        notes.dismissed.clear();
                        notes.reviewing = false;
                        Ok(())
                    });
                });
            }
            Request::Decide {
                cwd,
                thread,
                hunk,
                decision,
            } => {
                let told = lock(shared).review(client, &cwd, &thread, Some((&hunk, &decision)));
                match told {
                    Some((work_tree, text)) => {
                        Self::message(shared, client, &work_tree, &thread, &text, &[])
                    }
                    // The last hunk decided may leave nothing owed.
                    None => Self::archive_if_done(shared, &cwd, &thread),
                }
            }
        }
    }

    /// Changes the thread's notes, saves them and tells every window that has it open. An
    /// error from `change` goes to the client and changes nothing.
    fn change_notes(
        &mut self,
        client: ClientId,
        thread: &str,
        change: impl FnOnce(&mut cedian_wire::Notes) -> Result<(), String>,
    ) {
        let mut notes = self.notes.load(thread);
        if let Err(error) = change(&mut notes) {
            return self.thread_error(client, thread, error);
        }
        if let Err(error) = self.notes.save(thread, &notes) {
            return self.thread_error(client, thread, format!("{error:#}"));
        }
        self.tell_readers(
            thread,
            &Notice::Notes {
                thread: thread.to_owned(),
                notes,
            },
        );
    }

    /// The settings window's first ask: the `desktop` key, then the models and modes, which the
    /// window was sent on connecting, before the settings view was there to hear them.
    fn settings(&mut self, client: ClientId) {
        let path = settings_path(&self.home);
        match read_desktop(&path) {
            Ok(desktop) => self.send(client, Notice::Settings { path, desktop }),
            Err(error) => self.settings_error(client, format!("{error:#}")),
        }
        self.send(client, self.choices.clone());
    }

    fn set_desktop(&mut self, client: ClientId, key: &str, value: serde_json::Value) {
        let path = settings_path(&self.home);
        match set_desktop_key(&path, key, value) {
            Ok(desktop) => {
                let clients: Vec<ClientId> = self.clients.keys().copied().collect();
                for id in clients {
                    let notice = Notice::Settings {
                        path: path.clone(),
                        desktop: desktop.clone(),
                    };
                    self.send(id, notice);
                }
            }
            Err(error) => self.settings_error(client, format!("{error:#}")),
        }
    }

    /// Sends the thread's review, after applying a decision if there is one. A reject returns
    /// the worktree and the message for the thread.
    fn review(
        &mut self,
        client: ClientId,
        cwd: &Path,
        thread: &str,
        decision: Option<(&str, &cedian_wire::Decision)>,
    ) -> Option<(PathBuf, String)> {
        let slug = project_key(cwd);
        let result = (|| {
            let summary = read_thread(&threads_dir(&self.home, &slug), thread)?;
            let changes = Changes::of(&self.home, &slug, &summary)?;
            let mut decisions = self.decisions.load(thread);
            let mut review = changes.review(&self.home, &decisions)?;
            let mut told = None;
            if let Some((hunk, decision)) = decision {
                let text = decide(&review, &changes.work_tree, &mut decisions, hunk, decision)?;
                self.decisions.save(thread, &decisions)?;
                told = text.map(|text| (changes.work_tree.clone(), text));
                review = changes.review(&self.home, &decisions)?;
            }
            anyhow::Ok((review, told))
        })();
        match result {
            Ok((review, told)) => {
                self.send(
                    client,
                    Notice::Review {
                        thread: thread.to_owned(),
                        review,
                    },
                );
                told
            }
            Err(error) => {
                self.thread_error(client, thread, format!("{error:#}"));
                None
            }
        }
    }

    /// Whether nothing is owed on the thread, so it archives itself (`auto_archive`). The cheap
    /// checks go first: the review walks cedia's shadow git.
    fn nothing_owed(&self, cwd: &Path, thread: &str) -> bool {
        let slug = project_key(cwd);
        let Ok(summary) = read_thread(&threads_dir(&self.home, &slug), thread) else {
            return false;
        };
        let status = Status::of(summary.state, self.running(thread));
        if !auto_archive::nothing_owed(&summary, status, true, 0)
            || !auto_archive::verified(&self.home, &slug, &summary)
        {
            return false;
        }
        let review = Changes::of(&self.home, &slug, &summary)
            .and_then(|changes| changes.review(&self.home, &self.decisions.load(thread)));
        match review {
            Ok(review) => auto_archive::waiting(&review) == 0,
            Err(error) => {
                log::info!("not archiving {thread}: {error:#}");
                false
            }
        }
    }

    /// Archives the thread when nothing is owed on it, and marks the change seen. cedia runs
    /// outside the lock.
    pub fn archive_if_done(shared: &Shared, cwd: &Path, thread: &str) {
        let cedia = {
            let daemon = lock(shared);
            if !daemon.nothing_owed(cwd, thread) {
                return;
            }
            // Its worktree goes some time after archive, and uncommitted work with it.
            let files = daemon.uncommitted(cwd, thread);
            if !files.is_empty() {
                log::info!("not archiving {thread}: {} uncommitted files", files.len());
                return;
            }
            daemon.cedia.clone()
        };
        match cedia.archive(cwd, thread, true) {
            Ok(()) => {
                log::info!("archived {thread}: nothing owed");
                lock(shared).mark_seen(cwd, thread);
            }
            Err(error) => log::warn!("archiving {thread}: {error:#}"),
        }
    }

    /// The folder the thread's latest session ran in (its worktree), else the project's.
    fn folder(&self, cwd: &Path, thread: &str) -> PathBuf {
        let slug = project_key(cwd);
        read_thread(&threads_dir(&self.home, &slug), thread)
            .and_then(|summary| Changes::of(&self.home, &slug, &summary))
            .map_or_else(|_| cwd.to_owned(), |changes| changes.work_tree)
    }

    /// The uncommitted files in the worktree the thread's latest session ran in; none when it
    /// ran in the project itself, or has no session yet.
    fn uncommitted(&self, cwd: &Path, thread: &str) -> Vec<String> {
        let slug = project_key(cwd);
        let work_tree = read_thread(&threads_dir(&self.home, &slug), thread)
            .and_then(|summary| Changes::of(&self.home, &slug, &summary));
        let Ok(changes) = work_tree else {
            return Vec::new();
        };
        crate::worktree::uncommitted(&changes.work_tree).unwrap_or_else(|error| {
            log::warn!("{thread}: {error:#}");
            Vec::new()
        })
    }

    /// Whether the thread needs the person now, as the list would say.
    fn needs_you(&self, cwd: &Path, thread: &str) -> bool {
        let slug = project_key(cwd);
        read_thread(&threads_dir(&self.home, &slug), thread).is_ok_and(|summary| {
            let status = Status::of(summary.state, self.running(thread));
            self.seen
                .needs_you(&slug, thread, &summary.updated_at, status)
        })
    }

    /// Marks the thread's latest change seen, and sends the list again when that changed it.
    fn mark_seen(&mut self, cwd: &Path, thread: &str) {
        let slug = project_key(cwd);
        if let Ok(summary) = read_thread(&threads_dir(&self.home, &slug), thread)
            && self.seen.mark(&slug, thread, &summary.updated_at)
        {
            self.refresh(&slug);
        }
    }

    fn open(&mut self, client: ClientId, cwd: &Path, thread: &str) {
        let slug = project_key(cwd);
        let summary = match read_thread(&threads_dir(&self.home, &slug), thread) {
            Ok(summary) => summary,
            // A thread this project has no record of says so (spec §8.3); other reads say why.
            Err(error) if !threads_dir(&self.home, &slug).join(thread).exists() => {
                log::warn!("client {client}: {error:#}");
                return self.thread_error(
                    client,
                    thread,
                    format!("no thread {thread} in this project"),
                );
            }
            Err(error) => return self.thread_error(client, thread, format!("{error:#}")),
        };
        if self.seen.mark(&slug, thread, &summary.updated_at) {
            self.refresh(&slug);
        }
        let run = self.by_thread.get(thread).and_then(|id| self.runs.get(id));
        let mut lines = Vec::new();
        for session in &summary.sessions {
            if run.is_some_and(|run| !run.before.contains(&session.session_id)) {
                continue;
            }
            let path = session_path(
                &self.home,
                &slug,
                &session.session_id,
                session.path.as_deref(),
            );
            match session_lines(&path) {
                Ok(more) => lines.extend(more),
                Err(error) => log::warn!("{error:#}"),
            }
        }
        if let Some(run) = run {
            lines.extend(run.lines.iter().cloned());
        }
        let mut fold = Transcript::default();
        for line in &lines {
            fold_line(&mut fold, thread, line);
        }
        let mut history = 0;
        for notice in blocks(thread, fold.take_changes()) {
            self.send(client, notice);
            history += 1;
        }
        // A window that acks this thread acks its history too.
        self.folds.insert(thread.to_owned(), fold);
        let status = Status::of(summary.state, self.running(thread));
        self.send(
            client,
            Notice::Caught {
                thread: thread.to_owned(),
            },
        );
        self.send(
            client,
            Notice::Status {
                thread: thread.to_owned(),
                status,
            },
        );
        let notes = self.notes.load(thread);
        if crate::notes::any(&notes) {
            self.send(
                client,
                Notice::Notes {
                    thread: thread.to_owned(),
                    notes,
                },
            );
        }
        if let Some(c) = self.clients.get_mut(&client) {
            c.open.insert(thread.to_owned());
            if let Some(flow) = c.flows.get_mut(thread) {
                flow.sent(history);
            }
        }
    }

    /// The client drew one of the thread's notices: what was held for it goes now, rebuilt
    /// from the fold, one notice for each view.
    fn ack(&mut self, client: ClientId, thread: &str) {
        let Some(held) = self
            .clients
            .get_mut(&client)
            .filter(|c| c.open.contains(thread))
            .map(|c| c.flows.entry(thread.to_owned()).or_default().ack())
        else {
            return;
        };
        let Some(fold) = self.folds.get(thread) else {
            return;
        };
        let notices: Vec<Notice> = held
            .into_iter()
            .filter_map(|(sub, held)| {
                let view = match &sub {
                    None => fold,
                    Some(sub) => fold.subthreads().get(sub)?,
                };
                Some(match held {
                    Held::Append { index, text } => Notice::Text {
                        thread: thread.to_owned(),
                        sub,
                        index,
                        append: text,
                    },
                    Held::From(from) => {
                        let from = from.min(view.blocks().len());
                        Notice::Blocks {
                            thread: thread.to_owned(),
                            sub,
                            from,
                            blocks: view.blocks()[from..].to_vec(),
                            context: view.context(),
                            run_cost: view.run_cost(),
                        }
                    }
                })
            })
            .collect();
        for notice in notices {
            self.send(client, notice);
        }
    }

    /// A thread's live notice to each client that has it open, through the credit of those
    /// that ack.
    fn tell_paced(&mut self, thread: &str, notice: &Notice) {
        let readers: Vec<ClientId> = self
            .clients
            .iter()
            .filter(|(_, client)| client.open.contains(thread))
            .map(|(id, _)| *id)
            .collect();
        for id in readers {
            let now = match self
                .clients
                .get_mut(&id)
                .and_then(|c| c.flows.get_mut(thread))
            {
                Some(flow) => flow.offer(notice.clone()),
                None => Some(notice.clone()),
            };
            if let Some(notice) = now {
                self.send(id, notice);
            }
        }
    }

    /// A new thread in a new worktree. Creating it runs git, so the daemon is not locked
    /// meanwhile.
    /// Starts each thread the project's coordinator opened (`open_thread`) and that waits
    /// `queued`, in a worktree of its own: `cedia -p <task> --thread <id>`. Only projects a
    /// window shows are looked at, and each thread once per daemon. It runs on the model of the
    /// thread that opened it, so the model picked in the project chat reaches the work.
    pub fn start_queued(shared: &Shared) {
        let queued: Vec<(PathBuf, PathBuf, String, String, String, Option<String>)> = {
            let mut daemon = lock(shared);
            if !daemon.version.as_ref().is_ok_and(|v| {
                v.capabilities
                    .contains(&cedian_protocol::Capability::OpenThread)
            }) {
                return;
            }
            let mut projects: Vec<(PathBuf, String)> = daemon
                .clients
                .values()
                .flat_map(|client| {
                    client
                        .watching
                        .iter()
                        .map(|(cwd, slug)| (cwd.clone(), slug.clone()))
                })
                .collect();
            projects.sort();
            projects.dedup_by(|a, b| a.1 == b.1);
            let mut found = Vec::new();
            for (cwd, slug) in projects {
                let threads = match list_threads(&threads_dir(&daemon.home, &slug)) {
                    Ok(threads) => threads,
                    Err(error) => {
                        log::warn!("{error:#}");
                        continue;
                    }
                };
                for thread in &threads {
                    if thread.state == ThreadState::Queued
                        && thread.by.is_some()
                        && !thread.archived
                        && !daemon.running(&thread.id)
                        && daemon.started.insert((slug.clone(), thread.id.clone()))
                    {
                        let model = opener_model(&threads, thread.by.as_deref());
                        // The worktree is named from the title the coordinator gave, which tells
                        // threads apart better than the task's opening words.
                        let name = if thread.title.trim().is_empty() {
                            &thread.task
                        } else {
                            &thread.title
                        };
                        // A thread opened in another root of the workspace gets its worktree
                        // there; the run's environment names the whole workspace either way.
                        let root = thread
                            .root
                            .as_deref()
                            .map(PathBuf::from)
                            .filter(|root| root.is_dir())
                            .unwrap_or_else(|| cwd.clone());
                        found.push((
                            cwd.clone(),
                            root,
                            thread.id.clone(),
                            thread.task.clone(),
                            name.clone(),
                            model,
                        ));
                    }
                }
            }
            found
        };
        for (cwd, root, thread, task, name, model) in queued {
            log::info!("starting queued {thread}");
            match crate::worktree::create(&root, &name) {
                Ok((dir, branch)) => {
                    log::info!("worktree {} on {branch}", dir.display());
                    Self::prompt(
                        shared,
                        None,
                        cwd,
                        dir,
                        &task,
                        Some(thread),
                        Flags {
                            model: model.as_deref(),
                            ..Flags::default()
                        },
                    );
                }
                Err(error) => log::warn!("starting {thread}: {error:#}"),
            }
        }
    }

    fn prompt_in_worktree(
        shared: &Shared,
        client: ClientId,
        asked_in: PathBuf,
        text: &str,
        with: Flags,
    ) {
        lock(shared).send(
            client,
            Notice::Preparing {
                cwd: asked_in.clone(),
                step: "creating a worktree".into(),
            },
        );
        match crate::worktree::create(&asked_in, text) {
            Ok((dir, branch)) => {
                log::info!("worktree {} on {branch}", dir.display());
                lock(shared).send(
                    client,
                    Notice::Preparing {
                        cwd: asked_in.clone(),
                        step: format!("starting on {branch}"),
                    },
                );
                Self::prompt(shared, Some(client), asked_in, dir, text, None, with);
            }
            Err(error) => lock(shared).error(client, format!("{error:#}")),
        }
    }

    /// One run. `asked_in` is the window's project directory, which notices name; the run
    /// itself goes in `cwd`, or in a resumed thread's own directory.
    fn prompt(
        shared: &Shared,
        client: Option<ClientId>,
        asked_in: PathBuf,
        cwd: PathBuf,
        text: &str,
        thread: Option<String>,
        with: Flags,
    ) {
        let mut daemon = lock(shared);
        // The window's project: a run in another root of a multi-repo workspace still files
        // its thread under the primary root (cedia's `CEDIA_ROOTS`).
        let slug = project_key(&asked_in);
        let (before, cwd) = match &thread {
            Some(thread) => match read_thread(&threads_dir(&daemon.home, &slug), thread) {
                Ok(summary) => {
                    let own = daemon.thread_cwd(&slug, &summary).unwrap_or(cwd);
                    let before = summary.sessions.into_iter().map(|s| s.session_id).collect();
                    (before, own)
                }
                Err(error) => return daemon.error_to(client, format!("{error:#}")),
            },
            None => (HashSet::new(), cwd),
        };
        let can = |capability| {
            daemon
                .version
                .as_ref()
                .is_ok_and(|v| v.capabilities.contains(&capability))
        };
        // The project's page, when the shared browser runs: a run never starts it.
        let page = can(cedian_protocol::Capability::Browser)
            .then(|| {
                daemon
                    .browser
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .running_page(&slug)
            })
            .flatten();
        let shows_images = can(cedian_protocol::Capability::Images);
        let with = Flags {
            ask: can(cedian_protocol::Capability::Ask),
            todo: can(cedian_protocol::Capability::Todo),
            browser: page.as_ref().map(|p| p.socket.as_str()),
            cache_ttl: with
                .cache_ttl
                .filter(|_| can(cedian_protocol::Capability::CacheTtl)),
            ..with
        };
        if !with.images.is_empty() && !shows_images {
            return daemon.error_to(client, "this cedia cannot show the model images".into());
        }
        let child = match daemon.cedia.prompt(&cwd, text, thread.as_deref(), with) {
            Ok(child) => child,
            Err(error) => return daemon.error_to(client, format!("{error:#}")),
        };
        let id = daemon.id();
        log::info!("run {id}: pid {} in {}", child.id(), cwd.display());
        daemon.runs.insert(
            id,
            Run {
                asked_in,
                cwd,
                slug,
                thread: None,
                pid: child.id(),
                alive: true,
                lines: Vec::new(),
                before,
                requester: client,
                stderr: Default::default(),
                followed: None,
            },
        );
        if let Some(thread) = thread {
            daemon.claim(id, thread);
        }
        daemon.keep_awake.set(true);
        drop(daemon);
        watch(shared.clone(), id, child);
    }

    /// Makes the run its thread's latest, dropping the thread's finished run before it.
    fn claim(&mut self, id: RunId, thread: String) {
        if let Some(old) = self.by_thread.insert(thread.clone(), id)
            && old != id
            && self.runs.get(&old).is_some_and(|run| !run.alive)
        {
            self.runs.remove(&old);
        }
        let Some(run) = self.runs.get_mut(&id) else {
            return;
        };
        run.thread = Some(thread.clone());
        let requester = run.requester;
        let cwd = run.asked_in.clone();
        let slug = run.slug.clone();
        self.save_ledger();
        if let Some(requester) = requester
            && let Some(client) = self.clients.get_mut(&requester)
            && client.open.insert(thread.clone())
        {
            self.send(
                requester,
                Notice::Started {
                    cwd,
                    thread: thread.clone(),
                },
            );
        }
        self.tell_readers(
            &thread,
            &Notice::Status {
                thread: thread.clone(),
                status: Status::Working,
            },
        );
        self.refresh(&slug);
    }

    /// cedia, and whether it offers `capability`.
    fn can(shared: &Shared, capability: cedian_protocol::Capability) -> (Cedia, bool) {
        let daemon = lock(shared);
        let can = daemon
            .version
            .as_ref()
            .is_ok_and(|v| v.capabilities.contains(&capability));
        (daemon.cedia.clone(), can)
    }

    /// The person's next message to the thread, written by the daemon (line comments, a fix):
    /// queued for its next turn when it runs, else its next run, under the permission its
    /// latest run had, so a thread that could edit still can.
    fn deliver(shared: &Shared, client: ClientId, cwd: PathBuf, thread: &str, text: &str) {
        let (running, permission) = {
            let daemon = lock(shared);
            let permission = read_thread(&threads_dir(&daemon.home, &project_key(&cwd)), thread)
                .ok()
                .and_then(|summary| {
                    summary
                        .runs
                        .iter()
                        .rev()
                        .find_map(|run| run.permission.clone())
                });
            (daemon.running(thread), permission)
        };
        if running {
            return Self::message(shared, client, &cwd, thread, text, &[]);
        }
        let with = Flags {
            permission: permission.as_deref(),
            cache_ttl: Some(PERSON_CACHE_TTL),
            ..Flags::default()
        };
        Self::prompt(
            shared,
            Some(client),
            cwd.clone(),
            cwd,
            text,
            Some(thread.to_owned()),
            with,
        );
    }

    fn message(
        shared: &Shared,
        client: ClientId,
        cwd: &Path,
        thread: &str,
        text: &str,
        images: &[PathBuf],
    ) {
        let cedia = lock(shared).cedia.clone();
        if let Err(error) = cedia.send(cwd, thread, text, images) {
            lock(shared).thread_error(client, thread, format!("{error:#}"));
        }
    }

    fn stop(&mut self, client: ClientId, thread: &str) {
        let Some(run) = self.by_thread.get(thread).and_then(|id| self.runs.get(id)) else {
            return self.thread_error(client, thread, format!("{thread} has no run"));
        };
        if !run.alive {
            return;
        }
        let Ok(pid) = libc::pid_t::try_from(run.pid) else {
            return;
        };
        // SAFETY: kill only sends a signal; the run is alive, so the pid is still its child.
        if unsafe { libc::kill(pid, libc::SIGTERM) } != 0 {
            let error = std::io::Error::last_os_error();
            self.thread_error(client, thread, format!("stopping {thread}: {error}"));
        }
    }

    pub fn on_line(&mut self, id: RunId, line: String) {
        let Some(run) = self.runs.get_mut(&id) else {
            return;
        };
        run.lines.push(line.clone());
        let thread = match &run.thread {
            Some(thread) => thread.clone(),
            None => match Line::parse(&line) {
                Ok(Line::Event(SessionEvent::Session {
                    thread: Some(thread),
                    ..
                })) => {
                    self.claim(id, thread.clone());
                    thread
                }
                Ok(_) => return,
                Err(error) => {
                    log::warn!("run {id}: {error}");
                    return;
                }
            },
        };
        let read = self.clients.values().any(|c| c.open.contains(&thread));
        if !read {
            self.folds.remove(&thread);
            return;
        }
        let fold = self.folds.entry(thread.clone()).or_default();
        fold_line(fold, &thread, &line);
        for notice in blocks(&thread, fold.take_changes()) {
            self.tell_paced(&thread, &notice);
        }
    }

    pub fn on_stderr(&mut self, id: RunId, line: String) {
        log::debug!("run {id}: {line}");
        if let Some(run) = self.runs.get_mut(&id) {
            run.push_stderr(line);
        }
    }

    /// Marks the run ended, and returns its project and thread to check for auto-archive.
    pub fn on_exit(&mut self, id: RunId, how: String) -> Option<(PathBuf, String)> {
        let run = self.runs.get_mut(&id)?;
        run.alive = false;
        log::info!("run {id}: {how}");
        self.save_ledger();
        let working = self.runs.values().any(|run| run.alive);
        self.keep_awake.set(working);
        let run = self.runs.get(&id)?;
        let (thread, slug, requester) = (run.thread.clone(), run.slug.clone(), run.requester);
        let asked_in = run.asked_in.clone();
        let stderr = run.stderr.iter().cloned().collect::<Vec<_>>().join("\n");
        match thread {
            Some(thread) => {
                let status = self.status(&slug, &thread);
                self.tell_readers(
                    &thread.clone(),
                    &Notice::Status {
                        thread: thread.clone(),
                        status,
                    },
                );
                self.refresh(&slug);
                Some((asked_in, thread))
            }
            None => {
                self.runs.remove(&id);
                if let Some(requester) = requester {
                    self.error(
                        requester,
                        format!("cedia {how} before it started a thread:\n{stderr}"),
                    );
                }
                None
            }
        }
    }
}

/// Applies one of cedia's lines to a thread's fold; a line that does not parse is logged and
/// skipped, as the window would have had to.
fn fold_line(fold: &mut Transcript, thread: &str, line: &str) {
    match Line::parse(line) {
        Ok(line) => fold.apply(&line),
        Err(error) => log::warn!("{thread}: {error}"),
    }
}

/// A fold's changes as the notices a window reads.
fn blocks(thread: &str, changes: Vec<Change>) -> impl Iterator<Item = Notice> + '_ {
    changes.into_iter().map(move |change| match change.append {
        Some(append) => Notice::Text {
            thread: thread.to_owned(),
            sub: change.sub,
            index: change.from,
            append,
        },
        None => Notice::Blocks {
            thread: thread.to_owned(),
            sub: change.sub,
            from: change.from,
            blocks: change.blocks,
            context: change.context,
            run_cost: change.run_cost,
        },
    })
}

/// Stops a cedia the daemon started for an ask that is no longer wanted.
fn stop_child(pid: u32) {
    if let Ok(pid) = libc::pid_t::try_from(pid) {
        // SAFETY: kill only sends a signal. The pid is a child of this daemon whose ask is still
        // open; only in the moment between its exit and its thread clearing the entry could the
        // pid be reused, and a SIGTERM is all that could stray.
        unsafe { libc::kill(pid, libc::SIGTERM) };
    }
}
