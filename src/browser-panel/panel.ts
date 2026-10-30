// The Browser block (spec §3.1, §3.3, §6.3): the project's tabs in the daemon's Chromium, drawn
// from its screencast, with the address bar, Dev servers, the element picker, the console and the
// site allowlist. The first block: the layer's drag, zoom, park and float take any `Block`.
// A viewer: the tabs are the daemon's (`Request::Browser`), the page is Chromium's, and the
// allowlist is `desktop.browser_sites`; this holds only what it is drawing.
import type { Block } from "../blocks/block.js";
import { button, el, type Wire } from "../dom/el.js";
import type { BrowserPage, Notice, Request } from "../protocol/wire.js";
import { desktopOf, type Desktop } from "../settings/desktop.js";
import { Cdp, type Socket } from "./cdp.js";
import type { DevServer } from "./launch.js";
import { elementContext, modifiersOf, PageSession, type ConsoleLine, type PageView } from "./session.js";
import { addressOf, allowSite, hostOf, isLocal, revokeSite, sitesOf, TOOLS_OFF, toolsOn } from "./sites.js";

/** What the block needs from the window around it. */
export interface BrowserHost {
  /** The project's folder: the primary root, which keys its tabs and its allowlist. */
  cwd: string;
  /** Cmd is the shortcut key (macOS), else Ctrl. */
  mac: boolean;
  /** A WebSocket to a tab of the daemon's Chromium. */
  connect(url: string): Socket;
  /** A transient failure, as a notification (spec §8.4). */
  notify(message: string): void;
  /** Puts text, and a PNG when given, in the agent pane's composer. */
  attach(text: string, png?: Uint8Array): void;
  /** The project's dev servers (`.cedia/launch.json`, else `.claude/launch.json`). */
  devServers(): Promise<DevServer[]>;
  /** Starts a dev server in a terminal. */
  runDevServer(server: DevServer): void;
  /** Opens Settings at the Browser section, where sites are removed. */
  openSettings?(): void;
}

/** How long a dev server has to answer after it starts before the block stops trying. */
const DEV_SERVER_WAIT_MS = 30_000;
/** The phone width the block can lay a page out at, as the prototype's mobile switch. */
export const PHONE_WIDTH = 390;

const bytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

export class BrowserPanel implements Block {
  readonly kind = "browser";
  readonly root: HTMLElement;
  private readonly tabStrip: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly forward: HTMLButtonElement;
  private readonly reload: HTMLButtonElement;
  private readonly address: HTMLInputElement;
  private readonly dot: HTMLElement;
  private readonly picker: HTMLButtonElement;
  private readonly phone: HTMLButtonElement;
  private readonly servers: HTMLSelectElement;
  private readonly banner: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly screen: HTMLImageElement;
  private readonly overlay: HTMLElement;
  private readonly status: HTMLElement;
  private readonly consoleBox: HTMLElement;
  private readonly consoleHead: HTMLButtonElement;
  private readonly consoleList: HTMLElement;
  private page: BrowserPage | undefined;
  private failure: string | undefined;
  private session: PageSession | undefined;
  private socket = "";
  private desktop: Desktop = {};
  private narrow = false;
  private consoleOpen = false;
  private readonly titles = new Map<string, string>();
  private readonly titleListeners = new Set<(title: string) => void>();
  private readonly offs: (() => void)[] = [];
  private devServerList: DevServer[] = [];
  private waiting: { url: string; until: number } | undefined;
  private disposed = false;

