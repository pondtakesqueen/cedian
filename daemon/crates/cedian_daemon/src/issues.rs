//! The Issues block (spec §11 Phase D: review, merge and issues in Cedian): the repository's
//! issues through the person's own `gh`, read with `gh issue list` and one GraphQL query, and
//! each action as the `gh` command a person would type.

use std::path::Path;

use anyhow::Context as _;
use cedian_wire::{
    CloseReason, IssueAction, IssueFilter, IssueState, IssueSummary, IssueView, LinkedPr, NewIssue,
    PrComment,
};
use serde_json::Value;

use crate::pr_watch::{Author, Gh};

const QUERY: &str = r#"query($owner: String!, $repo: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    viewerPermission
    labels(first: 100) { nodes { name } }
    issue(number: $number) {
      number url title body state stateReason author { login }
      labels(first: 20) { nodes { name } }
      assignees(first: 20) { nodes { login } }
      milestone { title }
      comments(first: 100) { nodes { author { login } body createdAt } }
      closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { number title url headRefName } }
    }
  }
}"#;

/// `gh issue list --json` with the fields the list draws.
#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Listed {
    number: u64,
    url: String,
    title: String,
    author: Author,
    state: String,
    labels: Vec<Named>,
    comments: Vec<Value>,
    created_at: String,
}

#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct Named {
    name: String,
}

fn state(text: &str) -> IssueState {
    if text.eq_ignore_ascii_case("closed") {
        IssueState::Closed
    } else {
        IssueState::Open
    }
}

/// The `gh issue list` arguments for `filter`.
pub fn list_args(filter: &IssueFilter) -> Vec<String> {
    let state = match filter.state {
        IssueState::Open => "open",
        IssueState::Closed => "closed",
    };
    let mut out: Vec<String> = ["issue", "list", "--state", state, "--limit", "50", "--json"]
        .map(str::to_owned)
        .into();
    out.push("number,url,title,author,state,labels,comments,createdAt".into());
    if filter.assigned {
        out.extend(["--assignee".into(), "@me".into()]);
    }
    if !filter.search.trim().is_empty() {
        out.extend(["--search".into(), filter.search.trim().to_owned()]);
    }
    out
}

pub fn list(gh: &Gh, dir: &Path, filter: &IssueFilter) -> anyhow::Result<Vec<IssueSummary>> {
    let args = list_args(filter);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let text = gh.run(dir, &args)?;
    let me = gh.me(dir).unwrap_or_default();
    parse_list(&text, &me)
}

pub fn parse_list(text: &str, me: &str) -> anyhow::Result<Vec<IssueSummary>> {
    let listed: Vec<Listed> = serde_json::from_str(text).context("reading gh issue list")?;
    Ok(listed
        .into_iter()
        .map(|i| IssueSummary {
            number: i.number,
            url: i.url,
            title: i.title,
            mine: !me.is_empty() && i.author.login == me,
            author: i.author.login,
            state: state(&i.state),
            labels: i.labels.into_iter().map(|l| l.name).collect(),
            comments: i.comments.len() as u32,
            created: i.created_at,
        })
        .collect())
}

pub fn read(gh: &Gh, dir: &Path, number: u64) -> anyhow::Result<IssueView> {
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
            &format!("query={QUERY}"),
        ],
    )?;
    let value: Value = serde_json::from_str(&text).context("reading gh api graphql")?;
    parse(&value)
}

