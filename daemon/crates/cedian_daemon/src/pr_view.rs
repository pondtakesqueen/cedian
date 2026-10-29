//! The PR block's pull request (spec §11 Phase D: review, merge and issues in Cedian): one
//! GraphQL read through the person's own `gh` for everything the block draws, and each of its
//! actions as the `gh` command a person would type. Cedian holds no GitHub token; `gh` is the
//! login, as for the PR watch.

use std::path::Path;

use anyhow::Context as _;
use cedian_wire::{
    CheckState, MergeMethod, PrAction, PrCheck, PrComment, PrCommit, PrList, PrReviewer, PrSummary,
    PrThread, PrView, PrViewState, ReviewEvent,
};
use serde_json::Value;

use crate::pr_watch::{Check, Gh, Pr};

const QUERY: &str = r#"query($owner: String!, $repo: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number url title body state isDraft author { login } headRefName baseRefName
      additions deletions changedFiles
      commits(last: 50) { totalCount nodes { commit { abbreviatedOid messageHeadline author { name user { login } } } } }
      mergeable mergeStateStatus reviewDecision autoMergeRequest { mergeMethod }
      labels(first: 20) { nodes { name } }
      closingIssuesReferences(first: 10) { nodes { number } }
      reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }
      latestReviews(first: 20) { nodes { author { login } state } }
      comments(first: 100) { nodes { author { login } body createdAt } }
      reviewThreads(first: 100) { nodes { id isResolved path line
        comments(first: 50) { nodes { author { login } body createdAt diffHunk } } } }
      statusCheckRollup: commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
        __typename
        ... on CheckRun { name status conclusion detailsUrl }
        ... on StatusContext { context state targetUrl }
      } } } } } }
    }
  }
}"#;

/// The PR of the branch checked out in `dir`, or none when it has none.
pub fn read(gh: &Gh, dir: &Path) -> anyhow::Result<Option<PrView>> {
    let Some(branch) = crate::pr_watch::branch(dir) else {
        return Ok(None);
    };
    let Some(pr) = gh.view(dir, &branch)? else {
        return Ok(None);
    };
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
            &format!("number={}", pr.number),
            "-f",
            &format!("query={QUERY}"),
        ],
    )?;
    let value: Value = serde_json::from_str(&text).context("reading gh api graphql")?;
    parse(&value).map(Some)
}

