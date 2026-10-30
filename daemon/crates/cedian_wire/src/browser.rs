use serde::{Deserialize, Serialize};

/// A project's pages in the shared Chromium the daemon runs: the tabs the Browser block shows,
/// and the active one, which the project's runs get with cedia's `--browser`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct BrowserPage {
    /// The browser's DevTools endpoint, `http://127.0.0.1:<port>`.
    pub endpoint: String,
    /// The active tab's DevTools WebSocket, `ws://127.0.0.1:<port>/devtools/page/<id>`.
    pub socket: String,
    /// The project's tabs in the order they opened; the active one among them.
    #[serde(default)]
    pub tabs: Vec<BrowserTab>,
}

/// One tab of a project: a page target in the shared Chromium.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct BrowserTab {
    /// Chromium's target id.
    pub id: String,
    /// The tab's DevTools WebSocket.
    pub socket: String,
}

/// What the Browser block asks of a project's tabs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum BrowserTabAction {
    /// A new tab, active from then on, on `url` or a blank page.
    Open {
        #[serde(default)]
        url: Option<String>,
    },
    /// Makes the tab active: the one the block shows and the runs drive.
    Select { id: String },
    /// Closes the tab; the last one closed leaves a blank one in its place.
    Close { id: String },
}