fn s(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn nodes<'a>(v: &'a Value, key: &str) -> impl Iterator<Item = &'a Value> {
    v.get(key)
        .and_then(|c| c.get("nodes"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

fn login(v: &Value) -> String {
    v.get("author").map(|a| s(a, "login")).unwrap_or_default()
}

pub fn parse(value: &Value) -> anyhow::Result<IssueView> {
    let data = value.get("data").context("gh api graphql gave no data")?;
    let repo = data.get("repository").context("no such repository")?;
    let i = repo
        .get("issue")
        .filter(|i| !i.is_null())
        .context("no such issue")?;
    Ok(IssueView {
        number: i.get("number").and_then(Value::as_u64).unwrap_or_default(),
        url: s(i, "url"),
        title: s(i, "title"),
        body: s(i, "body"),
        state: state(&s(i, "state")),
        state_reason: i
            .get("stateReason")
            .and_then(Value::as_str)
            .filter(|_| state(&s(i, "state")) == IssueState::Closed)
            .map(str::to_lowercase),
        author: login(i),
        labels: nodes(i, "labels").map(|l| s(l, "name")).collect(),
        assignees: nodes(i, "assignees").map(|a| s(a, "login")).collect(),
        milestone: i
            .get("milestone")
            .map(|m| s(m, "title"))
            .filter(|t| !t.is_empty()),
        me: data
            .get("viewer")
            .map(|v| s(v, "login"))
            .unwrap_or_default(),
        comments: nodes(i, "comments")
            .map(|c| PrComment {
                author: login(c),
                body: s(c, "body"),
                at: s(c, "createdAt"),
            })
            .collect(),
        linked: nodes(i, "closedByPullRequestsReferences")
            .map(|p| LinkedPr {
                number: p.get("number").and_then(Value::as_u64).unwrap_or_default(),
                title: s(p, "title"),
                url: s(p, "url"),
                head: s(p, "headRefName"),
            })
            .collect(),
        can_triage: matches!(
            s(repo, "viewerPermission").as_str(),
            "ADMIN" | "MAINTAIN" | "WRITE" | "TRIAGE"
        ),
        repo_labels: nodes(repo, "labels").map(|l| s(l, "name")).collect(),
    })
}

/// The `gh` arguments for `action` on issue `number`.
pub fn args(number: u64, action: &IssueAction) -> Vec<String> {
    let n = number.to_string();
    let owned = |items: &[&str]| items.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
    let edit = |add_flag: &str, add: &[String], remove_flag: &str, remove: &[String]| {
        let mut out = owned(&["issue", "edit", &n]);
        if !add.is_empty() {
            out.extend([add_flag.to_owned(), add.join(",")]);
        }
        if !remove.is_empty() {
            out.extend([remove_flag.to_owned(), remove.join(",")]);
        }
        out
    };
    match action {
        IssueAction::Comment { body } => owned(&["issue", "comment", &n, "--body", body]),
        IssueAction::Close { reason, body } => {
            let reason = match reason {
                CloseReason::Completed => "completed",
                CloseReason::NotPlanned => "not planned",
            };
            let mut out = owned(&["issue", "close", &n, "--reason", reason]);
            if !body.trim().is_empty() {
                out.extend(owned(&["--comment", body]));
            }
            out
        }
        IssueAction::Reopen => owned(&["issue", "reopen", &n]),
        IssueAction::Labels { add, remove } => edit("--add-label", add, "--remove-label", remove),
        IssueAction::Assignees { add, remove } => {
            edit("--add-assignee", add, "--remove-assignee", remove)
        }
    }
}

/// The issue as read shows what `action` did.
pub fn reflects(view: &IssueView, action: &IssueAction) -> bool {
    let has = |list: &[String], item: &String| list.iter().any(|x| x.eq_ignore_ascii_case(item));
    match action {
        IssueAction::Comment { .. } => true,
        IssueAction::Close { .. } => view.state == IssueState::Closed,
        IssueAction::Reopen => view.state == IssueState::Open,
        IssueAction::Labels { add, remove } => {
            add.iter().all(|l| has(&view.labels, l)) && !remove.iter().any(|l| has(&view.labels, l))
        }
        IssueAction::Assignees { add, remove } => {
            add.iter().all(|a| has(&view.assignees, a))
                && !remove.iter().any(|a| has(&view.assignees, a))
        }
    }
}

pub fn act(gh: &Gh, dir: &Path, number: u64, action: &IssueAction) -> anyhow::Result<()> {
    let args = args(number, action);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    gh.run(dir, &args).map(drop)
}

/// The `gh issue create` arguments for `issue`.
pub fn create_args(issue: &NewIssue) -> Vec<String> {
    let mut out: Vec<String> = [
        "issue",
        "create",
        "--title",
        &issue.title,
        "--body",
        &issue.body,
    ]
    .map(str::to_owned)
    .into();
    if !issue.labels.is_empty() {
        out.extend(["--label".into(), issue.labels.join(",")]);
    }
    out
}

/// Opens `issue` and gives its number, from the URL `gh issue create` prints.
pub fn create(gh: &Gh, dir: &Path, issue: &NewIssue) -> anyhow::Result<u64> {
    anyhow::ensure!(!issue.title.trim().is_empty(), "an issue needs a title");
    let args = create_args(issue);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let printed = gh.run(dir, &args)?;
    number_of(&printed).with_context(|| format!("gh issue create printed {printed:?}"))
}

fn number_of(printed: &str) -> Option<u64> {
    printed
        .lines()
        .rev()
        .find_map(|l| l.trim().rsplit_once("/issues/"))
        .and_then(|(_, n)| n.parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_list_and_the_graphql_answer_become_the_block() {
        let listed = r#"[{"number":14,"url":"u14","title":"Median is wrong","author":{"login":"mai-k"},"state":"OPEN","labels":[{"name":"bug"}],"comments":[{},{},{}],"createdAt":"2026-10-29T08:00:00Z"},
            {"number":12,"url":"u12","title":"Add mode()","author":{"login":"pond"},"state":"OPEN","labels":[],"comments":[],"createdAt":"2026-10-28T08:00:00Z"}]"#;
        let list = parse_list(listed, "pond").expect("list");
        assert_eq!(
            (list[0].number, list[0].comments, list[0].mine),
            (14, 3, false)
        );
        assert_eq!(list[0].labels, ["bug"]);
        assert!(list[1].mine);

        let value: Value =
            serde_json::from_str(include_str!("../tests/fixtures/issue-graphql.json"))
                .expect("fixture");
        let view = parse(&value).expect("view");
        assert_eq!(
            (view.number, view.state, view.state_reason.clone()),
            (14, IssueState::Open, None)
        );
        assert_eq!(view.me, "pond");
        assert_eq!(view.labels, ["bug"]);
        assert_eq!(view.milestone.as_deref(), Some("v1.2"));
        assert_eq!(view.comments[0].author, "ton-s");
        assert_eq!(
            view.linked,
            [LinkedPr {
                number: 7,
                title: "Fix median for even counts".into(),
                url: "u7".into(),
                head: "fix-median".into()
            }]
        );
        assert_eq!(view.repo_labels, ["bug", "enhancement"]);
        assert!(view.can_triage);
        let assign = |add: &str| IssueAction::Assignees {
            add: vec![add.into()],
            remove: vec![],
        };
        assert!(!reflects(&view, &assign("pond")));
        assert!(reflects(
            &IssueView {
                assignees: vec!["Pond".into()],
                ..view.clone()
            },
            &assign("pond")
        ));
    }

    #[test]
    fn each_action_is_the_gh_command_a_person_would_type() {
        let filter = IssueFilter {
            state: IssueState::Open,
            assigned: true,
            search: " median ".into(),
        };
        assert_eq!(
            list_args(&filter)[..4],
            ["issue", "list", "--state", "open"]
        );
        assert!(list_args(&filter).ends_with(&[
            "--assignee".into(),
            "@me".into(),
            "--search".into(),
            "median".into()
        ]));
        let close = IssueAction::Close {
            reason: CloseReason::NotPlanned,
            body: String::new(),
        };
        assert_eq!(
            args(14, &close),
            ["issue", "close", "14", "--reason", "not planned"]
        );
        let labels = IssueAction::Labels {
            add: vec!["bug".into()],
            remove: vec![],
        };
        assert_eq!(
            args(14, &labels),
            ["issue", "edit", "14", "--add-label", "bug"]
        );
        let assign = IssueAction::Assignees {
            add: vec!["pond".into()],
            remove: vec!["ton-s".into()],
        };
        assert_eq!(
            args(14, &assign),
            [
                "issue",
                "edit",
                "14",
                "--add-assignee",
                "pond",
                "--remove-assignee",
                "ton-s"
            ]
        );
        let new = NewIssue {
            title: "T".into(),
            body: "B".into(),
            labels: vec!["bug".into(), "ui".into()],
        };
        assert_eq!(
            create_args(&new),
            [
                "issue", "create", "--title", "T", "--body", "B", "--label", "bug,ui"
            ]
        );
        assert_eq!(
            number_of("Creating issue\nhttps://github.com/o/r/issues/15\n"),
            Some(15)
        );
    }
}
