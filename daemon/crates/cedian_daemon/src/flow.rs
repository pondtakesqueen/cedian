//! Credit flow control for a thread's blocks (spec §3.9): a window that acks has at most
//! [`WINDOW`] blocks or text notices of a thread it has not drawn yet. Changes past that are held
//! and merged, and the next ack sends them as one notice for each view, so a slow or busy window
//! gets fewer, larger notices instead of a backlog.

use std::collections::BTreeMap;

use cedian_wire::Notice;

/// Notices of one thread a window may have undrawn.
pub const WINDOW: u32 = 2;

/// What is held for one view (the thread's own, or a sub-thread's) while the window is behind.
#[derive(Clone, Debug, PartialEq)]
pub enum Held {
    /// Only text added to block `index`, in order.
    Append { index: usize, text: String },
    /// The view's blocks from here on, as the fold has them when the hold ends.
    From(usize),
}

/// One window's credit for one thread.
#[derive(Debug, Default)]
pub struct Flow {
    outstanding: u32,
    /// By sub-thread; `None` for the thread's own view.
    held: BTreeMap<Option<String>, Held>,
}

impl Flow {
    /// Notices sent outside [`Flow::offer`] (a thread's history on open) that the window acks.
    pub fn sent(&mut self, count: u32) {
        self.outstanding += count;
    }

    /// The notice to send now, or `None` when it is held for the next ack. Notices other than
    /// blocks and text always go.
    pub fn offer(&mut self, notice: Notice) -> Option<Notice> {
        let (sub, held) = match &notice {
            Notice::Blocks { sub, from, .. } => (sub.clone(), Held::From(*from)),
            Notice::Text {
                sub, index, append, ..
            } => (
                sub.clone(),
                Held::Append {
                    index: *index,
                    text: append.clone(),
                },
            ),
            _ => return Some(notice),
        };
        if self.outstanding < WINDOW && self.held.is_empty() {
            self.outstanding += 1;
            return Some(notice);
        }
        let merged = match self.held.remove(&sub) {
            None => held,
            Some(before) => merge(before, held),
        };
        self.held.insert(sub, merged);
        None
    }

    /// The window drew one notice. Returns what was held, by view, for the caller to send now
    /// (each counts against the window again).
    pub fn ack(&mut self) -> Vec<(Option<String>, Held)> {
        self.outstanding = self.outstanding.saturating_sub(1);
        if self.held.is_empty() || self.outstanding >= WINDOW {
            return Vec::new();
        }
        let held: Vec<_> = std::mem::take(&mut self.held).into_iter().collect();
        self.outstanding += held.len() as u32;
        held
    }
}

/// A later change on top of an earlier one held for the same view: appends to one block join,
/// and anything else resends the view from the first block either one touched.
fn merge(before: Held, after: Held) -> Held {
    match (before, after) {
        (
            Held::Append { index, mut text },
            Held::Append {
                index: at,
                text: more,
            },
        ) if at == index => {
            text.push_str(&more);
            Held::Append { index, text }
        }
        (
            Held::Append { index: a, .. } | Held::From(a),
            Held::Append { index: b, .. } | Held::From(b),
        ) => Held::From(a.min(b)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(sub: Option<&str>, index: usize, append: &str) -> Notice {
        Notice::Text {
            thread: "t-1".into(),
            sub: sub.map(str::to_owned),
            index,
            append: append.into(),
        }
    }

    fn blocks(from: usize) -> Notice {
        Notice::Blocks {
            thread: "t-1".into(),
            sub: None,
            from,
            blocks: Vec::new(),
            context: None,
            run_cost: 0.,
        }
    }

    #[test]
    fn two_go_then_changes_wait_and_merge_until_an_ack() {
        let mut flow = Flow::default();
        assert!(flow.offer(text(None, 3, "a")).is_some());
        assert!(flow.offer(text(None, 3, "b")).is_some());
        assert!(flow.offer(text(None, 3, "c")).is_none());
        assert!(flow.offer(text(None, 3, "d")).is_none());
        assert!(flow.offer(text(Some("t-2"), 0, "x")).is_none());
        // Other notices are not paced.
        assert!(
            flow.offer(Notice::Caught {
                thread: "t-1".into()
            })
            .is_some()
        );
        assert_eq!(
            flow.ack(),
            vec![
                (
                    None,
                    Held::Append {
                        index: 3,
                        text: "cd".into()
                    }
                ),
                (
                    Some("t-2".into()),
                    Held::Append {
                        index: 0,
                        text: "x".into()
                    }
                ),
            ]
        );
        // Those two count: the window is full again.
        assert!(flow.offer(text(None, 3, "e")).is_none());
        assert_eq!(flow.ack(), Vec::new());
        assert_eq!(
            flow.ack(),
            vec![(
                None,
                Held::Append {
                    index: 3,
                    text: "e".into()
                }
            )]
        );
    }

    #[test]
    fn a_new_block_while_held_resends_from_the_first_block_touched() {
        let mut flow = Flow::default();
        flow.sent(2);
        assert!(flow.offer(text(None, 3, "a")).is_none());
        assert!(flow.offer(blocks(4)).is_none());
        assert!(flow.offer(text(None, 4, "b")).is_none());
        assert_eq!(flow.ack(), vec![(None, Held::From(3))]);
        let mut flow = Flow::default();
        flow.sent(2);
        assert!(flow.offer(blocks(5)).is_none());
        assert!(flow.offer(text(None, 2, "x")).is_none());
        assert_eq!(flow.ack(), vec![(None, Held::From(2))]);
    }

    #[test]
    fn an_ack_that_leaves_the_window_full_holds_on() {
        let mut flow = Flow::default();
        flow.sent(3);
        assert!(flow.offer(text(None, 0, "a")).is_none());
        assert_eq!(flow.ack(), Vec::new());
        assert_eq!(flow.ack().len(), 1);
        // An ack with nothing held, or more acks than notices, sends nothing.
        assert_eq!(flow.ack(), Vec::new());
        assert_eq!(flow.ack(), Vec::new());
        assert_eq!(flow.ack(), Vec::new());
        assert!(flow.offer(text(None, 0, "b")).is_some());
    }
}
