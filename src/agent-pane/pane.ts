// The live agent pane (spec §11 Phase B "One live thread"): the project's threads, the open
// thread drawn from the daemon's notices, its cards (question, todo, review, commit and PR), and
// the composer with its chips. A viewer: every change is a request to the daemon, and what shows
// is only what the daemon sent back, so a reconnect or a restarted daemon redraws it whole.
import { complete, accept, tokenAt, type Completion, type Token } from "../composer/complete.js";
import { dropQueued, editQueued, isEmpty, sendNow, submit, type Draft, type RunChoices } from "../composer/composer.js";
import { button, el, select, type Wire } from "../dom/el.js";
import type { Capability, CommandEntry, GitAction, GitState, ModelList, Notice, PermissionList, PrList, PrView, Request, Review, ThreadInfo } from "../protocol/wire.js";
import { summarize } from "../review/original.js";
import { byFile, commentCount, findingCount, goesNext, openFindings, resolveComment, reviewed, sendComments, setComments, stateLabel, stateOf, walkSteps } from "../review/notes.js";
import { answer, askCard, todoCard } from "./cards.js";
import { contextMeter, meterLabel, ringDash } from "./context-meter.js";
import { ACTION_BUSY, ACTION_LABEL, branchLine, gitActions, pendingLine } from "./git.js";
import { newPrUi, prBlock, type PrUi } from "./pr-block.js";
import { firstTab, prListCard, type PrListTab } from "./pr-list.js";
import { filterOf, issuesCard, issueTask, newIssuesUi, type IssuesUi } from "./issues.js";
import { items } from "./items.js";
import { ItemsView, setChildren } from "./render.js";
import { cancel, confirmCommit, confirmPr, editDraft, idleShip, shipNotice, startCommit, startPr, type Ship } from "./ship.js";
import { prLabel, prText } from "./pr-chip.js";
import { addressed, chatCards, COORDINATOR, coordinatorThread, threadCompletions, type ChatCard } from "./project-chat.js";
import { currentModel, isRunning, openState, queued, reduce, threadPermission, type ThreadState } from "./thread-state.js";
import { nextViewMode, VIEW_MODES, viewModeOf, visibleBlocks, withoutTriage, type ViewMode } from "./view-modes.js";
import type { Block } from "./block.js";

/** What the pane needs from the workbench around it. */
export interface PaneHost {
  /** The window's project folder. */
  cwd: string;
  /** Project files whose path matches, for `@`. */
  files(query: string): Promise<string[]>;
  /** Image files the person picks, and videos too when `video` (cedia takes them). */
  pickImages(video?: boolean): Promise<string[]>;
  /**
   * Writes a pasted image that has no file of its own and returns the file's path. It needs to last
   * only until the run starts: cedia keeps its own copy by hash.
   */
  saveImage?(bytes: Uint8Array, mime: string): Promise<string>;
  /** The diff editor for the thread's review, at one file when named, at one of its lines when given. */
  openReview(thread: string, cwd: string, review: Review, file?: string, line?: number): void;
  /** The thread's review in a window of its own (pop-out); without it the card offers none. */
  openReviewWindow?(thread: string, cwd: string, review: Review): void;
  /**
   * An agent pane in a window of its own on this thread, or on a new one (pop-out). Without it,
   * as in a pane already popped out, the header offers none.
   */
  popOut?(thread: string | undefined): void;
  openUrl(url: string): void;
  /**
   * Whether to archive a thread whose worktree has uncommitted changes in `files`, which go when
   * the worktree is removed after archive. Without it the pane says so inline and archives nothing.
   */
  confirmArchive?(files: string[]): Promise<boolean>;
  /** Source Control (the git pane) on this folder: the open thread's worktree, else the project. */
  showRepository?(path: string): void;
  /** Opens the Source Control view on this folder, for what the Git card does not do. */
  openSourceControl?(path: string): void;
}

/** What cedia shows a model (`ImageMime`). */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
/** Videos cedia shows a model as frames, once it says `video`. */
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-msvideo"];

/** Threads newest first; archived ones and side chats stay out of the list. */
export function threadList(threads: ThreadInfo[]): ThreadInfo[] {
  return threads.filter((t) => !t.archived).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** What the composer takes as the review card's command. */
const CODE_REVIEW = "/code-review";
const CODE_REVIEW_ENTRY: CommandEntry = { name: "code-review", description: "Review what this thread changed, finding by file", kind: "command", source: "user" };
/** What the composer takes as archiving the open thread. */
const ARCHIVE = "/archive";
const ARCHIVE_ENTRY: CommandEntry = { name: "archive", description: "Archive this thread: it leaves the list", kind: "command", source: "user" };
/** What the composer takes as opening the Pull requests card. */
const PRS = "/prs";
const PRS_ENTRY: CommandEntry = { name: "prs", description: "The repository's pull requests: review one in a thread", kind: "command", source: "user" };
const ISSUES = "/issues";
const ISSUES_ENTRY: CommandEntry = { name: "issues", description: "The repository's issues: read, comment, close, or start a thread on one", kind: "command", source: "user" };

/** The thread picker's value for the project chat. */
export const CHAT = "@chat";

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  working: "Working",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
  interrupted: "Interrupted",
  asking: "Waiting for you",
};

export interface ThreadSearchItem {
  /** A thread's id, or `CHAT` for the project chat. */
  id: string;
  label: string;
  description: string;
  detail?: string;
}

/**
 * What the thread search lists (ARCHITECTURE "Search moves to the top of the thread list"): the
 * project chat first, then the threads newest first, the archived ones last so a finished
 * thread is still found. The coordinator's own thread is the project chat.
 */
export function threadSearch(threads: ThreadInfo[]): ThreadSearchItem[] {
  const coordinator = coordinatorThread(threads);
  const item = (t: ThreadInfo): ThreadSearchItem => {
    const title = t.title || t.task;
    const progress = todoCard(t)?.progress;
    const state = t.archived ? "Archived" : t.needs_you ? `${STATUS_LABEL[t.status] ?? t.status} · needs you` : STATUS_LABEL[t.status] ?? t.status;
    return { id: t.id, label: title, description: [state, progress, t.pr ? prText(t.pr) : undefined].filter(Boolean).join(" · "), ...(t.task && t.task !== title ? { detail: t.task } : {}) };
  };
  const rest = threads.filter((t) => t.id !== coordinator?.id && t.profile !== COORDINATOR).sort((a, b) => Number(a.archived) - Number(b.archived) || b.updated_at.localeCompare(a.updated_at));
  return [{ id: CHAT, label: "Project chat", description: coordinator ? STATUS_LABEL[coordinator.status] ?? coordinator.status : "" }, ...rest.map(item)];
}

export class AgentPane {
  readonly root: HTMLElement;
  private threads: ThreadInfo[] = [];
  private state: ThreadState;
  private ship: Ship = idleShip();
  /** The open thread's folder in git, or why it has none; the Git card's state. */
  private git?: GitState | string;
  private gitOpen = false;
  private gitBusy?: GitAction;
  /** A fetch the card asked for has not answered yet. */
  private gitFetching = false;
  /** The open thread's pull request for the PR block: none yet, none at all, or why not. */
  private pr?: PrView | null | string;
  private prUi: PrUi = newPrUi();
  /** The Pull requests card: shown, its list (or why none), and its tab once the person picked one. */
  private prsOpen = false;
  private prs?: PrList | string;
  private prsTab?: PrListTab;
  /** The Issues card, while open. */
  private issues?: IssuesUi;
  /** Where Walk through is in the open findings, by finding id. */
  private walking?: string;
  private models?: ModelList;
  private permissions?: PermissionList;
  private commands: CommandEntry[] = [];
  private capabilities: Capability[] = [];
  private desktop: Record<string, unknown> = {};
  private choices: RunChoices = { worktree: false };
  private chosen = new Set<keyof RunChoices>();
  private viewMode: ViewMode = "answers";
  private viewModeChosen = false;
  private images: string[] = [];
  private then?: Request;
  private token?: Token;
  private completions: Completion[] = [];
  private picked = 0;
  private reviewOpen = true;
  /** The project chat is showing: the coordinator's thread, or the chat before it starts. */
  private chat = false;

