//! What the person leaves on a thread's diff (spec §3.7, diff comments + review card): line
//! comments waiting to be sent, and the latest `/code-review` with the findings they dismissed.
//! Kept per thread under the daemon's state directory, so a window that opens the thread later,
//! or after a restart, sees the same notes.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use anyhow::Context as _;
use cedian_protocol::{CodeFinding, CodeReview};
use cedian_wire::{CommentState, LineComment, Notes};

use crate::anchor::{anchor_at, follow};

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

/// Moves each line comment to where its code is now in the working tree `root`, and takes its
/// anchor again from there. When `ended`, a run that was sent the comments has ended: each sent
/// one becomes resolved when the run changed its code (or took it away), else open. Returns
/// whether any comment changed.
pub fn follow_comments(comments: &mut [LineComment], root: &Path, ended: bool) -> bool {
    let mut files: HashMap<String, Option<String>> = HashMap::new();
    let mut changed = false;
    for comment in comments.iter_mut() {
        let text = files
            .entry(comment.path.clone())
            .or_insert_with(|| std::fs::read_to_string(root.join(&comment.path)).ok());
        let lines: Vec<&str> = text
            .as_deref()
            .map(|t| t.lines().collect())
            .unwrap_or_default();
        let found = follow(comment, &lines);
        let was = comment.clone();
        if let Some(found) = &found {
            let anchor = anchor_at(&lines, found.line);
            comment.line = found.line;
            comment.quote = anchor.quote;
            comment.before = anchor.before;
            comment.after = anchor.after;
        }
        if ended && comment.state == CommentState::Sent {
            let touched = found.as_ref().is_none_or(|f| f.touched);
            comment.state = if touched {
                CommentState::Resolved
            } else {
                CommentState::Open
            };
        }
        changed |= *comment != was;
    }
    changed
}

/// The message the thread gets for the person's line comments that go next: drafts, and ones a
/// run left open, which say so.
pub fn comments_message(comments: &[&LineComment]) -> String {
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
        if comment.state == CommentState::Open {
            text.push_str(" (still open: your last run left this code as it was)");
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
                quote: Some("  return `x`;".into()),
                ..comment("c1", "src/a.ts", 12, "return y here ")
            },
            LineComment {
                state: CommentState::Open,
                ..comment("c2", "b.rs", 1, "why?")
            },
        ];
        assert_eq!(
            comments_message(&comments.iter().collect::<Vec<_>>()),
            "I left comments on lines of your diff. Address each one, then say what you changed for each.\n\n- `src/a.ts:12` (`return 'x';`): return y here\n- `b.rs:1` (still open: your last run left this code as it was): why?"
        );
    }

    fn comment(id: &str, path: &str, line: u32, text: &str) -> LineComment {
        LineComment {
            id: id.into(),
            path: path.into(),
            line,
            quote: None,
            before: Vec::new(),
            after: Vec::new(),
            state: CommentState::Draft,
            text: text.into(),
        }
    }

    /// A comment on `line` of `text`, anchored as the window anchors it.
    fn anchored(id: &str, text: &str, line: u32, state: CommentState) -> LineComment {
        let lines: Vec<&str> = text.lines().collect();
        let anchor = anchor_at(&lines, line);
        LineComment {
            quote: anchor.quote,
            before: anchor.before,
            after: anchor.after,
            state,
            ..comment(id, "a.ts", line, "fix")
        }
    }

    #[test]
    fn after_a_run_comments_follow_their_code_and_say_if_it_was_changed() {
        let dir = tempfile::tempdir().unwrap();
        let before = "one();\ntwo();\nthree();\nfour();\nfive();\nsix();\n";
        let mut comments = vec![
            anchored("kept", before, 2, CommentState::Sent),
            anchored("edited", before, 5, CommentState::Sent),
            anchored("draft", before, 4, CommentState::Draft),
        ];
        std::fs::write(
            dir.path().join("a.ts"),
            "zero();\none();\ntwo();\nthree();\nfour();\nfive(1);\nsix();\n",
        )
        .unwrap();
        assert!(follow_comments(&mut comments, dir.path(), true));
        let at: Vec<_> = comments
            .iter()
            .map(|c| (c.id.as_str(), c.line, c.state))
            .collect();
        assert_eq!(
            at,
            [
                ("kept", 3, CommentState::Open),
                ("edited", 6, CommentState::Resolved),
                ("draft", 5, CommentState::Draft),
            ]
        );
        assert_eq!(comments[1].quote.as_deref(), Some("five(1);"));
        assert!(!follow_comments(&mut comments, dir.path(), true));
        std::fs::remove_file(dir.path().join("a.ts")).unwrap();
        comments[0].state = CommentState::Sent;
        follow_comments(&mut comments, dir.path(), true);
        assert_eq!(comments[0].state, CommentState::Resolved);
        assert_eq!(comments[0].line, 3);
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
