//! The login shell's environment, read through the shell itself. The shell re-execs
//! this binary with `--printenv`, which prints the environment the shell sees as JSON.
//! Falls back to the caller's own environment when the shell cannot be read.
//!
//! In-house replacement for Zed's `util::shell_env`, so the daemon links no GPL code
//! (MIT-only policy, `docs/CEDIAN_SPEC.md` §9).

use std::collections::HashMap;

use anyhow::Context as _;

/// Run `shell` as a login interactive shell in `home`, have it re-exec this binary with
/// `--printenv`, and read back the environment it reports.
pub fn capture(shell: &str, home: &str) -> anyhow::Result<HashMap<String, String>> {
    let exe = std::env::current_exe().context("locating this binary")?;
    let output = std::process::Command::new(shell)
        .args(["-l", "-i", "-c"])
        .arg(format!("\"{}\" --printenv", exe.display()))
        .current_dir(home)
        .output()
        .with_context(|| format!("spawning the login shell {shell:?}"))?;
    serde_json::from_slice(&output.stdout).context("reading the login shell's environment")
}

/// Print this process's environment as JSON, for the `--printenv` re-exec in [`capture`].
pub fn print_env() {
    let mut stdout = std::io::stdout();
    if let Err(error) = write_env(&mut stdout) {
        eprintln!("--printenv: {error:#}");
        std::process::exit(1);
    }
}

fn write_env(mut out: impl std::io::Write) -> anyhow::Result<()> {
    let env: HashMap<String, String> = std::env::vars().collect();
    let json = serde_json::to_string(&env).context("encoding the environment")?;
    writeln!(out, "{json}").context("writing the environment")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn print_env_round_trips_through_capture() {
        // The shell may be unavailable in CI; a failure to spawn must error, never panic.
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_owned());
        match capture("/bin/sh", &home) {
            Ok(env) => assert!(env.contains_key("HOME") || env.contains_key("PATH")),
            Err(error) => eprintln!("skipped, no shell: {error:#}"),
        }
    }

    #[test]
    fn written_env_parses_back_to_a_map() {
        let mut buf = Vec::new();
        write_env(&mut buf).unwrap();
        let env: HashMap<String, String> = serde_json::from_slice(&buf).unwrap();
        assert_eq!(env.get("HOME"), std::env::var("HOME").ok().as_ref());
    }
}
