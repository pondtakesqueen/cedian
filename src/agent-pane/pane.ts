// The live agent pane (spec §11 Phase B "One live thread"): the project's threads, the open
// thread drawn from the daemon's notices, its cards (question, todo, review, commit and PR), and
// the composer with its chips. A viewer: every change is a request to the daemon, and what shows
// is only what the daemon sent back, so a reconnect or a restarted daemon redraws it whole.
import { complete, accept, tokenAt, type Completion, type Token } from "../composer/complete.js";
import { dropQueued, editQueued, isEmpty, sendNow, submit, type Draft, type RunChoices } from "../composer/composer.js";
import { button, el, select, type Wire } from "../dom/el.js";
import type { Capability, CommandEntry, ModelList, Notice, PermissionList, Request, Review, ThreadInfo } from "../protocol/wire.js";
import { summarize } from "../review/original.js";
import { answer, askCard, todoCard } from "./cards.js";
import { contextMeter, meterLabel, ringDash } from "./context-meter.js";
import { items } from "./items.js";
import { renderItems } from "./render.js";
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
  /** Image files the person picks. */
  pickImages(): Promise<string[]>;
  /**
   * Writes a pasted image that has no file of its own and returns the file's path. It needs to last
   * only until the run starts: cedia keeps its own copy by hash.
   */
  saveImage?(bytes: Uint8Array, mime: string): Promise<string>;
  /** The diff editor for the thread's review, at one file when named. */
  openReview(thread: string, cwd: string, review: Review, file?: string): void;
  openUrl(url: string): void;
}

/** What cedia shows a model (`ImageMime`). */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Threads newest first; archived ones and side chats stay out of the list. */
export function threadList(threads: ThreadInfo[]): ThreadInfo[] {
  return threads.filter((t) => !t.archived).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** The thread picker's value for the project chat. */
export const CHAT = "@chat";

const STATUS_LABEL: Record<string, string> = {
  queued: "รอคิว",
  working: "กำลังทำ",
  done: "เสร็จ",
  failed: "ไม่สำเร็จ",
  stopped: "หยุดแล้ว",
  interrupted: "ถูกขัด",
  asking: "รอคำตอบ",
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
    const state = t.archived ? "เก็บแล้ว" : t.needs_you ? `${STATUS_LABEL[t.status] ?? t.status} · ต้องดู` : STATUS_LABEL[t.status] ?? t.status;
    return { id: t.id, label: title, description: [state, progress, t.pr ? prText(t.pr) : undefined].filter(Boolean).join(" · "), ...(t.task && t.task !== title ? { detail: t.task } : {}) };
  };
  const rest = threads.filter((t) => t.id !== coordinator?.id && t.profile !== COORDINATOR).sort((a, b) => Number(a.archived) - Number(b.archived) || b.updated_at.localeCompare(a.updated_at));
  return [{ id: CHAT, label: "แชทโปรเจกต์", description: coordinator ? STATUS_LABEL[coordinator.status] ?? coordinator.status : "" }, ...rest.map(item)];
}

export class AgentPane {
  readonly root: HTMLElement;
  private threads: ThreadInfo[] = [];
  private state: ThreadState;
  private ship: Ship = idleShip();
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
    this.log.setAttribute("role", "log");
    this.log.setAttribute("aria-live", "polite");
    this.queue = el(doc, "div", "queue");
    const composer = el(doc, "div", "composer");
    this.popup = el(doc, "div", "popup");
    this.popup.setAttribute("role", "listbox");
    this.attachments = el(doc, "div", "attachments");
    this.input = el(doc, "textarea", "input");
    this.input.rows = 3;
    this.input.setAttribute("aria-label", "ข้อความถึง agent");
    this.chips = el(doc, "div", "chips");
    this.sendButton = button(doc, "ส่ง", () => this.primary(), "btn send");
    const row = el(doc, "div", "row");
    row.append(this.chips, this.sendButton);
    composer.append(this.popup, this.attachments, this.input, row);
    this.root.append(this.header, this.log, this.queue, composer);
    this.input.addEventListener("input", () => this.typed());
    this.input.addEventListener("keydown", (e) => this.key(e));
    this.input.addEventListener("paste", (e) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => IMAGE_TYPES.includes(f.type));
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
    this.wire.request({ op: "review", cwd: this.cwd, thread: id });
    this.render();
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

