//! Where a line comment's code is now (spec §3.8, Annotate AI Diff): a comment is anchored by its
//! line's text and the lines around it, its hunk context, so it follows the code when the agent's
//! edits move it, and says whether the agent touched that code.

use cedian_wire::LineComment;

/// Lines of context kept on each side of a commented line.
pub const CONTEXT: usize = 3;

/// The anchor of line `line` (from 1) of `lines`: its trimmed text, and up to [`CONTEXT`] lines
/// above (nearest last) and below (nearest first).
pub struct Anchor {
    pub quote: Option<String>,
    pub before: Vec<String>,
    pub after: Vec<String>,
}

pub fn anchor_at(lines: &[&str], line: u32) -> Anchor {
    let at = (line as usize).saturating_sub(1).min(lines.len());
    let quote = lines
        .get(at)
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(str::to_owned);
    let before = lines[at.saturating_sub(CONTEXT)..at]
        .iter()
        .map(|l| l.trim().to_owned())
        .collect();
    let after = lines
        .iter()
        .skip(at + 1)
        .take(CONTEXT)
        .map(|l| l.trim().to_owned())
        .collect();
    Anchor {
        quote,
        before,
        after,
    }
}

/// Where a comment's code is in a file's new text.
#[derive(Debug, PartialEq, Eq)]
pub struct Found {
    /// From 1.
    pub line: u32,
    /// The line or a line next to it is not what it was: the code under the comment changed.
    pub touched: bool,
}

/// Finds the comment's line in `lines`: the line that best matches its text and context, nearest
/// its old line on a tie. None when nothing matches enough to say it is the same code.
pub fn follow(comment: &LineComment, lines: &[&str]) -> Option<Found> {
    let quote = comment.quote.as_deref().map(str::trim).unwrap_or("");
    let old = (comment.line as usize).saturating_sub(1);
    let mut best: Option<(usize, usize, usize)> = None;
    for at in 0..lines.len() {
        let same = lines[at].trim() == quote;
        let context = run_above(&comment.before, lines, at) + run_below(&comment.after, lines, at);
        // A line of real text is worth more than its neighbours; a blank one is only a hint.
        let score = context
            + if same && !quote.is_empty() {
                4
            } else {
                usize::from(same)
            };
        let distance = at.abs_diff(old);
        let better = match best {
            None => true,
            Some((s, d, _)) => score > s || (score == s && distance < d),
        };
        if better {
            best = Some((score, distance, at));
        }
    }
    let (score, _, at) = best?;
    if score < 2 {
        return None;
    }
    let same = lines[at].trim() == quote;
    let above = match comment.before.last() {
        Some(line) => at > 0 && lines[at - 1].trim() == line,
        None => at == 0,
    };
    let below = match comment.after.first() {
        Some(line) => lines.get(at + 1).is_some_and(|l| l.trim() == line),
        None => at + 1 == lines.len(),
    };
    Some(Found {
        line: u32::try_from(at + 1).unwrap_or(u32::MAX),
        touched: !(same && above && below),
    })
}

/// How many lines of `before` (nearest last) match the lines just above `at`, counting outward
/// until one does not. Blank lines match without counting.
fn run_above(before: &[String], lines: &[&str], at: usize) -> usize {
    let mut count = 0;
    for (i, want) in before.iter().rev().enumerate() {
        let Some(line) = at.checked_sub(i + 1).map(|j| lines[j]) else {
            break;
        };
        if line.trim() != want {
            break;
        }
        count += usize::from(!want.is_empty());
    }
    count
}

fn run_below(after: &[String], lines: &[&str], at: usize) -> usize {
    let mut count = 0;
    for (i, want) in after.iter().enumerate() {
        let Some(line) = lines.get(at + 1 + i) else {
            break;
        };
        if line.trim() != want {
            break;
        }
        count += usize::from(!want.is_empty());
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str =
        "fn main() {\n    let x = 1;\n    let y = 2;\n    println!(\"{x}\");\n    done();\n}\n";

    fn comment_on(text: &str, line: u32) -> LineComment {
        let lines: Vec<&str> = text.lines().collect();
        let anchor = anchor_at(&lines, line);
        LineComment {
            id: "c1".into(),
            path: "main.rs".into(),
            line,
            quote: anchor.quote,
            before: anchor.before,
            after: anchor.after,
            state: Default::default(),
            text: "print y too".into(),
        }
    }

    fn found(comment: &LineComment, text: &str) -> Option<Found> {
        follow(comment, &text.lines().collect::<Vec<_>>())
    }

    #[test]
    fn the_anchor_is_the_line_and_its_neighbours() {
        let c = comment_on(FILE, 4);
        assert_eq!(c.quote.as_deref(), Some("println!(\"{x}\");"));
        assert_eq!(c.before, ["fn main() {", "let x = 1;", "let y = 2;"]);
        assert_eq!(c.after, ["done();", "}"]);
        assert_eq!(comment_on(FILE, 1).before, Vec::<String>::new());
    }

    #[test]
    fn a_comment_follows_its_line_when_lines_are_added_above() {
        let c = comment_on(FILE, 4);
        let moved = format!("use std::fmt;\n\n// one\n{FILE}");
        assert_eq!(
            found(&c, &moved),
            Some(Found {
                line: 7,
                touched: false
            })
        );
        assert_eq!(
            found(&c, FILE),
            Some(Found {
                line: 4,
                touched: false
            })
        );
    }

    #[test]
    fn an_edited_line_is_found_by_its_context_and_marked_touched() {
        let c = comment_on(FILE, 4);
        let edited = FILE.replace("println!(\"{x}\");", "println!(\"{x} {y}\");");
        assert_eq!(
            found(&c, &format!("// a\n{edited}")),
            Some(Found {
                line: 5,
                touched: true
            })
        );
    }

    #[test]
    fn a_line_added_next_to_it_counts_as_touching_it() {
        let c = comment_on(FILE, 4);
        let next = FILE.replace("    done();", "    println!(\"{y}\");\n    done();");
        assert_eq!(
            found(&c, &next),
            Some(Found {
                line: 4,
                touched: true
            })
        );
    }

    #[test]
    fn the_same_line_twice_goes_to_the_one_with_its_context() {
        let text = "a();\nreturn x;\n}\nb();\nreturn x;\n}\n";
        let c = comment_on(text, 5);
        let moved = format!("z();\n{text}");
        assert_eq!(
            found(&c, &moved),
            Some(Found {
                line: 6,
                touched: false
            })
        );
    }

    #[test]
    fn code_that_is_gone_is_not_found() {
        let c = comment_on(FILE, 4);
        assert_eq!(found(&c, "something else\nentirely\n"), None);
    }
}
