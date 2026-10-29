//! What the person leaves on a thread's diff (spec §3.7, diff comments + review card): line
//! comments waiting to be sent, and the latest `/code-review` with the findings they dismissed.
//! Kept per thread under the daemon's state directory, so a window that opens the thread later,
//! or after a restart, sees the same notes.

use std::path::{Path, PathBuf};

use anyhow::Context as _;
use cedian_protocol::{CodeFinding, CodeReview};
use cedian_wire::{LineComment, Notes};

pub struct NoteStore {
    dir: PathBuf,
}

impl NoteStore {
    pub fn new(state_dir: &Path) -> Self {
        Self {
            dir: state_dir.join("notes"),
        }
    }

    pub fn load(&self, thread: &str) -> Notes {
        let path = self.path(thread);
        match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                log::warn!("{}: {error}", path.display());
                Notes::default()
            }),
            Err(_) => Notes::default(),
        }
    }

    pub fn save(&self, thread: &str, notes: &Notes) -> anyhow::Result<()> {
        std::fs::create_dir_all(&self.dir)
            .with_context(|| format!("creating {}", self.dir.display()))?;
        let path = self.path(thread);
        let temp = path.with_extension("json.tmp");
        std::fs::write(&temp, serde_json::to_vec_pretty(notes)?)
            .with_context(|| format!("writing {}", temp.display()))?;
        std::fs::rename(&temp, &path).with_context(|| format!("replacing {}", path.display()))
    }

    fn path(&self, thread: &str) -> PathBuf {
        let name: String = thread
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        self.dir.join(format!("{name}.json"))
    }
}

/// Whether there is anything to show: a window opening the thread is sent notes only then.
pub fn any(notes: &Notes) -> bool {
    !notes.comments.is_empty() || notes.review.is_some() || notes.reviewing
}

/// The message the thread gets for the person's line comments.
pub fn comments_message(comments: &[LineComment]) -> String {
    let mut text = String::from(
        "I left comments on lines of your diff. Address each one, then say what you changed for each.\n",
    );
    for comment in comments {
        text.push_str(&format!("\n- `{}:{}`", comment.path, comment.line));
        if let Some(quote) = comment
            .quote
            .as_deref()
            .map(str::trim)
            .filter(|q| !q.is_empty())
        {
            text.push_str(&format!(" (`{}`)", quote.replace('`', "'")));
        }
        text.push_str(&format!(": {}", comment.text.trim()));
    }
    text
}

/// The findings of `review` still open: not dismissed, and among `ids` when any are named.
pub fn open_findings<'a>(
    review: &'a CodeReview,
    dismissed: &[String],
    ids: &[String],
) -> Vec<&'a CodeFinding> {
    let CodeReview::Variant0 { findings, .. } = review else {
        return Vec::new();
    };
    findings
        .iter()
        .filter(|f| !dismissed.contains(&f.id) && (ids.is_empty() || ids.contains(&f.id)))
        .collect()
}

/// The message the thread gets to fix findings of its review.
pub fn fix_message(review: &CodeReview, findings: &[&CodeFinding]) -> String {
    let model = match review {
        CodeReview::Variant0 { model, .. } => model.as_str(),
        CodeReview::Variant1 { .. } => "a reviewer",
    };
    let mut text = format!(
        "A code review ({model}) of your change found the following. They are claims to check, not orders: fix what is right, say why for anything you leave, then run the checks again.\n"
    );
    for finding in findings {
        text.push_str(&format!("\n- {}", finding.text.trim()));
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn finding(id: &str, text: &str) -> CodeFinding {
        CodeFinding {
            id: id.into(),
            line: None,
            path: None,
            text: text.into(),
        }
    }

    fn review() -> CodeReview {
        CodeReview::Variant0 {
            cost_usd: 0.,
            dropped: Vec::new(),
            files: vec!["a.ts".into()],
            findings: vec![
                finding("f1", "a.ts:3 drops the last item"),
                finding("f2", "a.ts:9 never closes"),
            ],
            model: "anthropic/claude-sonnet-5-5".into(),
            summary: String::new(),
            verdict: cedian_protocol::Verdict::Changes,
        }
    }

    #[test]
    fn comments_go_as_one_message_with_their_lines() {
        let comments = vec![
            LineComment {
                id: "c1".into(),
                path: "src/a.ts".into(),
                line: 12,
                quote: Some("  return `x`;".into()),
                text: "return y here ".into(),
            },
            LineComment {
                id: "c2".into(),
                path: "b.rs".into(),
                line: 1,
                quote: None,
                text: "why?".into(),
            },
        ];
        assert_eq!(
            comments_message(&comments),
            "I left comments on lines of your diff. Address each one, then say what you changed for each.\n\n- `src/a.ts:12` (`return 'x';`): return y here\n- `b.rs:1`: why?"
        );
    }

    #[test]
    fn a_fix_names_the_open_findings_only() {
        let review = review();
        let dismissed = vec!["f2".to_owned()];
        let open = open_findings(&review, &dismissed, &[]);
        assert_eq!(
            open.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
            ["f1"]
        );
        assert_eq!(open_findings(&review, &[], &["f2".to_owned()]).len(), 1);
        assert!(open_findings(&review, &dismissed, &["f2".to_owned()]).is_empty());
        assert!(fix_message(&review, &open).ends_with("\n\n- a.ts:3 drops the last item"));
        assert!(
            fix_message(&review, &open).starts_with("A code review (anthropic/claude-sonnet-5-5)")
        );
    }

    #[test]
    fn notes_last_across_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let store = NoteStore::new(dir.path());
        assert!(!any(&store.load("t-1")));
        let notes = Notes {
            dismissed: vec!["f1".into()],
            review: Some(review()),
            ..Notes::default()
        };
        store.save("t-1", &notes).unwrap();
        let back = NoteStore::new(dir.path()).load("t-1");
        assert_eq!(back.dismissed, ["f1"]);
        assert!(any(&back));
    }
}