fn s(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn n(v: &Value, key: &str) -> u32 {
    v.get(key).and_then(Value::as_u64).unwrap_or_default() as u32
}

fn login(v: &Value) -> String {
    v.get("author").map(|a| s(a, "login")).unwrap_or_default()
}

fn nodes<'a>(v: &'a Value, key: &str) -> impl Iterator<Item = &'a Value> {
    v.get(key)
        .and_then(|c| c.get("nodes"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

fn comment(v: &Value) -> PrComment {
    PrComment {
        author: login(v),
        body: s(v, "body"),
        at: s(v, "createdAt"),
    }
}

fn method(text: &str) -> Option<MergeMethod> {
    match text {
        "SQUASH" => Some(MergeMethod::Squash),
        "MERGE" => Some(MergeMethod::Merge),
        "REBASE" => Some(MergeMethod::Rebase),
        _ => None,
    }
}

/// A check run's or commit status's state, as the block shows it.
fn check(v: &Value) -> PrCheck {
    let run = |url: &str| {
        url.split("/actions/runs/")
            .nth(1)
            .and_then(|rest| rest.split('/').next())
            .map(str::to_owned)
    };
    if v.get("__typename").and_then(Value::as_str) == Some("StatusContext") {
        let state = match s(v, "state").as_str() {
            "SUCCESS" => CheckState::Passed,
            "PENDING" | "EXPECTED" => CheckState::Pending,
            _ => CheckState::Failed,
        };
        return PrCheck {
            name: s(v, "context"),
            state,
            url: s(v, "targetUrl"),
            run: None,
        };
    }
    let state = if s(v, "status") != "COMPLETED" {
        CheckState::Pending
    } else {
        match s(v, "conclusion").as_str() {
            "SUCCESS" => CheckState::Passed,
            "SKIPPED" | "NEUTRAL" => CheckState::Skipped,
            _ => CheckState::Failed,
        }
    };
    let url = s(v, "detailsUrl");
    PrCheck {
        name: s(v, "name"),
        state,
        run: run(&url),
        url,
    }
}

/// The block's PR from the GraphQL answer.
pub fn parse(value: &Value) -> anyhow::Result<PrView> {
    if let Some(errors) = value.get("errors") {
        anyhow::bail!("gh api graphql: {errors}");
    }
    let data = value.get("data").context("gh api graphql: no data")?;
    let me = data
        .get("viewer")
        .map(|v| s(v, "login"))
        .unwrap_or_default();
    let pr = data
        .pointer("/repository/pullRequest")
        .filter(|v| !v.is_null())
        .context("gh api graphql: no such pull request")?;
    let author = login(pr);
    let mut reviewers: Vec<PrReviewer> = nodes(pr, "latestReviews")
        .map(|r| PrReviewer {
            login: login(r),
            state: Some(s(r, "state").to_lowercase()),
        })
        .collect();
    for asked in nodes(pr, "reviewRequests") {
        let who = asked.get("requestedReviewer");
        let name = who
            .map(|w| {
                let user = s(w, "login");
                if user.is_empty() { s(w, "slug") } else { user }
            })
            .unwrap_or_default();
        if !name.is_empty() && !reviewers.iter().any(|r| r.login == name) {
            reviewers.push(PrReviewer {
                login: name,
                state: None,
            });
        }
    }
    let checks = pr
        .pointer("/statusCheckRollup/nodes/0/commit/statusCheckRollup/contexts/nodes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(check)
        .collect();
    let threads = nodes(pr, "reviewThreads")
        .map(|t| {
            let comments: Vec<&Value> = nodes(t, "comments").collect();
            PrThread {
                id: s(t, "id"),
                path: s(t, "path"),
                line: t.get("line").and_then(Value::as_u64).map(|l| l as u32),
                resolved: t
                    .get("isResolved")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                hunk: comments
                    .first()
                    .map(|c| s(c, "diffHunk"))
                    .unwrap_or_default(),
                comments: comments.into_iter().map(comment).collect(),
            }
        })
        .collect();
    Ok(PrView {
        number: pr.get("number").and_then(Value::as_u64).unwrap_or_default(),
        url: s(pr, "url"),
        title: s(pr, "title"),
        body: s(pr, "body"),
        state: match s(pr, "state").as_str() {
            "MERGED" => PrViewState::Merged,
            "CLOSED" => PrViewState::Closed,
            _ => PrViewState::Open,
        },
        draft: pr.get("isDraft").and_then(Value::as_bool).unwrap_or(false),
        mine: !me.is_empty() && me == author,
        author,
        head: s(pr, "headRefName"),
        base: s(pr, "baseRefName"),
        additions: n(pr, "additions"),
        deletions: n(pr, "deletions"),
        commits: pr
            .pointer("/commits/totalCount")
            .and_then(Value::as_u64)
            .unwrap_or_default() as u32,
        changed_files: n(pr, "changedFiles"),
        conflict: s(pr, "mergeable") == "CONFLICTING",
        behind: s(pr, "mergeStateStatus") == "BEHIND",
        review_decision: Some(s(pr, "reviewDecision").to_lowercase()).filter(|d| !d.is_empty()),
        reviewers,
        labels: nodes(pr, "labels").map(|l| s(l, "name")).collect(),
        closes: nodes(pr, "closingIssuesReferences")
            .filter_map(|i| i.get("number").and_then(Value::as_u64))
            .collect(),
        checks,
        comments: nodes(pr, "comments").map(comment).collect(),
        threads,
        history: nodes(pr, "commits")
            .filter_map(|c| c.get("commit"))
            .map(|c| {
                let author = c.get("author");
                let user = author
                    .and_then(|a| a.get("user"))
                    .map(|u| s(u, "login"))
                    .unwrap_or_default();
                PrCommit {
                    oid: s(c, "abbreviatedOid"),
                    headline: s(c, "messageHeadline"),
                    author: if user.is_empty() {
                        author.map(|a| s(a, "name")).unwrap_or_default()
                    } else {
                        user
                    },
                }
            })
            .collect(),
        auto_merge: pr
            .pointer("/autoMergeRequest/mergeMethod")
            .and_then(Value::as_str)
            .and_then(method),
    })
}

fn flag(method: MergeMethod) -> &'static str {
    match method {
        MergeMethod::Squash => "--squash",
        MergeMethod::Merge => "--merge",
        MergeMethod::Rebase => "--rebase",
    }
}

/// The `gh` arguments for `action` on PR `number`.
pub fn args(number: u64, action: &PrAction) -> Vec<String> {
    let n = number.to_string();
    let graphql = |mutation: &str, vars: &[(&str, &str)]| {
        let mut out = vec!["api".to_owned(), "graphql".to_owned()];
        for (key, value) in vars {
            out.extend(["-f".to_owned(), format!("{key}={value}")]);
        }
        out.extend(["-f".to_owned(), format!("query={mutation}")]);
        out
    };
    let owned = |items: &[&str]| items.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
    match action {
        PrAction::Comment { body } => owned(&["pr", "comment", &n, "--body", body]),
        PrAction::Reply { thread, body } => graphql(
            "mutation($thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $thread, body: $body}) { comment { id } } }",
            &[("thread", thread), ("body", body)],
        ),
        PrAction::Resolve { thread } => graphql(
            "mutation($thread: ID!) { resolveReviewThread(input: {threadId: $thread}) { thread { id } } }",
            &[("thread", thread)],
        ),
        PrAction::Unresolve { thread } => graphql(
            "mutation($thread: ID!) { unresolveReviewThread(input: {threadId: $thread}) { thread { id } } }",
            &[("thread", thread)],
        ),
        PrAction::Review { event, body } => {
            let verdict = match event {
                ReviewEvent::Comment => "--comment",
                ReviewEvent::Approve => "--approve",
                ReviewEvent::RequestChanges => "--request-changes",
            };
            let mut out = owned(&["pr", "review", &n, verdict]);
            if !body.is_empty() || *event != ReviewEvent::Approve {
                out.extend(owned(&["--body", body]));
            }
            out
        }
        PrAction::Merge {
            method,
            delete_branch,
        } => {
            let mut out = owned(&["pr", "merge", &n, flag(*method)]);
            if *delete_branch {
                out.push("--delete-branch".to_owned());
            }
            out
        }
        PrAction::AutoMerge { method: Some(m) } => owned(&["pr", "merge", &n, "--auto", flag(*m)]),
        PrAction::AutoMerge { method: None } => owned(&["pr", "merge", &n, "--disable-auto"]),
        PrAction::UpdateBranch => owned(&["pr", "update-branch", &n]),
        PrAction::Ready => owned(&["pr", "ready", &n]),
        PrAction::RequestReviewers { logins } => {
            owned(&["pr", "edit", &n, "--add-reviewer", &logins.join(",")])
        }
    }
}

/// Does `action` on the PR of the branch checked out in `dir`.
pub fn act(gh: &Gh, dir: &Path, action: &PrAction) -> anyhow::Result<()> {
    let branch = crate::pr_watch::branch(dir).context("no branch checked out")?;
    let pr = gh
        .view(dir, &branch)?
        .context("this branch has no pull request")?;
    let args = args(pr.number, action);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    gh.run(dir, &args).map(drop)
}

/// `gh pr list --json` with the fields the list draws.
#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Listed {
    number: u64,
    url: String,
    title: String,
    author: crate::pr_watch::Author,
    head_ref_name: String,
    base_ref_name: String,
    is_draft: bool,
    additions: u32,
    deletions: u32,
    status_check_rollup: Vec<Check>,
    review_requests: Vec<Value>,
}

/// The repository's open pull requests, split as the list's tabs show them.
pub fn list(gh: &Gh, dir: &Path) -> anyhow::Result<PrList> {
    let fields = "number,url,title,author,headRefName,baseRefName,isDraft,additions,deletions,statusCheckRollup,reviewRequests";
    let text = gh.run(
        dir,
        &[
            "pr", "list", "--state", "open", "--limit", "100", "--json", fields,
        ],
    )?;
    let me = gh.me(dir).unwrap_or_default();
    parse_list(&text, &me)
}

pub fn parse_list(text: &str, me: &str) -> anyhow::Result<PrList> {
    let listed: Vec<Listed> = serde_json::from_str(text).context("reading gh pr list")?;
    let mut out = PrList::default();
    for pr in listed {
        let asked = pr
            .review_requests
            .iter()
            .any(|r| r.get("login").and_then(Value::as_str) == Some(me));
        let ci = Pr {
            status_check_rollup: pr.status_check_rollup,
            ..Pr::default()
        }
        .ci();
        let summary = PrSummary {
            number: pr.number,
            url: pr.url,
            title: pr.title,
            author: pr.author.login,
            head: pr.head_ref_name,
            base: pr.base_ref_name,
            draft: pr.is_draft,
            additions: pr.additions,
            deletions: pr.deletions,
            ci,
            review_requested: asked && !me.is_empty(),
        };
        if summary.review_requested {
            out.to_review.push(summary.clone());
        }
        if !me.is_empty() && summary.author == me {
            out.mine.push(summary.clone());
        }
        out.open.push(summary);
    }
    Ok(out)
}

/// Checks PR `number` out in `dir` (a new worktree of its own), on the PR's own branch.
pub fn checkout(gh: &Gh, dir: &Path, number: u64) -> anyhow::Result<()> {
    gh.run(dir, &["pr", "checkout", &number.to_string()])
        .map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_graphql_answer_becomes_the_block() {
        let value: Value = serde_json::from_str(include_str!("../tests/fixtures/pr-graphql.json"))
            .expect("fixture");
        let view = parse(&value).expect("view");
        assert_eq!(
            (view.number, view.title.as_str()),
            (7, "Reset submitting after a failed login")
        );
        assert!(view.mine && !view.draft && view.behind && !view.conflict);
        assert_eq!(
            view.history
                .iter()
                .map(|c| (c.oid.as_str(), c.author.as_str()))
                .collect::<Vec<_>>(),
            [("a1b2c3d", "cedian-owner"), ("e4f5a6b", "Bot")]
        );
        assert_eq!(view.review_decision.as_deref(), Some("changes_requested"));
        assert_eq!(
            view.reviewers,
            [
                PrReviewer {
                    login: "mai-k".into(),
                    state: Some("changes_requested".into())
                },
                PrReviewer {
                    login: "ton-s".into(),
                    state: None
                },
            ]
        );
        assert_eq!(view.closes, [14]);
        assert_eq!(
            view.checks
                .iter()
                .map(|c| (c.name.as_str(), c.state, c.run.as_deref()))
                .collect::<Vec<_>>(),
            [
                ("lint", CheckState::Passed, Some("78")),
                ("e2e (macos)", CheckState::Failed, Some("79")),
                ("deploy/preview", CheckState::Pending, None),
            ]
        );
        assert_eq!(view.threads.len(), 1);
        let thread = &view.threads[0];
        assert_eq!(
            (thread.path.as_str(), thread.line, thread.resolved),
            ("src/login/form.ts", Some(42), false)
        );
        assert!(thread.hunk.ends_with("+    submitting = false;"));
        assert_eq!(view.auto_merge, Some(MergeMethod::Squash));
    }

    #[test]
    fn the_list_splits_what_to_review_and_what_is_mine() {
        let text = r#"[
          {"number":11,"title":"Cache the CSV","author":{"login":"ton-s"},"headRefName":"csv","baseRefName":"main","isDraft":false,"additions":84,"deletions":12,
           "statusCheckRollup":[{"__typename":"CheckRun","name":"ci","status":"COMPLETED","conclusion":"SUCCESS"}],"reviewRequests":[{"login":"me"}]},
          {"number":7,"title":"Fix login","author":{"login":"me"},"headRefName":"fix","baseRefName":"main","isDraft":true,"statusCheckRollup":[],"reviewRequests":[]}
        ]"#;
        let list = parse_list(text, "me").expect("list");
        assert_eq!(
            list.to_review.iter().map(|p| p.number).collect::<Vec<_>>(),
            [11]
        );
        assert_eq!(list.mine.iter().map(|p| p.number).collect::<Vec<_>>(), [7]);
        assert_eq!(list.open.len(), 2);
        assert_eq!(list.to_review[0].ci, cedian_wire::CiState::Passing);
        assert!(list.mine[0].draft);
    }

    #[test]
    fn each_action_is_the_gh_command_a_person_would_type() {
        let a = |action: PrAction| args(7, &action).join(" ");
        assert_eq!(
            a(PrAction::Comment { body: "ok".into() }),
            "pr comment 7 --body ok"
        );
        assert_eq!(
            a(PrAction::Review {
                event: ReviewEvent::Approve,
                body: String::new()
            }),
            "pr review 7 --approve"
        );
        assert_eq!(
            a(PrAction::Review {
                event: ReviewEvent::RequestChanges,
                body: "no".into()
            }),
            "pr review 7 --request-changes --body no"
        );
        assert_eq!(
            a(PrAction::Merge {
                method: MergeMethod::Squash,
                delete_branch: true
            }),
            "pr merge 7 --squash --delete-branch"
        );
        assert_eq!(
            a(PrAction::AutoMerge {
                method: Some(MergeMethod::Rebase)
            }),
            "pr merge 7 --auto --rebase"
        );
        assert_eq!(
            a(PrAction::AutoMerge { method: None }),
            "pr merge 7 --disable-auto"
        );
        assert_eq!(a(PrAction::UpdateBranch), "pr update-branch 7");
        assert_eq!(
            a(PrAction::RequestReviewers {
                logins: vec!["a".into(), "b".into()]
            }),
            "pr edit 7 --add-reviewer a,b"
        );
        let resolve = args(
            7,
            &PrAction::Resolve {
                thread: "PRRT_1".into(),
            },
        );
        assert_eq!(&resolve[..4], ["api", "graphql", "-f", "thread=PRRT_1"]);
        assert!(resolve[5].contains("resolveReviewThread"));
    }
}
