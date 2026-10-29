//! The daemon: owns every thread's runs and answers windows over a Unix socket. It runs one
//! cedia per prompt, streams the run's lines to the windows that have the thread open, and
//! rebuilds a thread's history from cedia's own files.

mod auto_archive;
mod browser;
mod cedia;
mod clone_ignored;
mod daemon;
mod desktop_lock;
mod desktop_settings;
mod environment;
mod flow;
mod follow;
mod keep_awake;
pub mod launch_agent;
mod ledger;
mod notes;
mod pr_watch;
mod record;
mod review;
mod run;
mod seen;
mod server;
mod shell_env;
mod thread_watch;
mod worktree;

pub use cedia::Cedia;
pub use environment::login_environment;
pub use server::{Config, serve};
pub use shell_env::print_env;
