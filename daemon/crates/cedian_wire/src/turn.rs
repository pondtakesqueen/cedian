use serde::{Deserialize, Serialize};

/// One file the thread's latest turn changed, with its line counts (`cedia threads diff`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct TurnFile {
    pub path: String,
    pub added: u32,
    pub removed: u32,
}

/// The files a unified patch changes, in its order, with the lines each adds and removes.
pub fn turn_files(patch: &str) -> Vec<TurnFile> {
    let mut files: Vec<TurnFile> = Vec::new();
    let mut header = false;
    for line in patch.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            // `a/<path> b/<path>`: the b side names the file as the turn left it.
            let path = rest.rsplit_once(" b/").map_or(rest, |(_, b)| b).to_owned();
            files.push(TurnFile {
                path,
                added: 0,
                removed: 0,
            });
            header = true;
        } else if line.starts_with("@@") {
            header = false;
        } else if header {
            // `--- a/x` and `+++ b/x` belong to the file's header, not its lines.
            if let Some(path) = line.strip_prefix("+++ b/")
                && let Some(file) = files.last_mut()
            {
                path.clone_into(&mut file.path);
            }
        } else if let Some(file) = files.last_mut() {
            if line.starts_with('+') {
                file.added += 1;
            } else if line.starts_with('-') {
                file.removed += 1;
            }
        }
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_each_files_lines_and_skips_the_headers() {
        let patch = "diff --git a/src/a.ts b/src/a.ts\nindex 1..2 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n line\n-old\n+new\n+more\ndiff --git a/new.md b/new.md\nnew file mode 100644\n--- /dev/null\n+++ b/new.md\n@@ -0,0 +1 @@\n+# hi\n";
        assert_eq!(
            turn_files(patch),
            vec![
                TurnFile {
                    path: "src/a.ts".into(),
                    added: 2,
                    removed: 1
                },
                TurnFile {
                    path: "new.md".into(),
                    added: 1,
                    removed: 0
                },
            ]
        );
        assert!(turn_files("").is_empty());
    }
}
