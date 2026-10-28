//! The wire's JSON Schema, from the Rust types themselves, so the window's TypeScript types
//! (`src/protocol/wire.ts`, `script/protocol-types.mjs`) follow them. Checked in as
//! `wire.schema.json`; a test fails when it is stale.

use crate::{Notice, Request};

/// `{roots: {Request, Notice}, definitions}`, the shape cedia's protocol schema has.
pub fn wire_schema() -> serde_json::Value {
    let mut generator = schemars::r#gen::SchemaSettings::draft07().into_generator();
    let request = generator.subschema_for::<Request>();
    let notice = generator.subschema_for::<Notice>();
    let definitions: std::collections::BTreeMap<_, _> =
        generator.take_definitions().into_iter().collect();
    sorted(serde_json::json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "roots": { "Request": request, "Notice": notice },
        "definitions": definitions,
    }))
}

/// Every object's keys in order, whether or not a crate in the build turned on serde_json's
/// `preserve_order` (the daemon does), so the file is the same from any build.
fn sorted(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut entries: Vec<_> = map.into_iter().collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            serde_json::Value::Object(entries.into_iter().map(|(k, v)| (k, sorted(v))).collect())
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.into_iter().map(sorted).collect())
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    /// `CEDIAN_UPDATE_SCHEMA=1 cargo test -p cedian_wire` rewrites it.
    #[test]
    fn the_checked_in_schema_is_current() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("wire.schema.json");
        let mut text = serde_json::to_string_pretty(&super::wire_schema()).expect("schema");
        text.push('\n');
        if std::env::var_os("CEDIAN_UPDATE_SCHEMA").is_some() {
            std::fs::write(&path, &text).expect("write");
        }
        let on_disk = std::fs::read_to_string(&path).unwrap_or_default();
        assert!(
            on_disk == text,
            "wire.schema.json is stale: CEDIAN_UPDATE_SCHEMA=1 cargo test -p cedian_wire"
        );
    }
}