  constructor(private readonly doc: Document, private readonly wire: Wire<Request, Notice>, private readonly host: BrowserHost) {
    const d = doc;
    this.root = el(d, "div", "cedian-browser");
    this.root.setAttribute("role", "group");
    this.root.setAttribute("aria-label", "Browser");
    this.tabStrip = el(d, "div", "tabs");
    this.tabStrip.setAttribute("role", "tablist");
    this.bar = el(d, "div", "bar");
    this.back = button(d, "‹", () => void this.session?.back(), "ibtn");
    this.back.setAttribute("aria-label", "Back");
    this.forward = button(d, "›", () => void this.session?.forward(), "ibtn");
    this.forward.setAttribute("aria-label", "Forward");
    this.reload = button(d, "↻", () => (this.session?.view.load === "loading" ? void this.session.stop() : void this.session?.reload()), "ibtn");
    this.reload.setAttribute("aria-label", "Reload");
    const url = el(d, "label", "url");
    this.dot = el(d, "span", "dot");
    this.address = el(d, "input", "");
    this.address.setAttribute("aria-label", "Address");
    this.address.spellcheck = false;
    this.address.placeholder = "localhost:3000";
    this.address.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.go(this.address.value);
      } else if (e.key === "Escape") {
        this.address.value = this.shownUrl(this.session?.view.url ?? "");
        this.address.blur();
      }
    });
    url.append(this.dot, this.address);
    this.servers = el(d, "select", "sel servers");
    this.servers.setAttribute("aria-label", "Dev servers");
    this.servers.hidden = true;
    this.servers.addEventListener("change", () => {
      const server = this.devServerList[Number(this.servers.value)];
      this.servers.value = "";
      if (server) this.startServer(server);
    });
    this.phone = button(d, "390", () => this.togglePhone(), "ibtn phone");
    this.phone.setAttribute("aria-label", "Lay out at phone width");
    this.phone.setAttribute("aria-pressed", "false");
    this.phone.title = `Lay out at ${PHONE_WIDTH} px, a phone's width`;
    this.picker = button(d, "⌖", () => this.togglePick(), "ibtn pick");
    this.picker.setAttribute("aria-label", "Select an element");
    this.picker.setAttribute("aria-pressed", "false");
    this.picker.title = "Select an element for the agent";
    this.bar.append(this.back, this.forward, this.reload, url, this.servers, this.phone, this.picker);
    this.banner = el(d, "div", "banner");
    this.banner.setAttribute("role", "status");
    this.stage = el(d, "div", "stage");
    this.stage.tabIndex = 0;
    this.stage.setAttribute("aria-label", "Page");
    this.screen = el(d, "img", "screen");
    this.screen.alt = "";
    this.screen.draggable = false;
    this.overlay = el(d, "div", "overlay");
    this.stage.append(this.screen, this.overlay);
    this.status = el(d, "div", "note");
    this.status.setAttribute("role", "status");
    this.consoleBox = el(d, "div", "con");
    this.consoleHead = button(d, "", () => this.toggleConsole(), "ch");
    this.consoleHead.setAttribute("aria-expanded", "false");
    this.consoleList = el(d, "div", "cl");
    this.consoleList.hidden = true;
    this.consoleBox.append(this.consoleHead, this.consoleList);
    this.root.append(this.tabStrip, this.bar, this.banner, this.stage, this.status, this.consoleBox);
    this.input();
    this.offs.push(
      wire.onAny((n) => {
        if (n.kind === "browser" && n.cwd === host.cwd) this.onPage(n.page);
        else if (n.kind === "settings") {
          this.desktop = desktopOf(n.desktop);
          this.drawBanner();
        }
      }),
    );
    this.wire.request({ op: "settings" });
    this.wire.request({ op: "browser", cwd: host.cwd });
    host.devServers().then(
      (list) => this.setDevServers(list),
      () => this.setDevServers([]),
    );
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => this.fit());
      observer.observe(this.stage);
      this.offs.push(() => observer.disconnect());
    }
    this.draw();
  }

  title(): string {
    const title = this.session?.view.title || hostOf(this.session?.view.url ?? "") || "Browser";
    return title;
  }

  onTitle(listener: (title: string) => void): () => void {
    this.titleListeners.add(listener);
    return () => this.titleListeners.delete(listener);
  }

  layout(width: number, height: number): void {
    this.root.style.width = `${width}px`;
    this.root.style.height = `${height}px`;
    this.fit();
  }

  focus(): void {
    if (!this.session?.view.url || this.session.view.url === "about:blank") this.address.focus();
    else this.stage.focus();
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.offs) off();
    this.session?.dispose();
    this.session = undefined;
    this.root.remove();
  }

  /** Opens `text` as typed in the address bar, or says why it can't. */
  go(text: string): void {
    const to = addressOf(text);
    if ("error" in to) {
      this.say(to.error);
      return;
    }
    this.say("");
    this.stage.focus();
    this.session?.navigate(to.url).catch((e: Error) => this.host.notify(e.message));
  }

  /** A new tab, on `url` when given. */
  openTab(url?: string): void {
    this.wire.request({ op: "browser", cwd: this.host.cwd, tab: { action: "open", url: url ?? null } });
  }

  /** The element picker (spec §4.3): the next click on the page picks instead of clicking. */
  togglePick(): void {
    if (!this.session) return;
    if (this.session.view.pick === "inspecting") void this.session.cancelPick();
    else {
      this.session.pick();
      this.stage.focus();
    }
  }

  // ---- the daemon's tabs ----

  private onPage(page: { Ok: BrowserPage } | { Err: string }): void {
    if ("Err" in page) {
      this.page = undefined;
      this.failure = page.Err;
      this.session?.dispose();
      this.session = undefined;
      this.socket = "";
      this.draw();
      return;
    }
    this.failure = undefined;
    this.page = page.Ok;
    if (page.Ok.socket !== this.socket) this.show(page.Ok.socket);
    this.drawTabs();
    this.learnTitles();
  }

  /** Draws the tab at `socket`: a page session on it, screencast at the block's size. */
  private show(socket: string): void {
    this.session?.dispose();
    this.socket = socket;
    const session = new PageSession(new Cdp(this.host.connect(socket)));
    this.session = session;
    this.screen.removeAttribute("src");
    session.onFrame((f) => {
      if (this.session === session) this.screen.src = `data:image/jpeg;base64,${f.data}`;
    });
    session.onChange((view) => {
      if (this.session !== session) return;
      this.onView(view);
    });
    session.onConsole((line) => {
      if (this.session === session) this.drawConsole(line);
    });
    session.onNotice((message) => this.host.notify(message));
    session.onPicked((picked) => {
      this.host.attach(elementContext(picked), picked.image ? bytes(picked.image) : undefined);
      this.say(`<${picked.tag}> added to the composer`);
    });
    session.onClose((beforeLoad) => {
      if (this.session !== session || this.disposed) return;
      // Spec §8.1: the tab went before its page opened, say so; the daemon says which tabs are left.
      if (beforeLoad) this.host.notify("the browser block closed before its page opened");
      this.session = undefined;
      this.socket = "";
      this.wire.request({ op: "browser", cwd: this.host.cwd });
    });
    const { width, height } = this.size();
    session.start(width, height, this.scale()).catch((e: Error) => {
      if (this.session === session) this.host.notify(e.message);
    });
    this.drawConsole(undefined);
    this.draw();
  }

  /** The titles of the tabs not shown, from each tab itself. */
  private learnTitles(): void {
    for (const tab of this.page?.tabs ?? []) {
      if (tab.socket === this.socket) continue;
      const cdp = new Cdp(this.host.connect(tab.socket), 5_000);
      cdp
        .call("Target.getTargetInfo")
        .then((info) => {
          this.titles.set(tab.id, info.targetInfo.title || hostOf(info.targetInfo.url) || "New tab");
          this.drawTabs();
        })
        .catch(() => {})
        .finally(() => cdp.close());
    }
  }

  private onView(view: PageView): void {
    const active = (this.page?.tabs ?? []).find((t) => t.socket === this.socket);
    const title = view.title || hostOf(view.url) || "New tab";
    if (active && this.titles.get(active.id) !== title) {
      this.titles.set(active.id, title);
      this.drawTabs();
    }
    if (this.doc.activeElement !== this.address) this.address.value = this.shownUrl(view.url);
    if (view.load === "error" && this.waiting && /Nothing answers there/.test(view.error ?? "") && Date.now() < this.waiting.until) {
      // A dev server just started: try again until it answers.
      const url = this.waiting.url;
      setTimeout(() => {
        if (this.waiting?.url === url) void this.session?.navigate(url);
      }, 1_000);
    } else if (view.load === "loaded") this.waiting = undefined;
    for (const l of this.titleListeners) l(this.title());
    this.draw();
  }

  // ---- drawing ----

  private draw(): void {
    const view = this.session?.view;
    const d = this.doc;
    this.back.disabled = !view?.canBack;
    this.forward.disabled = !view?.canForward;
    this.reload.textContent = view?.load === "loading" ? "✕" : "↻";
    this.reload.setAttribute("aria-label", view?.load === "loading" ? "Stop" : "Reload");
    this.dot.className = `dot ${view?.load ?? "idle"}`;
    this.picker.setAttribute("aria-pressed", String(view?.pick === "inspecting"));
    this.picker.disabled = !this.session;
    this.stage.classList.toggle("picking", view?.pick === "inspecting");
    this.overlay.replaceChildren();
    if (this.failure) {
      // Spec §8.4 inline: no Chromium, or it did not start.
      const box = el(d, "div", "empty");
      box.append(el(d, "div", "big", "The browser didn't start"), el(d, "div", "small", this.failure), button(d, "Try again", () => this.wire.request({ op: "browser", cwd: this.host.cwd })));
      this.overlay.append(box);
    } else if (!this.page) {
      this.overlay.append(el(d, "div", "empty small", "Starting the browser…"));
    } else if (view?.load === "error") {
      const box = el(d, "div", "empty");
      box.append(el(d, "div", "big", "This page didn't open"), el(d, "div", "small", view.error ?? ""), button(d, "Try again", () => void this.session?.reload()));
      this.overlay.append(box);
    } else if (view && (view.url === "" || view.url === "about:blank") && view.load !== "loading") {
      // Phase B: every block has an empty state that says what it shows and one way to start.
      const box = el(d, "div", "empty");
      box.append(el(d, "div", "big", "Open a page"), el(d, "div", "small", "Type an address above or start a dev server. The agent sees and uses this same page."));
      if (this.devServerList.length) box.append(button(d, `Start ${this.devServerList[0].name}`, () => this.startServer(this.devServerList[0])));
      this.overlay.append(box);
    }
    this.overlay.hidden = this.overlay.childElementCount === 0;
    this.drawBanner();
  }

  private drawTabs(): void {
    const d = this.doc;
    const tabs = this.page?.tabs ?? [];
    this.tabStrip.replaceChildren();
    for (const tab of tabs) {
      const active = tab.socket === this.socket;
      const item = el(d, "div", `tab${active ? " on" : ""}`);
      const title = this.titles.get(tab.id) ?? "New tab";
      const pick = button(d, title, () => this.wire.request({ op: "browser", cwd: this.host.cwd, tab: { action: "select", id: tab.id } }), "tt ell");
      pick.setAttribute("role", "tab");
      pick.setAttribute("aria-selected", String(active));
      pick.title = title;
      const close = button(d, "×", () => this.wire.request({ op: "browser", cwd: this.host.cwd, tab: { action: "close", id: tab.id } }), "tx");
      close.setAttribute("aria-label", `Close ${title}`);
      item.append(pick, close);
      this.tabStrip.append(item);
    }
    const add = button(d, "+", () => this.openTab(), "ibtn add");
    add.setAttribute("aria-label", "New tab");
    this.tabStrip.append(add);
  }

  /** Spec §8.3 and the safety banner (§13): whether the agent may use this page, and the way to change it. */
  private drawBanner(): void {
    const d = this.doc;
    const url = this.session?.view.url ?? "";
    const host = hostOf(url);
    const sites = sitesOf(this.desktop, this.host.cwd);
    this.banner.replaceChildren();
    this.banner.className = "banner";
    if (!host || !this.session) {
      this.banner.hidden = true;
      return;
    }
    this.banner.hidden = false;
    if (!toolsOn(url, sites)) {
      this.banner.classList.add("off");
      this.banner.append(el(d, "span", "ell", `${TOOLS_OFF}: ${host}`), el(d, "span", "fill"));
      this.banner.append(button(d, `Allow ${host}`, () => this.wire.request({ op: "set_desktop", key: "browser_sites", value: allowSite(this.desktop, this.host.cwd, host) }), "btn"));
      return;
    }
    const open = ["localhost", ...sites].join(", ");
    this.banner.append(el(d, "span", "ell small", `The agent can use this page · it may open ${open}`), el(d, "span", "fill"));
    if (!isLocal(host)) this.banner.append(button(d, `Remove ${host}`, () => this.wire.request({ op: "set_desktop", key: "browser_sites", value: revokeSite(this.desktop, this.host.cwd, host) }), "btn flat"));
    if (this.host.openSettings) this.banner.append(button(d, "Edit sites", () => this.host.openSettings?.(), "btn flat"));
  }

  /** A console line added, or the console cleared (none). */
  private drawConsole(line: ConsoleLine | undefined): void {
    if (this.consoleOpen) {
      if (line) this.consoleList.append(this.consoleRow(line));
      else this.fillConsole();
    }
    this.drawConsoleHead();
  }

  private fillConsole(): void {
    const rows = (this.session?.console ?? []).map((l) => this.consoleRow(l));
    this.consoleList.replaceChildren(button(this.doc, "Clear", () => this.session?.clearConsole(), "btn flat clear"), ...rows);
  }

  private drawConsoleHead(): void {
    const lines = this.session?.console ?? [];
    const errors = lines.filter((l) => l.level === "error").length;
    const warnings = lines.filter((l) => l.level === "warn").length;
    const d = this.doc;
    this.consoleHead.replaceChildren(el(d, "span", "name", "Console"));
    if (errors) this.consoleHead.append(el(d, "span", "bad num", `● ${errors}`));
    if (warnings) this.consoleHead.append(el(d, "span", "warn num", `▲ ${warnings}`));
    this.consoleHead.append(el(d, "span", "small ell fill", this.consoleOpen ? "" : "The agent reads this console too"), el(d, "span", "", this.consoleOpen ? "▾" : "▴"));
  }

  private consoleRow(line: ConsoleLine): HTMLElement {
    const d = this.doc;
    const row = el(d, "div", `cr ${line.level}`);
    const text = el(d, "span", "tx m", line.text);
    if (line.source) text.append(el(d, "span", "src", ` ${line.source}`));
    row.append(text);
    if (line.level === "error" || line.level === "warn") {
      row.append(button(d, "Attach", () => this.host.attach(`Console ${line.level} on ${this.session?.view.url ?? ""}:\n${line.text}${line.source ? `\nat ${line.source}` : ""}`), "btn flat"));
    }
    return row;
  }

  private toggleConsole(): void {
    this.consoleOpen = !this.consoleOpen;
    this.consoleHead.setAttribute("aria-expanded", String(this.consoleOpen));
    this.consoleList.hidden = !this.consoleOpen;
    if (this.consoleOpen) this.fillConsole();
    else this.consoleList.replaceChildren();
    this.drawConsoleHead();
    this.fit();
  }

  private say(text: string): void {
    this.status.textContent = text;
    this.status.hidden = text === "";
  }

  private setDevServers(list: DevServer[]): void {
    this.devServerList = list;
    const d = this.doc;
    this.servers.replaceChildren();
    const head = el(d, "option", "", "Dev servers");
    head.value = "";
    this.servers.append(head);
    list.forEach((s, i) => {
      const o = el(d, "option", "", s.url ? `${s.name} · ${s.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : s.name);
      o.value = String(i);
      this.servers.append(o);
    });
    this.servers.value = "";
    this.servers.hidden = list.length === 0;
    this.draw();
  }

  private startServer(server: DevServer): void {
    this.host.runDevServer(server);
    if (!server.url) return;
    this.waiting = { url: server.url, until: Date.now() + DEV_SERVER_WAIT_MS };
    this.say(`Starting ${server.name}…`);
    void this.session?.navigate(server.url);
  }

  private togglePhone(): void {
    this.narrow = !this.narrow;
    this.phone.setAttribute("aria-pressed", String(this.narrow));
    this.stage.classList.toggle("narrow", this.narrow);
    this.fit();
  }

  // ---- size and input ----

  private shownUrl(url: string): string {
    return url === "about:blank" ? "" : url;
  }

  private scale(): number {
    return this.doc.defaultView?.devicePixelRatio ?? 1;
  }

  /** The page's size: the stage, or a phone's width in it. */
  private size(): { width: number; height: number } {
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(this.narrow ? Math.min(PHONE_WIDTH, rect.width || PHONE_WIDTH) : rect.width || 800));
    return { width, height: Math.max(1, Math.round(rect.height || 600)) };
  }

  private fit(): void {
    if (!this.session) return;
    const { width, height } = this.size();
    this.screen.style.width = `${width}px`;
    this.session.resize(width, height, this.scale()).catch(() => {});
  }

  /** Where an event is on the page, in its CSS pixels. */
  private at(e: MouseEvent): { x: number; y: number } {
    const rect = this.screen.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private input(): void {
    const s = this.stage;
    const mouse = (type: "mousePressed" | "mouseReleased" | "mouseMoved") => (e: MouseEvent) => {
      if (!this.session) return;
      if (type === "mousePressed") s.focus();
      e.preventDefault();
      void this.session.mouse({ type, ...this.at(e), button: e.button, buttons: e.buttons, clickCount: type === "mouseMoved" ? 0 : Math.max(1, e.detail), modifiers: modifiersOf(e) }).catch(() => {});
    };
    s.addEventListener("mousedown", mouse("mousePressed"));
    s.addEventListener("mouseup", mouse("mouseReleased"));
    s.addEventListener("mousemove", mouse("mouseMoved"));
    s.addEventListener("contextmenu", (e) => e.preventDefault());
    s.addEventListener(
      "wheel",
      (e) => {
        if (!this.session) return;
        e.preventDefault();
        const { x, y } = this.at(e);
        void this.session.wheel(x, y, e.deltaX, e.deltaY, modifiersOf(e)).catch(() => {});
      },
      { passive: false },
    );
    const key = (type: "keyDown" | "keyUp") => (e: KeyboardEvent) => {
      if (!this.session) return;
      const shortcut = this.host.mac ? e.metaKey : e.ctrlKey;
      // The window's own shortcuts (close, palette, switch) stay the window's; paste comes as a paste.
      if (shortcut && !["a", "c", "x", "z"].includes(e.key.toLowerCase())) return;
      e.preventDefault();
      e.stopPropagation();
      void this.session.key(type, e, this.host.mac).catch(() => {});
    };
    s.addEventListener("keydown", key("keyDown"));
    s.addEventListener("keyup", key("keyUp"));
    s.addEventListener("paste", (e) => {
      const text = e.clipboardData?.getData("text/plain");
      if (!text || !this.session) return;
      e.preventDefault();
      void this.session.insertText(text).catch(() => {});
    });
  }
}
