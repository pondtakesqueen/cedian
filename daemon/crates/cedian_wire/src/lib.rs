//! What the window and the daemon say to each other over the daemon's Unix socket: one JSON
//! object per line, requests one way and notices the other.

mod browser;
mod build;
mod git;
mod issue;
mod launch_agent;
mod mcp;
mod message;
mod notes;
mod pr;
mod pr_view;
mod schema;
mod socket;
mod status;

pub use browser::BrowserPage;
pub use build::Build;
pub use cedian_review::{FileReview, Hunk, HunkState, Review};
pub use git::{GitAction, GitState};
pub use issue::{
    CloseReason, IssueAction, IssueFilter, IssueState, IssueSummary, IssueView, LinkedPr, NewIssue,
};
pub use launch_agent::{LAUNCH_AGENT_LABEL, launch_agent_plist};
pub use mcp::{McpAdd, McpServer, McpTarget, McpTransport};
pub use message::{
    Decision, Helpers, Notice, Position, Request, Selection, read_message, write_message,
};
pub use notes::{LineComment, Notes};
pub use pr::{CiState, PrChip, PrState};
pub use pr_view::{
    CheckState, MergeMethod, PrAction, PrCheck, PrComment, PrList, PrReviewer, PrSummary, PrThread,
    PrView, PrViewState, ReviewEvent,
};
pub use schema::wire_schema;
pub use socket::{socket_path, state_dir};
pub use status::{Status, ThreadInfo};