  private readonly header: HTMLElement;
  private readonly log: HTMLElement;
  private itemsView: ItemsView;
  /** The thread `itemsView` holds, so another thread starts from nothing drawn. */
  private drawnThread?: string;
  private readonly queue: HTMLElement;
  private readonly popup: HTMLElement;
  private readonly attachments: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly off: () => void;

  constructor(private readonly doc: Document, private readonly wire: Wire<Request, Notice>, private readonly host: PaneHost) {
    this.state = openState(host.cwd);
    this.root = el(doc, "div", "cedian-agent-pane live");
    this.header = el(doc, "div", "head");
    this.log = el(doc, "div", "log");
    this.itemsView = new ItemsView(doc);
    this.log.setAttribute("role", "log");
    this.log.setAttribute("aria-live", "polite");
    this.queue = el(doc, "div", "queue");
    const composer = el(doc, "div", "composer");
    this.popup = el(doc, "div", "popup");
    this.popup.setAttribute("role", "listbox");
    this.attachments = el(doc, "div", "attachments");
    this.input = el(doc, "textarea", "input");
    this.input.rows = 3;
    this.input.setAttribute("aria-label", "Message to the agent");
    this.chips = el(doc, "div", "chips");
    this.sendButton = button(doc, "Send", () => this.primary(), "btn send");
    const row = el(doc, "div", "row");
    row.append(this.chips, this.sendButton);
    composer.append(this.popup, this.attachments, this.input, row);
    this.root.append(this.header, this.log, this.queue, composer);
    this.input.addEventListener("input", () => this.typed());
    this.input.addEventListener("keydown", (e) => this.key(e));
    this.input.addEventListener("paste", (e) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => IMAGE_TYPES.includes(f.type) || (this.takesVideo() && VIDEO_TYPES.includes(f.type)));
      if (files.length === 0) return;
      e.preventDefault();
      void this.paste(files);
    });
    this.off = wire.onAny((n) => this.notice(n));
    wire.request({ op: "threads", cwd: host.cwd });
    wire.request({ op: "commands", cwd: host.cwd });
    this.render();
  }

  dispose(): void {
    this.off();
    if (this.state.thread) this.wire.request({ op: "close", thread: this.state.thread });
  }

  get thread(): string | undefined {
    return this.state.thread;
  }

  get composer(): HTMLTextAreaElement {
    return this.input;
  }

  /** The thread's own folder (its worktree), else the project's. */
  private get cwd(): string {
    return this.state.info?.cwd ?? this.host.cwd;
  }

  /** The folder Source Control was last pointed at. */
  private repository?: string;

  /** Points Source Control at the open thread's folder once it is known, and again when it changes. */
  private followRepository(): void {
    const path = this.state.thread && !this.state.info ? undefined : this.cwd;
    if (!path || path === this.repository || !this.host.showRepository) return;
    this.repository = path;
    this.host.showRepository(path);
  }

  // ---- actions (the keybinding layer calls these) ----

  newThread(): void {
    this.leave();
    this.chat = false;
    this.state = openState(this.host.cwd);
    this.ship = idleShip();
    this.render();
    this.input.focus();
  }

  openThread(id: string): void {
    this.chat = id === coordinatorThread(this.threads)?.id;
    if (id === this.state.thread) return this.render();
    this.leave();
    this.chosen.delete("model");
    this.chosen.delete("effort");
    this.chosen.delete("permission");
    this.choices.effort = undefined;
    this.defaults();
    this.state = openState(this.host.cwd, id);
    const info = this.threads.find((t) => t.id === id);
    if (info) this.state = { ...this.state, info, status: info.status };
    this.ship = idleShip();
    this.wire.request({ op: "open", cwd: this.host.cwd, thread: id });
    this.git = undefined;
    this.gitOpen = false;
    this.gitBusy = undefined;
    this.gitFetching = false;
    this.pr = undefined;
    this.prUi = newPrUi();
    if (info?.pr) {
      this.pr = null;
      this.wire.request({ op: "pr_view", cwd: this.host.cwd, thread: id });
    }
    this.wire.request({ op: "git", cwd: this.host.cwd, thread: id });
    this.wire.request({ op: "review", cwd: this.cwd, thread: id });
    this.render();
    this.followRepository();
  }

  /** The project chat (⌘0): the coordinator's thread, or a new one started from the composer. */
  /** The thread search's list, for the workbench's quick pick. */
  searchItems(): ThreadSearchItem[] {
    return threadSearch(this.threads);
  }

  /** Opens what the thread search picked. */
  pick(id: string): void {
    if (id === CHAT) this.projectChat();
    else this.openThread(id);
  }

  projectChat(): void {
    const coordinator = coordinatorThread(this.threads);
    if (coordinator) this.openThread(coordinator.id);
    else {
      this.newThread();
      this.chat = true;
      this.render();
    }
    this.input.focus();
  }

  /** The next (1) or previous (-1) thread in the list. */
  stepThread(delta: number): void {
    const list = threadList(this.threads);
    if (list.length === 0) return;
    const at = list.findIndex((t) => t.id === this.state.thread);
    const next = list[(at + delta + list.length) % list.length]!;
    this.openThread(next.id);
  }

  stop(): void {
    if (this.state.thread && isRunning(this.state)) this.wire.request({ op: "stop", thread: this.state.thread });
  }

  cycleViewMode(): void {
    this.viewMode = nextViewMode(this.viewMode);
    this.viewModeChosen = true;
    this.render();
  }

  focusComposer(): void {
    this.input.focus();
  }

  /** Moves the open thread into a window of its own; this pane goes on with a new thread. */
  popOut(): void {
    if (!this.host.popOut) return;
    const thread = this.state.thread;
    this.host.popOut(thread);
    if (thread) this.newThread();
  }

  /** Opens the open thread's review in a window of its own. */
  popOutReview(): void {
    if (this.state.thread && this.state.review?.files.length) this.host.openReviewWindow?.(this.state.thread, this.cwd, this.state.review);
  }

  toggleReview(): void {
    this.reviewOpen = !this.reviewOpen;
    if (this.reviewOpen && this.state.thread && this.state.review) this.host.openReview(this.state.thread, this.cwd, this.state.review);
    this.render();
  }

  /** Opens one of the chips' menus, for Cmd+Shift+M, I and E. */
  menu(which: "permission" | "model" | "effort"): void {
    const s = this.chips.querySelector<HTMLSelectElement>(`select[data-chip="${which}"]`);
    if (!s) return;
    s.focus();
    try {
      (s as HTMLSelectElement & { showPicker?: () => void }).showPicker?.();
    } catch {
      // Not every engine opens a select from code; focus is enough to pick with the keys.
    }
  }

  /** Puts files in the composer (an image, or a capture from elsewhere). */
  attach(paths: string[]): void {
    this.images.push(...paths.filter((p) => !this.images.includes(p)));
    this.renderComposer();
  }

  /**
   * Puts context from elsewhere in the composer: text (an element the Browser block picked, a
   * console line) after what is typed, and its picture when given, saved through `saveImage`.
   */
  async addContext(text: string, png?: Uint8Array): Promise<void> {
    const typed = this.input.value.trimEnd();
    this.input.value = typed ? `${typed}\n\n${text}\n` : `${text}\n`;
    this.typed();
    if (png && this.host.saveImage) {
      try {
        this.attach([await this.host.saveImage(png, "image/png")]);
      } catch (e) {
        this.state = { ...this.state, error: `Couldn't attach the element's picture: ${(e as Error).message}` };
        this.render();
      }
    }
    this.input.focus();
  }

  /** cedia takes a video on `--image` and shows it as frames. */
  takesVideo(): boolean {
    return this.capabilities.includes("video");
  }

  /** Attaches pasted images and videos: a copied file by its path, a screenshot or picture through `saveImage`. */
  async paste(files: File[]): Promise<void> {
    const paths: string[] = [];
    try {
      for (const file of files) {
        const path = (file as File & { path?: string }).path;
        if (path) paths.push(path);
        else if (this.host.saveImage) paths.push(await this.host.saveImage(new Uint8Array(await file.arrayBuffer()), file.type));
      }
    } catch (e) {
      // Shown in the pane (spec §8.4 inline), with what was saved before it still attached.
      this.state = { ...this.state, error: `Couldn't attach the pasted file: ${(e as Error).message}` };
      this.render();
    }
    if (paths.length) this.attach(paths);
  }

  // ---- notices ----

  private notice(n: Notice): void {
    const before = this.state;
    this.state = reduce(this.state, n);
    this.ship = this.state.thread ? shipNotice(this.ship, this.state.thread, n) : this.ship;
    switch (n.kind) {
      case "welcome":
        this.capabilities = "Ok" in n.cedia ? n.cedia.Ok.capabilities : [];
        break;
      case "threads":
        if (n.cwd === this.host.cwd) this.threads = n.threads;
        // The PR watch found the open thread's PR since it opened: draw its block.
        if (this.state.thread && this.state.info?.pr && this.pr === undefined) {
          this.pr = null;
          this.wire.request({ op: "pr_view", cwd: this.host.cwd, thread: this.state.thread });
        }
        break;
      case "choices":
        if (n.models) this.models = n.models;
        if (n.permissions) this.permissions = n.permissions;
        this.defaults();
        break;
      case "commands":
        if (n.cwd === this.host.cwd) this.commands = n.commands;
        break;
      case "settings":
        this.desktop = (typeof n.desktop === "object" && n.desktop) ? (n.desktop as Record<string, unknown>) : {};
        if (!this.viewModeChosen) this.viewMode = viewModeOf(this.desktop.view_mode);
        this.defaults();
        break;
      case "pr_view":
        if (n.thread !== this.state.thread) break;
        this.pr = "Ok" in n.view ? n.view.Ok : n.view.Err;
        if (n.acted) this.prUi.busy = undefined;
        break;
      case "prs":
        if (n.cwd === this.host.cwd) this.prs = "Ok" in n.list ? n.list.Ok : n.list.Err;
        break;
      case "issues":
        if (n.cwd === this.host.cwd && this.issues && JSON.stringify(n.filter) === JSON.stringify(filterOf(this.issues))) this.issues.list = "Ok" in n.list ? n.list.Ok : n.list.Err;
        break;
      case "issue": {
        const ui = this.issues;
        if (n.cwd !== this.host.cwd || !ui) break;
        if (n.acted) {
          // A comment that went with it is on GitHub now; a failed send keeps the text to try again.
          if (!n.failed && (ui.busy === "Comment" || ui.busy === "Close")) ui.draft = "";
          ui.busy = undefined;
        }
        ui.failed = n.failed ?? undefined;
        // A new issue opens once GitHub has it; any other answer is for the issue open now.
        if (ui.writing && n.acted && n.number != null && !n.failed) {
          ui.writing = false;
          ui.newTitle = ui.newBody = "";
          ui.open = n.number;
        }
        if (n.number != null && n.number === ui.open) ui.view = "Ok" in n.view ? n.view.Ok : n.view.Err;
        break;
      }
      case "pr_log":
        if (n.thread === this.state.thread && this.prUi.log?.run === n.run) this.prUi.log = { run: n.run, text: n.log };
        break;
      case "git":
        if (n.thread !== this.state.thread) break;
        this.git = "Ok" in n.state ? n.state.Ok : n.state.Err;
        if (n.fetched) this.gitFetching = false;
        // A pushed branch may have a PR the watch does not follow: read it, so the block shows
        // without arming the watch's fixes.
        if ("Ok" in n.state && n.state.Ok.upstream && this.pr === undefined) {
          this.pr = null;
          this.wire.request({ op: "pr_view", cwd: this.host.cwd, thread: n.thread });
        }
        // A read that lands mid-push leaves the push's button busy until its own answer.
        if (n.after && n.after === this.gitBusy) this.gitBusy = undefined;
        break;
      case "committed":
        if (n.thread === this.state.thread) this.wire.request({ op: "git", cwd: this.host.cwd, thread: n.thread });
        break;
      case "archive_guard":
        void this.archiveGuard(n.cwd, n.thread, n.files);
        break;
      case "started":
        if (before.thread === undefined && this.state.thread) this.wire.request({ op: "threads", cwd: this.host.cwd });
        break;
      case "status":
        if (n.thread === this.state.thread && !isRunning(this.state) && isRunning(before)) {
          // The run ended: what it changed is ready to review, and a "Send now" waits for this.
          this.wire.request({ op: "git", cwd: this.host.cwd, thread: n.thread });
          if (this.state.info?.pr || (this.pr && typeof this.pr === "object")) this.wire.request({ op: "pr_view", cwd: this.host.cwd, thread: n.thread });
          this.wire.request({ op: "review", cwd: this.cwd, thread: n.thread });
          if (this.then) {
            this.wire.request(this.then);
            this.then = undefined;
          }
        }
        break;
    }
    this.render();
    if (n.kind === "threads") this.followRepository();
    if (n.kind === "blocks" || n.kind === "text") this.drawn(n.thread);
  }

  /** Acks a thread's notice once the frame that shows it is painted (spec §3.9 credit). */
  private drawn(thread: string): void {
    const ack = () => this.wire.request({ op: "ack", thread });
    // The window the pane is drawn in now: a pane popped out makes its DOM from the main window's
    // document (VS Code allows no other), and the main window may be hidden while it paints.
    const view = this.root.ownerDocument.defaultView ?? this.doc.defaultView;
    const frame = view?.requestAnimationFrame;
    if (frame) frame.call(view, ack);
    else setTimeout(ack, 0);
  }

  /** The chips start from `desktop` (Settings), else cedia's own defaults. */
  private defaults(): void {
    if (!this.chosen.has("model")) {
      const model = typeof this.desktop.model === "string" ? this.desktop.model : undefined;
      this.choices.model = model;
    }
    if (!this.chosen.has("permission")) {
      const permission = typeof this.desktop.permission === "string" ? this.desktop.permission : undefined;
      this.choices.permission = permission;
    }
  }

  private leave(): void {
    if (this.state.thread) this.wire.request({ op: "close", thread: this.state.thread });
    this.then = undefined;
  }

  // ---- composer ----

  private get draft(): Draft {
    return { text: this.input.value, images: this.images };
  }

  private primary(): void {
    if (isRunning(this.state) && isEmpty(this.draft)) return this.stop();
    this.send();
  }

  private send(): void {
    if (this.input.value.trim() === CODE_REVIEW) return this.codeReview();
    if (this.input.value.trim() === ARCHIVE) return this.archive();
    if (this.input.value.trim() === PRS) return this.openPrs();
    if (this.input.value.trim() === ISSUES) return this.openIssues();
    if (this.chat && this.state.thread && this.sendToThread()) return;
    const target = { cwd: this.state.thread ? this.cwd : this.host.cwd, ...(this.state.thread ? { thread: this.state.thread } : {}), running: isRunning(this.state) };
    // A thread goes on with its own model and permission unless the person picked others for it.
    const choices = { ...this.choices };
    if (this.state.thread && !this.chosen.has("model")) choices.model = undefined;
    if (this.state.thread && !this.chosen.has("permission")) choices.permission = threadPermission(this.state.info) ?? choices.permission;
    let requests = submit(this.draft, target, choices);
    // The chat's first message starts the coordinator's thread in the project itself.
    if (this.chat && !this.state.thread) requests = requests.map((r) => (r.op === "prompt" ? { ...r, profile: COORDINATOR, worktree: false } : r));
    this.sent(requests);
  }

  /** `/code-review`: cedia reviews what the open thread changed; the card shows the findings. */
  private codeReview(): void {
    const thread = this.state.thread;
    if (!thread || !this.can("code-review")) {
      this.state = { ...this.state, error: thread ? "This cedia cannot review code yet" : "Open a thread that changed files first, then run /code-review" };
      return this.render();
    }
    this.sent([{ op: "code_review", cwd: this.cwd, thread }]);
  }

  /** `/prs`: the Pull requests card, asked of GitHub again each time it opens. */
  private openPrs(): void {
    this.prsOpen = true;
    this.prs = undefined;
    this.prsTab = undefined;
    this.wire.request({ op: "prs", cwd: this.host.cwd });
    this.input.value = "";
    this.closePopup();
    this.render();
  }

  /** `/issues`: the Issues card, asked of GitHub again each time it opens. */
  private openIssues(): void {
    this.issues = newIssuesUi();
    this.wire.request({ op: "issues", cwd: this.host.cwd, filter: filterOf(this.issues) });
    this.input.value = "";
    this.closePopup();
    this.render();
  }

  private issuesCard(ui: IssuesUi): HTMLElement {
    const cwd = this.host.cwd;
    return issuesCard(this.doc, ui, {
      list: () => {
        ui.list = undefined;
        this.wire.request({ op: "issues", cwd, filter: filterOf(ui) });
        this.render();
      },
      open: (number) => {
        ui.open = number;
        ui.view = undefined;
        ui.closeMenu = false;
        this.wire.request({ op: "issue", cwd, number });
        this.render();
      },
      act: (number, action, label) => {
        ui.busy = label;
        ui.failed = undefined;
        this.wire.request({ op: "issue_act", cwd, number, action });
        this.render();
      },
      create: (issue) => {
        ui.busy = "New issue";
        ui.failed = undefined;
        this.wire.request({ op: "new_issue", cwd, issue });
        this.render();
      },
      // As Fix in thread: the person reads the task and sends it, in a new thread's worktree.
      start: (view) => {
        this.issues = undefined;
        this.newThread();
        this.input.value = issueTask(view);
        this.input.focus();
        this.render();
      },
      threadOf: (pr) => {
        const t = this.threads.find((t) => !t.archived && t.pr?.number === pr);
        return t && { label: `thread ${t.state}`, open: () => ((this.issues = undefined), this.openThread(t.id)) };
      },
      openUrl: (url) => this.host.openUrl(url),
      redraw: () => this.render(),
      close: () => ((this.issues = undefined), this.render()),
    });
  }

  private prsCard(): HTMLElement {
    const list = this.prs;
    const tab = this.prsTab ?? (list && typeof list === "object" ? firstTab(list) : "open");
    return prListCard(this.doc, list, tab, {
      tab: (t) => ((this.prsTab = t), this.render()),
      // A new thread: the daemon checks the PR out in a worktree, and its `started` opens it here.
      review: (number) => {
        this.prsOpen = false;
        this.newThread();
        this.wire.request({ op: "review_pr", cwd: this.host.cwd, number });
      },
      openUrl: (url) => this.host.openUrl(url),
      close: () => ((this.prsOpen = false), this.render()),
    });
  }

  /** `/archive`: hides the open thread from the list; a worktree with uncommitted changes asks first. */
  private archive(): void {
    const thread = this.state.thread;
    if (!thread) {
      this.state = { ...this.state, error: "Open a thread first, then run /archive" };
      return this.render();
    }
    this.sent([{ op: "archive", cwd: this.cwd, thread, archived: true }]);
  }

  /** The daemon did not archive: the thread's worktree has uncommitted changes. */
  private async archiveGuard(cwd: string, thread: string, files: string[]): Promise<void> {
    if (!this.host.confirmArchive) {
      const shown = files.slice(0, 3).join(", ") + (files.length > 3 ? ` and ${files.length - 3} more` : "");
      this.state = { ...this.state, error: `Not archived: this worktree has uncommitted changes (${shown}). Commit them first.` };
      return this.render();
    }
    if (await this.host.confirmArchive(files)) this.wire.request({ op: "archive", cwd, thread, archived: true, force: true });
  }

  private can(cap: Capability): boolean {
    return this.capabilities.length === 0 || this.capabilities.includes(cap);
  }

  /**
   * In the chat, `@<thread> text` goes to that thread: as its next run when it is at rest, else
   * queued for its next turn. It goes on with its own model and permission. False when the
   * message names no thread of the coordinator's.
   */
  private sendToThread(): boolean {
    const to = addressed(this.input.value, this.threads, this.state.thread!);
    if (!to) return false;
    const t = to.thread;
    const running = t.status === "working" || t.status === "queued";
    const permission = threadPermission(t);
    const requests = submit({ text: to.text, images: this.images }, { cwd: t.cwd ?? this.host.cwd, thread: t.id, running }, { worktree: false, ...(permission ? { permission } : {}) });
    this.sent(requests);
    return true;
  }

  private sent(requests: Request[]): void {
    if (requests.length === 0) return;
    for (const r of requests) this.wire.request(r);
    this.input.value = "";
    this.images = [];
    this.state = { ...this.state, error: undefined };
    this.closePopup();
    this.render();
  }

  private typed(): void {
    const token = tokenAt(this.input.value, this.input.selectionStart ?? this.input.value.length);
    this.token = token;
    if (!token) return this.closePopup();
    if (token.trigger === "/") {
      const own = [...(this.state.thread ? [...(this.can("code-review") ? [CODE_REVIEW_ENTRY] : []), ARCHIVE_ENTRY] : []), PRS_ENTRY, ISSUES_ENTRY];
      this.showCompletions(complete(token, [], [...own, ...this.commands]));
      return;
    }
    const asked = token;
    // In the chat, an `@` that starts the message names one of the coordinator's threads first.
    const threads = this.chat && this.state.thread && token.start === 0 ? threadCompletions(token.query, chatCards(this.threads, this.state.thread)) : [];
    if (threads.length) this.showCompletions(threads);
    this.host.files(token.query).then((files) => {
      if (this.token === asked) this.showCompletions([...threads, ...complete(asked, files, [])]);
    }, () => {});
  }

  private showCompletions(list: Completion[]): void {
    this.completions = list;
    this.picked = 0;
    this.renderPopup();
  }

  private closePopup(): void {
    this.completions = [];
    this.token = undefined;
    this.renderPopup();
  }

  private take(completion: Completion): void {
    if (!this.token) return;
    const next = accept(this.input.value, this.token, completion);
    this.input.value = next.text;
    this.input.setSelectionRange(next.cursor, next.cursor);
    this.closePopup();
    this.input.focus();
  }

  private key(e: KeyboardEvent): void {
    if (this.completions.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = this.completions.length;
        this.picked = (this.picked + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
        this.renderPopup();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        this.take(this.completions[this.picked]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.closePopup();
        return;
      }
    }
    // Enter sends; Shift+Enter is a new line; a Thai or other IME composing keeps its Enter.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.send();
    }
  }

  // ---- drawing ----

  private render(): void {
    this.renderHeader();
    this.renderLog();
    this.renderQueue();
    this.renderComposer();
  }

  private renderHeader(): void {
    const d = this.doc;
    const list = threadList(this.threads);
    const coordinator = coordinatorThread(this.threads);
    const options = [
      { value: CHAT, label: "Project chat" },
      { value: "", label: "New thread" },
      ...list.filter((t) => t.id !== coordinator?.id).map((t) => ({ value: t.id, label: `${t.title || t.task}${t.needs_you ? " •" : ""}` })),
    ];
    const picker = select(d, options, this.chat ? CHAT : (this.state.thread ?? ""), (id) => (id === CHAT ? this.projectChat() : id ? this.openThread(id) : this.newThread()), "sel threads");
    picker.setAttribute("aria-label", "Thread");
    const status = this.state.status;
    const dot = el(d, "span", `dot st-${status ?? "none"}`);
    if (status) dot.title = STATUS_LABEL[status] ?? status;
    const mode = button(d, VIEW_MODES.find((v) => v.mode === this.viewMode)!.label, () => this.cycleViewMode(), "chip view");
    mode.title = "Switch view (Ctrl+O)";
    this.header.replaceChildren(picker, dot, mode);
    if (this.host.popOut) {
      const pop = button(d, "⧉", () => this.popOut(), "chip pop");
      pop.title = "Open in new window";
      pop.setAttribute("aria-label", "Open in new window");
      this.header.append(pop);
    }
    const open = this.state.thread ? this.threads.find((t) => t.id === this.state.thread) : undefined;
    if (open?.pr) {
      this.header.insertBefore(this.prChip(open.pr), mode);
      if (open.pr.state === "open") this.header.insertBefore(this.watchButton(open.id, false), mode);
    } else if (open?.pr_unwatched) this.header.insertBefore(this.watchButton(open.id, true), mode);
    const meter = contextMeter(this.state.view.context ?? undefined, currentModel(this.state.view.blocks as Block[], this.state.info), this.models);
    if (meter) {
      const ns = "http://www.w3.org/2000/svg";
      const svg = d.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("class", meter.high ? "ring high" : "ring");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", meterLabel(meter));
      const track = d.createElementNS(ns, "circle");
      const arc = d.createElementNS(ns, "circle");
      for (const c of [track, arc]) {
        c.setAttribute("cx", "8");
        c.setAttribute("cy", "8");
        c.setAttribute("r", "6");
      }
      track.setAttribute("class", "track");
      arc.setAttribute("class", "arc");
      arc.setAttribute("stroke-dasharray", ringDash(meter));
      arc.setAttribute("transform", "rotate(-90 8 8)");
      const title = d.createElementNS(ns, "title");
      title.textContent = `${meterLabel(meter)} (${meter.percent}%)`;
      svg.append(title, track, arc);
      this.header.append(svg);
    }
    if (this.state.view.runCost > 0) this.header.append(el(d, "span", "small m cost", `$${this.state.view.runCost.toFixed(2)}`));
  }

  private renderLog(): void {
    const d = this.doc;
    const nearBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
    const parts: HTMLElement[] = [];
    if (!this.state.thread) {
      const hint = this.chat ? "Project chat: say what you want done, and the coordinator splits it up and opens a thread for each part" : "New thread: type what you want done below";
      parts.push(el(d, "div", "empty", this.state.preparing ?? hint));
    } else {
      // A new thread starts from no drawn items; the same thread reuses what is drawn.
      if (this.drawnThread !== this.state.thread) (this.itemsView = new ItemsView(d)), (this.drawnThread = this.state.thread);
      parts.push(this.itemsView.update(items(visibleBlocks(withoutTriage(this.state.view.blocks as Block[]), this.viewMode))));
      if (!this.state.caught) parts.push(el(d, "div", "small loading", "Loading thread…"));
    }
    if (this.chat && this.state.thread) {
      const cards = chatCards(this.threads, this.state.thread);
      if (cards.length) parts.push(this.threadCards(cards));
    }
    const todo = todoCard(this.state.info);
    if (todo) parts.push(this.todoCard(todo));
    const ask = askCard(this.state.info);
    if (ask) parts.push(this.askCard(ask));
    if (this.state.review && this.state.review.files.length > 0 && !isRunning(this.state)) parts.push(this.reviewCard(this.state.review));
    if (this.state.notes?.comments.length) parts.push(this.commentsCard(this.state.notes.comments));
    if (this.state.notes?.reviewing || this.state.notes?.review) parts.push(this.codeReviewCard());
    // A commit started from the Git card shows here too, with or without a review.
    if (this.state.thread && !isRunning(this.state) && ((this.state.review && this.state.review.files.length > 0) || this.ship.commit.step !== "idle")) parts.push(this.shipCard());
    if (this.gitOpen && this.state.thread) parts.push(this.gitCard());
    if (this.prsOpen) parts.push(this.prsCard());
    if (this.issues) parts.push(this.issuesCard(this.issues));
    if (this.state.thread && this.pr && typeof this.pr === "object") parts.push(this.prCard(this.pr));
    if (this.state.error) parts.push(el(d, "div", "error bad", this.state.error));
    setChildren(this.log, parts);
    if (nearBottom) this.log.scrollTop = this.log.scrollHeight;
  }

  /** The thread's PR: where it stands; a click opens it. */
  private prChip(pr: NonNullable<ThreadInfo["pr"]>): HTMLElement {
    const chip = button(this.doc, prText(pr), () => this.host.openUrl(pr.url), `chip pr pr-${prLabel(pr).tone}`);
    chip.title = pr.url;
    return chip;
  }

  /** Stop watching (×) beside an open PR's chip, or Watch PR once the person stopped it. */
  private watchButton(thread: string, watch: boolean): HTMLElement {
    const b = button(this.doc, watch ? "Watch PR" : "×", () => this.wire.request({ op: "pr_watch", cwd: this.host.cwd, thread, watch }), "chip pr-watch");
    b.title = watch ? "Watch this thread's PR again" : "Stop watching this thread's PR";
    return b;
  }

  /** The coordinator's threads, one card each: open it, or answer its question here. */
  private threadCards(cards: ChatCard[]): HTMLElement {
    const d = this.doc;
    const box = el(d, "div", "card threads");
    for (const c of cards) {
      const row = el(d, "div", `thread-card st-${c.status}${c.archived ? " archived" : ""}`);
      row.dataset.thread = c.id;
      const head = el(d, "div", "row");
      const state = c.archived ? "Archived" : STATUS_LABEL[c.status] ?? c.status;
      head.append(el(d, "span", `dot st-${c.status}`), el(d, "span", "title ell", c.title), el(d, "span", "small", [state, c.progress].filter(Boolean).join(" · ")));
      if (c.pr) head.append(this.prChip(c.pr));
      head.append(button(d, "Open", () => this.openThread(c.id), "btn small"));
      row.append(head);
      if (c.step && !c.archived) row.append(el(d, "div", "small step", c.step));
      if (c.question) {
        const q = c.question;
        row.append(el(d, "div", "q", q.text));
        const choices = el(d, "div", "row");
        q.options.forEach((option, i) =>
          choices.append(button(d, option, () => {
            const r = answer(c.cwd ?? this.host.cwd, c.id, option);
            if (r) this.wire.request(r);
          }, i === 0 ? "btn primary" : "btn")),
        );
        if (q.options.length === 0) choices.append(button(d, "Answer in the thread", () => this.openThread(c.id), "btn"));
        row.append(choices);
      }
      box.append(row);
    }
    box.append(el(d, "div", "small hint", "Type @ and a thread to message that thread directly"));
    return box;
  }

  private todoCard(todo: NonNullable<ReturnType<typeof todoCard>>): HTMLElement {
    const d = this.doc;
    const card = el(d, "div", "card todo");
    card.append(el(d, "div", "small", `Steps ${todo.progress}`));
    const list = el(d, "ul", "steps");
    for (const step of todo.steps) {
      const li = el(d, "li", `step ${step.state}`);
      li.append(el(d, "span", "mark", step.state === "done" ? "✓" : step.state === "doing" ? "✱" : "○"), el(d, "span", "", step.text));
      list.append(li);
    }
    card.append(list);
    return card;
  }

  private askCard(ask: NonNullable<ReturnType<typeof askCard>>): HTMLElement {
    const d = this.doc;
    const card = el(d, "div", "card ask");
    card.append(el(d, "div", "q", ask.question));
    const reply = (text: string) => {
      const r = answer(this.cwd, this.state.thread!, text, this.runChoices());
      if (r) this.wire.request(r);
    };
    const row = el(d, "div", "row");
    ask.options.forEach((option, i) => row.append(button(d, option, () => reply(option), i === 0 ? "btn primary" : "btn")));
    card.append(row, el(d, "div", "small", ask.options.length ? "Or type your own answer below" : "Type your answer below"));
    return card;
  }

  private runChoices(): { model?: string; permission?: string; effort?: string } {
    const { model, permission, effort } = this.choices;
    return { ...(model ? { model } : {}), ...(permission ? { permission } : {}), ...(effort ? { effort } : {}) };
  }

  private reviewCard(review: Review): HTMLElement {
    const d = this.doc;
    const thread = this.state.thread!;
    const sum = summarize(review.files);
    const card = el(d, "div", "card review");
    const head = el(d, "div", "row");
    head.append(el(d, "span", "", `${sum.files} ${sum.files === 1 ? "file" : "files"}`), el(d, "span", "ok m", `+${sum.added}`), el(d, "span", "bad m", `−${sum.removed}`));
    if (sum.pending) head.append(el(d, "span", "small", `${sum.pending} to review`));
    // Spec §8.4: a stale hunk is said inline. Its lines were edited after the agent wrote them,
    // so accepting or rejecting it no longer applies.
    if (sum.stale) head.append(el(d, "span", "small warn", `${sum.stale} changed since`));
    head.append(button(d, "Open diff", () => this.host.openReview(thread, this.cwd, review)));
    if (this.host.openReviewWindow) head.append(button(d, "New window", () => this.host.openReviewWindow?.(thread, this.cwd, review)));
    const pending = review.files.flatMap((f) => f.hunks).filter((h) => h.state === "pending");
    if (pending.length) {
      head.append(button(d, "Accept all", () => {
        for (const h of pending) this.wire.request({ op: "decide", cwd: this.cwd, thread, hunk: h.id, decision: { decision: "accept" } });
      }, "btn primary"));
    }
    card.append(head);
    for (const file of review.files) {
      const row = el(d, "div", "file");
      const name = button(d, file.path, () => this.host.openReview(thread, this.cwd, review, file.path), "link m ell");
      row.append(name, el(d, "span", "ok m small", `+${file.added}`), el(d, "span", "bad m small", `−${file.removed}`));
      const states = file.hunks.map((h) => h.state);
      const filePending = file.hunks.filter((h) => h.state === "pending");
      if (filePending.length) {
        row.append(
          button(d, "Accept", () => filePending.forEach((h) => this.wire.request({ op: "decide", cwd: this.cwd, thread, hunk: h.id, decision: { decision: "accept" } })), "btn small"),
          button(d, "Reject", () => filePending.forEach((h) => this.wire.request({ op: "decide", cwd: this.cwd, thread, hunk: h.id, decision: { decision: "reject", reason: "" } })), "btn small danger"),
        );
      } else if (states.length && states.every((s) => s === "stale")) {
        const tag = el(d, "span", "small warn", "Changed since");
        tag.title = "These lines were edited after the agent wrote them; there is nothing left to accept or reject";
        row.append(tag);
      } else if (states.length) {
        row.append(el(d, "span", "small", states.every((s) => s === "accepted") ? "Accepted" : states.every((s) => s === "rejected") ? "Rejected" : "Reviewed"));
      }
      card.append(row);
    }
    return card;
  }

  /**
   * The line comments: each one with its state, Resolve or Reopen, and Delete; Send all (Cmd+Enter
   * in the diff) sends the unsent and still-open ones as one message. Resolved ones go last.
   */
  private commentsCard(comments: NonNullable<ThreadState["notes"]>["comments"]): HTMLElement {
    const d = this.doc;
    const thread = this.state.thread!;
    const card = el(d, "div", "card comments");
    const head = el(d, "div", "row");
    head.append(el(d, "span", "", commentCount(comments)));
    if (comments.some(goesNext)) head.append(button(d, "Send all", () => this.wire.request(sendComments(this.cwd, thread)), "btn primary"));
    card.append(head);
    const order = [...comments].sort((a, b) => Number(stateOf(a) === "resolved") - Number(stateOf(b) === "resolved"));
    for (const c of order) {
      const state = stateOf(c);
      const row = el(d, "div", `file comment-${state}`);
      const at = button(d, `${c.path}:${c.line}`, () => this.state.review && this.host.openReview(thread, this.cwd, this.state.review, c.path, c.line), "link m ell");
      row.append(at, el(d, "span", "small ell", c.text), el(d, "span", "small state", stateLabel(c)));
      if (state === "open" || state === "sent") row.append(button(d, "Resolve", () => this.wire.request(setComments(thread, resolveComment(comments, c.id, true))), "btn small"));
      if (state === "resolved") row.append(button(d, "Reopen", () => this.wire.request(setComments(thread, resolveComment(comments, c.id, false))), "btn small"));
      row.append(button(d, "Delete", () => this.wire.request(setComments(thread, comments.filter((o) => o.id !== c.id))), "btn small"));
      card.append(row);
    }
    return card;
  }

  /**
   * The `/code-review` card: the findings by file, each with Fix this one and Dismiss; Walk
   * through steps the open ones in the diff, and Apply fixes asks the thread to fix them all.
   */
  private codeReviewCard(): HTMLElement {
    const d = this.doc;
    const thread = this.state.thread!;
    const notes = this.state.notes!;
    const card = el(d, "div", "card code-review");
    const head = el(d, "div", "row");
    head.append(el(d, "span", "", "Code review"));
    if (notes.reviewing) {
      card.append(head, el(d, "div", "small", "Reviewing what this thread changed…"));
      return card;
    }
    const review = reviewed(notes);
    if (!review) {
      const why = notes.review && "error" in notes.review ? notes.review.error : "";
      head.append(button(d, "Try again", () => this.wire.request({ op: "code_review", cwd: this.cwd, thread }), "btn small"));
      card.append(head, el(d, "div", "small bad", `Review failed: ${why}`));
      return card;
    }
    head.append(el(d, "span", "small", `${findingCount(notes)} · ${review.model}`));
    const open = openFindings(notes);
    const steps = walkSteps(notes);
    const fix = (findings: string[]) => this.wire.request({ op: "fix_findings", cwd: this.cwd, thread, findings });
    const busy = isRunning(this.state);
    if (steps.length && this.state.review) {
      const at = Math.max(0, steps.findIndex((f) => f.id === this.walking));
      const walk = () => {
        const step = steps[(this.walking === undefined ? 0 : at + 1) % steps.length]!;
        this.walking = step.id;
        this.host.openReview(thread, this.cwd, this.state.review!, step.path, step.line);
        this.render();
      };
      head.append(button(d, this.walking === undefined ? "Walk through" : `Next (${at + 1}/${steps.length})`, walk, "btn small"));
    }
    if (open.length && !busy) head.append(button(d, "Fix all", () => fix([]), "btn primary"));
    head.append(button(d, "Review again", () => this.wire.request({ op: "code_review", cwd: this.cwd, thread }), "btn small"));
    card.append(head);
    if (review.summary) card.append(el(d, "div", "small", review.summary));
    for (const group of byFile(notes)) {
      card.append(el(d, "div", "m small", group.path ?? "No file"));
      for (const { finding, dismissed } of group.rows) {
        const row = el(d, "div", dismissed ? "file finding dismissed" : this.walking === finding.id ? "file finding current" : "file finding");
        const text = typeof finding.line === "number" && finding.path && this.state.review
          ? button(d, finding.text, () => {
              this.walking = finding.id;
              this.host.openReview(thread, this.cwd, this.state.review!, finding.path!, finding.line!);
              this.render();
            }, "link ell")
          : el(d, "span", "ell", finding.text);
        row.append(text);
        if (dismissed) row.append(button(d, "Restore", () => this.wire.request({ op: "dismiss", thread, finding: finding.id, dismissed: false }), "btn small"));
        else {
          if (!busy) row.append(button(d, "Fix this one", () => fix([finding.id]), "btn small"));
          row.append(button(d, "Dismiss", () => this.wire.request({ op: "dismiss", thread, finding: finding.id, dismissed: true }), "btn small"));
        }
        card.append(row);
      }
    }
    return card;
  }

  /** The PR block: the thread's pull request, its conversation and checks, Review and Merge. */
  private prCard(view: PrView): HTMLElement {
    const thread = this.state.thread!;
    return prBlock(this.doc, view, this.prUi, {
      act: (action, label) => {
        this.prUi.busy = label;
        this.wire.request({ op: "pr_act", cwd: this.host.cwd, thread, action });
        this.render();
      },
      log: (run) => {
        this.prUi.log = this.prUi.log?.run === run ? undefined : { run };
        if (this.prUi.log) this.wire.request({ op: "pr_log", cwd: this.host.cwd, thread, run });
        this.render();
      },
      // The message waits in the composer for the person to send, or change first.
      fix: (text) => {
        this.input.value = text;
        this.input.focus();
        this.render();
      },
      openUrl: (url) => this.host.openUrl(url),
      // The thread's own diff when it has one; else GitHub's, since this thread did not write it.
      openDiff: () => (this.state.review?.files.length ? this.host.openReview(thread, this.cwd, this.state.review) : this.host.openUrl(`${view.url}/files`)),
      redraw: () => this.render(),
    });
  }

  /** The Git card, from the branch chip: where the branch stands, and Pull and Push. */
  private gitCard(): HTMLElement {
    const d = this.doc;
    const thread = this.state.thread!;
    const card = el(d, "div", "card git");
    const git = this.git;
    if (git === undefined) {
      card.append(el(d, "div", "small", "Reading git…"));
      return card;
    }
    if (typeof git === "string") {
      card.append(el(d, "div", "small bad", git));
      return card;
    }
    card.append(el(d, "div", "m ell", branchLine(git)));
    const pending = pendingLine(git);
    if (pending) card.append(el(d, "div", "small", pending));
    if (git.rebasing) card.append(el(d, "div", "small warn", "A rebase stopped part way here. Finish or abort it in Source Control before the next run."));
    if (this.gitFetching) card.append(el(d, "div", "small m", "Fetching from origin…"));
    else if (git.fetch_error) card.append(el(d, "div", "small warn", `Couldn't fetch, so these counts may be old: ${git.fetch_error}`));
    const row = el(d, "div", "row");
    for (const action of git.rebasing ? [] : gitActions(git)) {
      const b = button(d, this.gitBusy === action ? ACTION_BUSY[action] : ACTION_LABEL[action], () => {
        this.gitBusy = action;
        this.wire.request({ op: "git_action", cwd: this.host.cwd, thread, action });
        this.render();
      }, "btn small");
      if (this.gitBusy) {
        b.disabled = true;
        if (this.gitBusy === action) b.setAttribute("aria-busy", "true");
      }
      row.append(b);
    }
    if (this.host.openSourceControl) row.append(button(d, "Source Control", () => this.host.openSourceControl!(this.cwd), "btn small"));
    // Commit as the receipt does (`cedia commit` drafts the message), from where git says what is uncommitted.
    if (git.changed > 0 && this.ship.commit.step === "idle" && !isRunning(this.state) && (this.capabilities.length === 0 || this.capabilities.includes("commit"))) {
      row.append(button(d, "Commit", () => {
        const r = startCommit(this.ship, this.cwd, thread);
        this.ship = r.ship;
        if (r.request) this.wire.request(r.request);
        this.render();
      }, "btn small primary"));
    }
    if (row.childElementCount) card.append(row);
    return card;
  }

  private shipCard(): HTMLElement {
    const d = this.doc;
    const thread = this.state.thread!;
    const card = el(d, "div", "card ship");
    const go = (r: { ship: Ship; request?: Request }) => {
      this.ship = r.ship;
      if (r.request) this.wire.request(r.request);
      this.render();
    };
    const c = this.ship.commit;
    const p = this.ship.pr;
    const can = (cap: Capability) => this.capabilities.length === 0 || this.capabilities.includes(cap);
    switch (c.step) {
      case "idle":
        if (can("commit")) card.append(button(d, "Commit", () => go(startCommit(this.ship, this.cwd, thread)), "btn primary"));
        break;
      case "drafting":
        card.append(el(d, "div", "small", "Drafting the commit message…"));
        break;
      case "draft": {
        const message = el(d, "textarea", "input msg");
        message.value = c.message;
        message.rows = 4;
        message.addEventListener("change", () => (this.ship = editDraft(this.ship, { message: message.value })));
        card.append(message);
        for (const file of c.files) {
          const label = el(d, "label", "row small m");
          const box = el(d, "input");
          box.type = "checkbox";
          box.checked = c.chosen.includes(file);
          box.addEventListener("change", () => {
            const now = this.ship.commit.step === "draft" ? this.ship.commit.chosen : [];
            this.ship = editDraft(this.ship, { chosen: box.checked ? [...now, file] : now.filter((f) => f !== file) });
          });
          label.append(box, el(d, "span", "", file));
          card.append(label);
        }
        const row = el(d, "div", "row");
        row.append(
          button(d, "Commit", () => {
            this.ship = editDraft(this.ship, { message: message.value });
            go(confirmCommit(this.ship, this.cwd, thread));
          }, "btn primary"),
          button(d, "Cancel", () => go({ ship: cancel(this.ship, "commit") })),
        );
        if (c.branch) row.append(el(d, "span", "small m", c.branch));
        card.append(row);
        break;
      }
      case "committing":
        card.append(el(d, "div", "small", "Committing…"));
        break;
      case "committed":
        card.append(el(d, "div", "ok", `✓ ${c.commit.slice(0, 7)} ${c.subject}`));
        break;
      case "failed":
        card.append(el(d, "div", "bad", c.error), button(d, "Try again", () => go(startCommit(cancel(this.ship, "commit"), this.cwd, thread))));
        break;
    }
    if (can("pr") && (c.step === "committed" || c.step === "idle")) {
      switch (p.step) {
        case "idle":
          card.append(button(d, "Open PR", () => go(startPr(this.ship, this.cwd, thread))));
          break;
        case "checking":
          card.append(el(d, "div", "small", "Checking where the PR would go…"));
          break;
        case "plan": {
          const row = el(d, "div", "row");
          row.append(
            el(d, "span", "small", `Push ${p.branch}${p.base ? ` and open a PR into ${p.base}` : " and open a PR"}`),
            button(d, "Open it", () => go(confirmPr(this.ship, this.cwd, thread)), "btn primary"),
            button(d, "Cancel", () => go({ ship: cancel(this.ship, "pr") })),
          );
          card.append(row);
          break;
        }
        case "blocked":
          card.append(el(d, "div", "small bad", `Can't open a PR: ${p.reason}`));
          break;
        case "opening":
          card.append(el(d, "div", "small", "Pushing and opening the PR…"));
          break;
        case "opened":
          card.append(p.url ? button(d, `PR: ${p.url}`, () => this.host.openUrl(p.url!), "link") : el(d, "div", "ok", `✓ Opened a PR from ${p.branch}`));
          break;
        case "failed":
          card.append(el(d, "div", "bad", p.error));
          break;
      }
    }
    return card;
  }

  private renderQueue(): void {
    const d = this.doc;
    const thread = this.state.thread;
    const waiting = thread ? queued(this.state.info) : [];
    this.queue.replaceChildren();
    if (!thread || waiting.length === 0) return;
    const target = { cwd: this.cwd, thread };
    this.queue.append(el(d, "div", "small", `${waiting.length} queued`));
    for (const q of waiting) {
      const row = el(d, "div", "queued row");
      row.append(
        el(d, "span", "ell", q.text),
        button(d, "Edit", () => {
          const r = editQueued(q, target);
          this.wire.request(r.request);
          this.input.value = r.draft.text;
          this.input.focus();
        }, "btn small"),
        button(d, "Send now", () => {
          const r = sendNow(q, target, this.choices);
          for (const req of r.now) this.wire.request(req);
          this.then = r.then;
        }, "btn small primary"),
        button(d, "×", () => this.wire.request(dropQueued(q, target)), "btn small"),
      );
      this.queue.append(row);
    }
  }

  private renderPopup(): void {
    const d = this.doc;
    this.popup.replaceChildren();
    this.popup.hidden = this.completions.length === 0;
    this.completions.forEach((c, i) => {
      const row = el(d, "div", i === this.picked ? "opt on" : "opt");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(i === this.picked));
      row.append(el(d, "span", "m", c.label));
      if (c.detail) row.append(el(d, "span", "small ell", c.detail));
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.take(c);
      });
      this.popup.append(row);
    });
  }

  private renderComposer(): void {
    const d = this.doc;
    const running = isRunning(this.state);
    this.input.placeholder = running ? "Your message waits for the agent's next turn" : this.state.thread ? "Continue this thread" : "What should the agent do? (@ files, / commands)";
    this.sendButton.textContent = running && isEmpty(this.draft) ? "Stop" : running ? "Queue" : "Send";
    this.sendButton.className = running && isEmpty(this.draft) ? "btn send stop" : "btn send";
    this.attachments.replaceChildren(
      ...this.images.map((path) => {
        const chip = el(d, "span", "tag");
        chip.append(el(d, "span", "ell", path.split("/").pop() ?? path), button(d, "×", () => {
          this.images = this.images.filter((p) => p !== path);
          this.renderComposer();
        }, "x"));
        return chip;
      }),
    );
    const chips: HTMLElement[] = [];
    const pick = <K extends "model" | "permission" | "effort">(key: K) => (value: string) => {
      this.choices[key] = value || undefined;
      this.chosen.add(key);
      this.renderComposer();
    };
    if (this.models) {
      const threadModel = this.state.thread && !this.chosen.has("model") ? currentModel(this.state.view.blocks as Block[], this.state.info) : undefined;
      const shown = threadModel ?? this.choices.model ?? "";
      const s = select(d, [{ value: "", label: `Model: ${this.models.default}` }, ...this.models.models.map((m) => ({ value: m.ref, label: m.label, disabled: !m.available, title: m.reason ?? m.ref })), ...this.models.modes.map((m) => ({ value: m.name, label: m.label })), ...(shown && !this.models.models.some((m) => m.ref === shown) && !this.models.modes.some((m) => m.name === shown) ? [{ value: shown, label: shown }] : [])], shown, pick("model"), "chip");
      s.dataset.chip = "model";
      s.title = "Model (Cmd+Shift+I)";
      chips.push(s);
      const entry = this.models.models.find((m) => m.ref === (shown || this.models!.default));
      if (entry?.effort) {
        const levels = entry.effortLevels?.length ? entry.effortLevels : ["low", "medium", "high", "xhigh", "max"];
        const e = select(d, [{ value: "", label: `effort: ${entry.defaultEffort ?? "default"}` }, ...levels.map((l) => ({ value: l, label: l }))], this.choices.effort ?? "", pick("effort"), "chip");
        e.dataset.chip = "effort";
        e.title = "Effort (Cmd+Shift+E)";
        chips.push(e);
      }
    }
    if (this.permissions) {
      const threadMode = this.state.thread && !this.chosen.has("permission") ? threadPermission(this.state.info) : undefined;
      const s = select(d, this.permissions.modes.map((m) => ({ value: m.mode, label: m.label, title: m.description })), threadMode ?? this.choices.permission ?? this.permissions.default, pick("permission"), "chip");
      s.dataset.chip = "permission";
      s.title = "Permission (Cmd+Shift+M)";
      chips.push(s);
    }
    if (this.state.thread && this.git && typeof this.git !== "string") {
      const branch = button(d, `⑂ ${this.git.branch ?? "detached"}`, () => {
        this.gitOpen = !this.gitOpen;
        // Opening it is the person's ask to look at the remote: fetch, so behind is current.
        if (this.gitOpen) {
          this.gitFetching = true;
          this.wire.request({ op: "git", cwd: this.host.cwd, thread: this.state.thread!, fetch: true });
        }
        this.render();
      }, "chip m git");
      branch.setAttribute("aria-expanded", String(this.gitOpen));
      branch.title = branchLine(this.git);
      chips.push(branch);
    }
    if (!this.state.thread) {
      const label = el(d, "label", "chip check");
      const box = el(d, "input");
      box.type = "checkbox";
      box.checked = this.choices.worktree;
      box.addEventListener("change", () => (this.choices.worktree = box.checked));
      label.append(box, el(d, "span", "", "New worktree"));
      chips.push(label);
    }
    if (this.capabilities.length === 0 || this.capabilities.includes("images")) {
      const video = this.takesVideo();
      chips.push(button(d, video ? "+ Image/video" : "+ Image", () => this.host.pickImages(video).then((paths) => this.attach(paths), () => {}), "chip"));
    }
    this.chips.replaceChildren(...chips);
  }
}
