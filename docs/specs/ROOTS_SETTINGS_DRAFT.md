# Draft: Roots section for the Settings window (unverified, needs Xcode build)

Follows `crates/cedian_window/src/settings_mcp.rs`. Add a new section "Roots" under
Settings > Environment (or its own section) in `settings_window.rs`/`settings_view.rs`.

## Data

```rust
#[derive(Default)]
pub struct RootsSection {
    /// Per-project slug -> roots (read from desktop.roots).
    pub slug: Option<String>,
    pub roots: Vec<String>,
    /// Validation result for the path in the add form.
    pub validating: bool,
    pub refused: Option<String>,
    /// Row asking before remove.
    pub removing: Option<String>,
    pub form_path: Option<Entity<Editor>>,
}
```

## Read on open

```rust
let desktop = crate::desktop_settings::read_desktop(&settings_path(home)).unwrap_or_default();
let roots = desktop.get("roots")
    .and_then(|v| v.get(&slug))
    .and_then(|v| v.as_array())
    .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect())
    .unwrap_or_default();
```

(Use `cedian_daemon::desktop_settings::read_roots(home, &slug)` if linked, else inline.)

## Validate a path (on "ตรวจ")

```rust
fn validate_root(path: &str) -> Result<(String, String), String> {
    // returns (branch, head) or error
    let out = std::process::Command::new("git")
        .args(["-C", path, "rev-parse", "--git-common-dir"])
        .output().map_err(|e| e.to_string())?;
    if !out.status.success() { return Err("ไม่ใช่ git repository".into()); }
    let common = String::from_utf8_lossy(&out.stdout).trim().to_string();
    // dedup by project_root (git common-dir)
    let branch = std::process::Command::new("git")
        .args(["-C", path, "branch", "--show-current"])
        .output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "detached".into());
    let head = std::process::Command::new("git")
        .args(["-C", path, "rev-parse", "--short", "HEAD"])
        .output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    Ok((branch, head))
}
```

Dedup: before add, compute `project_root(path)` for every existing root and the new one; refuse if a duplicate.

## Add

Write via daemon Request or directly? Settings window writes `desktop` key atomically via cedian's own file write (as settings_mcp does through the daemon? Check how settings_mcp persists — it sends Request::McpAdd to daemon). For roots, either:
- Add a `Request::RootsAdd { cwd, path }` / `Request::RootsRemove` to the wire protocol, handled by daemon (writes desktop.roots[slug]), or
- Write directly from the window via `cedian_daemon::desktop_settings::set_desktop_key` (if cedian_window can depend on cedian_daemon's desktop_settings module — currently it doesn't; desktop_settings is in cedian_daemon).

Recommendation: add wire requests `RootsAdd`/`RootsRemove`/`RootsList` handled by daemon, mirroring McpAdd/McpRemove/McpList. Keeps cedian_window free of file writes (consistent with "daemon owns state").

## Remove (9-A lock)

Before remove, check daemon's thread list for the slug: if any thread has `root == path` and status is Queued/Working, refuse with "มี thread ใช้ root นี้อยู่".

## Render

- List: each root row shows basename, branch, HEAD, and ลบ (asks in row first).
- Form: path input + ตรวจ button + เพิ่ม button.
- When roots empty, show hint "ยังไม่มี root — project ใช้ root เดิม (cwd)".

## Integration points to wire

1. `settings_view.rs`: register "Roots" section in the Environment group.
2. `settings_window.rs`: handle section events.
3. `cedian_wire/src/message.rs`: add `Request::RootsList/Add/Remove` and `Notice::Roots`.
4. `cedian_daemon/src/daemon.rs`: handle requests, read/write via desktop_settings.
5. `cedian_daemon/src/desktop_settings.rs`: add `set_roots(home, slug, roots)`.

## Not done here

- No code written in this draft; needs a Mac with Xcode to build/verify.
- Edge cases (symlink, spaces, order) deferred to grilling if needed.
EOF
echo done