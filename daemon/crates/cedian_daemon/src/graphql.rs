//! One GraphQL read through the person's own `gh` (`gh api graphql`), for the PR block and the
//! Issues block, and the few ways their parsers read GitHub's JSON.

use std::path::Path;

use anyhow::Context as _;
use serde_json::Value;

use crate::pr_watch::Gh;

/// `query` for item `number` of the repository checked out in `dir`; gh fills in its owner
/// and name.
pub fn read(gh: &Gh, dir: &Path, number: u64, query: &str) -> anyhow::Result<Value> {
    let text = gh.run(
        dir,
        &[
            "api",
            "graphql",
            "-F",
            "owner={owner}",
            "-F",
            "repo={repo}",
            "-F",
            &format!("number={number}"),
            "-f",
            &format!("query={query}"),
        ],
    )?;
    serde_json::from_str(&text).context("reading gh api graphql")
}

/// The string at `key`, or empty.
pub fn s(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

/// The login of the item's author, or empty.
pub fn login(v: &Value) -> String {
    v.get("author").map(|a| s(a, "login")).unwrap_or_default()
}

/// The `nodes` of the connection at `key`, none when it is missing.
pub fn nodes<'a>(v: &'a Value, key: &str) -> impl Iterator<Item = &'a Value> {
    v.get(key)
        .and_then(|c| c.get("nodes"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}
