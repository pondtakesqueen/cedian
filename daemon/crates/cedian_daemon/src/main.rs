//! `cedian-daemon`: serves windows on the socket in cedian's state directory until it is
//! killed. `install` and `uninstall` register it as a LaunchAgent, or remove it. `--printenv`
//! prints this process's environment as JSON, for reading the login shell's environment.
//! `remote-url` prints the link that opens remote control in a browser (remote.rs).

use std::path::PathBuf;

use cedian_daemon::{Cedia, Config, launch_agent, login_environment, serve};

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("--printenv") => return cedian_daemon::print_env(),
        Some(command @ ("install" | "uninstall")) => return agent(command),
        Some("remote-url") => return remote_url(),
        Some(other) => {
            eprintln!(
                "usage: cedian-daemon [install | uninstall | remote-url]; unknown argument {other:?}"
            );
            std::process::exit(2);
        }
        None => {}
    }
    // A parent that ignored SIGTERM passes that on through exec; launchd, logout and Stop
    // (which cedia inherits from here) all rely on the default.
    // SAFETY: setting signal dispositions and this thread's mask before any thread starts.
    unsafe {
        libc::signal(libc::SIGTERM, libc::SIG_DFL);
        libc::signal(libc::SIGINT, libc::SIG_DFL);
        // A blocked signal is inherited through exec too: a parent's threads may block
        // these, so a daemon the window started would never see SIGTERM. cedia's runs
        // inherit the mask from here.
        let mut set: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&mut set);
        for signal in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
            libc::sigaddset(&mut set, signal);
        }
        libc::pthread_sigmask(libc::SIG_UNBLOCK, &set, std::ptr::null_mut());
    }
    log::set_logger(&LOGGER).ok();
    log::set_max_level(log::LevelFilter::Info);
    log_signals("at start");
    let env = login_environment();
    log_signals("after reading the login environment");
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_secs(3));
        log_signals("while serving");
    });
    let home = env
        .get("CEDIA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(cedian_index::cedia_home);
    let config = Config {
        socket: cedian_wire::socket_path(),
        cedia: Cedia::find(env),
        home,
        record: std::env::var_os("CEDIAN_WIRE_RECORD").map(PathBuf::from),
    };
    if let Err(error) = serve(config) {
        log::error!("{error:#}");
        std::process::exit(1);
    }
}

/// How SIGTERM, SIGINT and SIGHUP are handled and whether this thread blocks them, so a
/// daemon that does not stop on SIGTERM says why in its log.
fn log_signals(when: &str) {
    let mut words = Vec::new();
    for (name, signal) in [
        ("TERM", libc::SIGTERM),
        ("INT", libc::SIGINT),
        ("HUP", libc::SIGHUP),
    ] {
        // SAFETY: sigaction with a null new action only reads the current one.
        let handler = unsafe {
            let mut old: libc::sigaction = std::mem::zeroed();
            libc::sigaction(signal, std::ptr::null(), &mut old);
            old.sa_sigaction
        };
        let how = match handler {
            libc::SIG_DFL => "default",
            libc::SIG_IGN => "ignored",
            _ => "caught",
        };
        // SAFETY: a null new set only reads this thread's mask.
        let blocked = unsafe {
            let mut mask: libc::sigset_t = std::mem::zeroed();
            libc::pthread_sigmask(libc::SIG_BLOCK, std::ptr::null(), &mut mask);
            libc::sigismember(&mask, signal) == 1
        };
        words.push(format!(
            "{name} {how}{}",
            if blocked { " blocked" } else { "" }
        ));
    }
    log::info!("signals {when}: {}", words.join(", "));
}

/// The login link for remote control: the local address with the token, and how to reach it
/// from a phone.
fn remote_url() {
    let home = std::env::var_os("CEDIA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(cedian_index::cedia_home);
    let port = std::fs::read_to_string(home.join("settings.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|settings| {
            settings
                .pointer("/desktop/remote/port")
                .and_then(serde_json::Value::as_u64)
        });
    let Some(port) = port else {
        eprintln!(
            "cedian-daemon remote-url: remote control is off; set desktop.remote.port in {}",
            home.join("settings.json").display()
        );
        std::process::exit(1);
    };
    match cedian_daemon::remote_token(&cedian_wire::state_dir()) {
        Ok(token) => {
            println!("http://127.0.0.1:{port}/?token={token}");
            eprintln!(
                "From a phone on your tailnet: run `tailscale serve --bg {port}` once, then open https://<this machine>.<tailnet>.ts.net/?token=<the same token>"
            );
        }
        Err(error) => {
            eprintln!("cedian-daemon remote-url: {error:#}");
            std::process::exit(1);
        }
    }
}

fn agent(command: &str) {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    let log = cedian_wire::state_dir().join("daemon.log");
    let done = match command {
        "install" => {
            launch_agent::install(&home, &log).map(|path| format!("installed {}", path.display()))
        }
        _ => launch_agent::uninstall(&home).map(|path| format!("removed {}", path.display())),
    };
    match done {
        Ok(message) => println!("{message}"),
        Err(error) => {
            eprintln!("cedian-daemon {command}: {error:#}");
            std::process::exit(1);
        }
    }
}

struct Logger;

static LOGGER: Logger = Logger;

impl log::Log for Logger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::max_level()
    }

    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            eprintln!("{} {}: {}", record.level(), record.target(), record.args());
        }
    }

    fn flush(&self) {}
}