  /** Attaches pasted images: a copied file by its path, a screenshot or picture through `saveImage`. */
  async paste(files: File[]): Promise<void> {
    const paths: string[] = [];
    for (const file of files) {
      const path = (file as File & { path?: string }).path;
      if (path) paths.push(path);
      else if (this.host.saveImage) paths.push(await this.host.saveImage(new Uint8Array(await file.arrayBuffer()), file.type));
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
      case "started":
        if (before.thread === undefined && this.state.thread) this.wire.request({ op: "threads", cwd: this.host.cwd });
        break;
      case "status":
        if (n.thread === this.state.thread && !isRunning(this.state) && isRunning(before)) {
          // The run ended: what it changed is ready to review, and a "ส่งเลย" waits for this.
          this.wire.request({ op: "review", cwd: this.cwd, thread: n.thread });
          if (this.then) {
            this.wire.request(this.then);
            this.then = undefined;
          }
        }
        break;
    }
    this.render();
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
      this.showCompletions(complete(token, [], this.commands));
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
      { value: CHAT, label: "แชทโปรเจกต์" },
      { value: "", label: "เธรดใหม่" },
      ...list.filter((t) => t.id !== coordinator?.id).map((t) => ({ value: t.id, label: `${t.title || t.task}${t.needs_you ? " •" : ""}` })),
    ];
    const picker = select(d, options, this.chat ? CHAT : (this.state.thread ?? ""), (id) => (id === CHAT ? this.projectChat() : id ? this.openThread(id) : this.newThread()), "sel threads");
    picker.setAttribute("aria-label", "เธรด");
    const status = this.state.status;
    const dot = el(d, "span", `dot st-${status ?? "none"}`);
    if (status) dot.title = STATUS_LABEL[status] ?? status;
    const mode = button(d, VIEW_MODES.find((v) => v.mode === this.viewMode)!.label, () => this.cycleViewMode(), "chip view");
    mode.title = "สลับมุมมอง (Ctrl+O)";
    this.header.replaceChildren(picker, dot, mode);
    const pr = this.state.thread ? this.threads.find((t) => t.id === this.state.thread)?.pr : undefined;
    if (pr) this.header.insertBefore(this.prChip(pr), mode);
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
      const hint = this.chat ? "แชทโปรเจกต์: บอกสิ่งที่อยากให้ทำ แล้ว coordinator จะแบ่งงานและเปิดเธรดให้แต่ละงาน" : "เริ่มเธรดใหม่: พิมพ์สิ่งที่อยากให้ทำด้านล่าง";
      parts.push(el(d, "div", "empty", this.state.preparing ?? hint));
    } else {
      parts.push(renderItems(d, items(visibleBlocks(withoutTriage(this.state.view.blocks as Block[]), this.viewMode))));
      if (!this.state.caught) parts.push(el(d, "div", "small loading", "กำลังโหลดเธรด…"));
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
    if (this.state.thread && !isRunning(this.state) && this.state.review && this.state.review.files.length > 0) parts.push(this.shipCard());
    if (this.state.error) parts.push(el(d, "div", "error bad", this.state.error));
    this.log.replaceChildren(...parts);
    if (nearBottom) this.log.scrollTop = this.log.scrollHeight;
  }

  /** The thread's PR: where it stands; a click opens it. */
  private prChip(pr: NonNullable<ThreadInfo["pr"]>): HTMLElement {
    const chip = button(this.doc, prText(pr), () => this.host.openUrl(pr.url), `chip pr pr-${prLabel(pr).tone}`);
    chip.title = pr.url;
    return chip;
  }

  /** The coordinator's threads, one card each: open it, or answer its question here. */
  private threadCards(cards: ChatCard[]): HTMLElement {
    const d = this.doc;
    const box = el(d, "div", "card threads");
    for (const c of cards) {
      const row = el(d, "div", `thread-card st-${c.status}${c.archived ? " archived" : ""}`);
      row.dataset.thread = c.id;
      const head = el(d, "div", "row");
      const state = c.archived ? "เก็บแล้ว" : STATUS_LABEL[c.status] ?? c.status;
      head.append(el(d, "span", `dot st-${c.status}`), el(d, "span", "title ell", c.title), el(d, "span", "small", [state, c.progress].filter(Boolean).join(" · ")));
      if (c.pr) head.append(this.prChip(c.pr));
      head.append(button(d, "เปิด", () => this.openThread(c.id), "btn small"));
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
        if (q.options.length === 0) choices.append(button(d, "ตอบในเธรด", () => this.openThread(c.id), "btn"));
        row.append(choices);
      }
      box.append(row);
    }
    box.append(el(d, "div", "small hint", "พิมพ์ @ ตามด้วยเธรดเพื่อส่งข้อความถึงเธรดนั้นโดยตรง"));
    return box;
  }

  private todoCard(todo: NonNullable<ReturnType<typeof todoCard>>): HTMLElement {
    const d = this.doc;
    const card = el(d, "div", "card todo");
    card.append(el(d, "div", "small", `ขั้นตอน ${todo.progress}`));
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
    card.append(row, el(d, "div", "small", ask.options.length ? "หรือพิมพ์คำตอบเองในช่องด้านล่าง" : "พิมพ์คำตอบในช่องด้านล่าง"));
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
    head.append(el(d, "span", "", `${sum.files} ไฟล์`), el(d, "span", "ok m", `+${sum.added}`), el(d, "span", "bad m", `−${sum.removed}`));
    if (sum.pending) head.append(el(d, "span", "small", `รอรีวิว ${sum.pending}`));
    head.append(button(d, "เปิดใน diff", () => this.host.openReview(thread, this.cwd, review)));
    const pending = review.files.flatMap((f) => f.hunks).filter((h) => h.state === "pending");
    if (pending.length) {
      head.append(button(d, "รับทั้งหมด", () => {
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
          button(d, "รับ", () => filePending.forEach((h) => this.wire.request({ op: "decide", cwd: this.cwd, thread, hunk: h.id, decision: { decision: "accept" } })), "btn small"),
          button(d, "ไม่เอา", () => filePending.forEach((h) => this.wire.request({ op: "decide", cwd: this.cwd, thread, hunk: h.id, decision: { decision: "reject", reason: "" } })), "btn small danger"),
        );
      } else if (states.length) {
        row.append(el(d, "span", "small", states.every((s) => s === "accepted") ? "รับแล้ว" : states.every((s) => s === "rejected") ? "ไม่เอาแล้ว" : "รีวิวแล้ว"));
      }
      card.append(row);
    }
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
        card.append(el(d, "div", "small", "กำลังร่างข้อความ commit…"));
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
          button(d, "ยกเลิก", () => go({ ship: cancel(this.ship, "commit") })),
        );
        if (c.branch) row.append(el(d, "span", "small m", c.branch));
        card.append(row);
        break;
      }
      case "committing":
        card.append(el(d, "div", "small", "กำลัง commit…"));
        break;
      case "committed":
        card.append(el(d, "div", "ok", `✓ ${c.commit.slice(0, 7)} ${c.subject}`));
        break;
      case "failed":
        card.append(el(d, "div", "bad", c.error), button(d, "ลองอีกครั้ง", () => go(startCommit(cancel(this.ship, "commit"), this.cwd, thread))));
        break;
    }
    if (can("pr") && (c.step === "committed" || c.step === "idle")) {
      switch (p.step) {
        case "idle":
          card.append(button(d, "เปิด PR", () => go(startPr(this.ship, this.cwd, thread))));
          break;
        case "checking":
          card.append(el(d, "div", "small", "กำลังดูว่าจะเปิด PR ไปที่ไหน…"));
          break;
        case "plan": {
          const row = el(d, "div", "row");
          row.append(
            el(d, "span", "small", `push ${p.branch}${p.base ? ` แล้วเปิด PR เข้า ${p.base}` : " แล้วเปิด PR"}`),
            button(d, "เปิดเลย", () => go(confirmPr(this.ship, this.cwd, thread)), "btn primary"),
            button(d, "ยกเลิก", () => go({ ship: cancel(this.ship, "pr") })),
          );
          card.append(row);
          break;
        }
        case "blocked":
          card.append(el(d, "div", "small bad", `เปิด PR ไม่ได้: ${p.reason}`));
          break;
        case "opening":
          card.append(el(d, "div", "small", "กำลัง push และเปิด PR…"));
          break;
        case "opened":
          card.append(p.url ? button(d, `PR: ${p.url}`, () => this.host.openUrl(p.url!), "link") : el(d, "div", "ok", `✓ เปิด PR จาก ${p.branch} แล้ว`));
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
    this.queue.append(el(d, "div", "small", `รอส่ง ${waiting.length}`));
    for (const q of waiting) {
      const row = el(d, "div", "queued row");
      row.append(
        el(d, "span", "ell", q.text),
        button(d, "แก้", () => {
          const r = editQueued(q, target);
          this.wire.request(r.request);
          this.input.value = r.draft.text;
          this.input.focus();
        }, "btn small"),
        button(d, "ส่งเลย", () => {
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
    this.input.placeholder = running ? "ข้อความจะรอส่งในรอบถัดไปของ agent" : this.state.thread ? "สั่งต่อในเธรดนี้" : "ให้ agent ทำอะไร (@ ไฟล์, / คำสั่ง)";
    this.sendButton.textContent = running && isEmpty(this.draft) ? "หยุด" : running ? "รอส่ง" : "ส่ง";
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
      const s = select(d, [{ value: "", label: `โมเดล: ${this.models.default}` }, ...this.models.models.map((m) => ({ value: m.ref, label: m.label, disabled: !m.available, title: m.reason ?? m.ref })), ...this.models.modes.map((m) => ({ value: m.name, label: m.label })), ...(shown && !this.models.models.some((m) => m.ref === shown) && !this.models.modes.some((m) => m.name === shown) ? [{ value: shown, label: shown }] : [])], shown, pick("model"), "chip");
      s.dataset.chip = "model";
      s.title = "โมเดล (Cmd+Shift+I)";
      chips.push(s);
      const entry = this.models.models.find((m) => m.ref === (shown || this.models!.default));
      if (entry?.effort) {
        const levels = entry.effortLevels?.length ? entry.effortLevels : ["low", "medium", "high", "xhigh", "max"];
        const e = select(d, [{ value: "", label: `effort: ${entry.defaultEffort ?? "เริ่มต้น"}` }, ...levels.map((l) => ({ value: l, label: l }))], this.choices.effort ?? "", pick("effort"), "chip");
        e.dataset.chip = "effort";
        e.title = "Effort (Cmd+Shift+E)";
        chips.push(e);
      }
    }
    if (this.permissions) {
      const threadMode = this.state.thread && !this.chosen.has("permission") ? threadPermission(this.state.info) : undefined;
      const s = select(d, this.permissions.modes.map((m) => ({ value: m.mode, label: m.label, title: m.description })), threadMode ?? this.choices.permission ?? this.permissions.default, pick("permission"), "chip");
      s.dataset.chip = "permission";
      s.title = "สิทธิ์ (Cmd+Shift+M)";
      chips.push(s);
    }
    if (!this.state.thread) {
      const label = el(d, "label", "chip check");
      const box = el(d, "input");
      box.type = "checkbox";
      box.checked = this.choices.worktree;
      box.addEventListener("change", () => (this.choices.worktree = box.checked));
      label.append(box, el(d, "span", "", "worktree ใหม่"));
      chips.push(label);
    }
    if (this.capabilities.length === 0 || this.capabilities.includes("images")) {
      chips.push(button(d, "+ รูป", () => this.host.pickImages().then((paths) => this.attach(paths), () => {}), "chip"));
    }
    this.chips.replaceChildren(...chips);
  }
}
