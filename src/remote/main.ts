// Remote control in a browser (spec §6.5): the same agent pane as a desktop window, over the
// daemon's `/ws` socket instead of `daemon.sock`. The daemon serves this page on 127.0.0.1 and
// the owner reaches it from a phone through `tailscale serve`; the page holds nothing the daemon
// cannot send again, so a dropped connection redraws whole once it comes back.
import { AgentPane, type PaneHost } from "../agent-pane/pane.js";
import { DaemonClient, type ConnectionState, type Transport } from "../daemon-client/client.js";
import { ThreadShare } from "../daemon-client/thread-share.js";
import { paneTypography } from "../settings/desktop.js";
import { cssText } from "../theme/theme.js";

/** Lines over a WebSocket, reconnecting after a drop: a second, then up to 30 seconds apart. */
export class SocketTransport implements Transport {
  private socket?: WebSocket;
  private line?: (line: string) => void;
  private state?: (state: ConnectionState) => void;
  private delay = 1000;
  private stopped = false;

  constructor(
    private readonly url: string,
    private readonly open: (url: string) => WebSocket = (u) => new WebSocket(u),
    private readonly later: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
  ) {}

  start(): void {
    if (this.stopped) return;
    this.state?.("connecting");
    const socket = this.open(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.delay = 1000;
      this.state?.("connected");
    };
    socket.onmessage = (e) => {
      if (typeof e.data === "string") this.line?.(e.data);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.state?.("disconnected");
      const wait = this.delay;
      this.delay = Math.min(this.delay * 2, 30_000);
      this.later(() => this.start(), wait);
    };
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
  }

  send(line: string): void {
    this.socket?.send(line);
  }

  onLine(listener: (line: string) => void): void {
    this.line = listener;
  }

  onState(listener: (state: ConnectionState) => void): void {
    this.state = listener;
  }
}

/** The socket's address beside the page: wss behind `tailscale serve`'s HTTPS, ws on localhost. */
export function socketUrl(location: { protocol: string; host: string }): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

/**
 * What the pane gets from a browser. The page cannot read the Mac's files or open the
 * workbench's editors, so `@` finds nothing, attaching images is off, and a review says to open
 * the desktop.
 */
export function webHost(cwd: string, win: Pick<Window, "open" | "alert">): PaneHost {
  return {
    cwd,
    files: async () => [],
    pickImages: async () => [],
    openReview: () => win.alert("Reviews open in the desktop app: the diff editor is not in the web view yet."),
    openUrl: (url) => {
      win.open(url, "_blank", "noopener,noreferrer");
    },
  };
}

/** The project to show: `?cwd=`, else the one last shown here, else the first configured. */
export function pickProject(projects: readonly string[], search: string, remembered: string | null): string | undefined {
  const asked = new URLSearchParams(search).get("cwd");
  if (asked) return asked;
  if (remembered && projects.includes(remembered)) return remembered;
  return projects[0];
}

/** Where the page stands on notifications, from what the browser offers and has granted. */
export type PushState = "unsupported" | "home-screen" | "denied" | "off" | "on";

export function pushState(env: {
  push: boolean;
  ios: boolean;
  standalone: boolean;
  permission?: NotificationPermission;
  subscribed: boolean;
}): PushState {
  // iOS gives Web Push only to a page opened from the home screen (16.4 and later).
  if (!env.push) return env.ios && !env.standalone ? "home-screen" : "unsupported";
  if (env.permission === "denied") return "denied";
  return env.subscribed ? "on" : "off";
}

/** What the notifications control shows for each state: a button's label, or a hint. */
export const PUSH_TEXT: Record<PushState, { button?: string; hint?: string }> = {
  unsupported: {},
  "home-screen": { hint: "For notifications on iPhone: Share, then Add to Home Screen, and open Cedian from there." },
  denied: { hint: "Notifications are blocked for this page in the browser's settings." },
  off: { button: "Notify me" },
  on: { button: "Notifications on" },
};

/** A base64url key as the bytes `pushManager.subscribe` takes. */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const text = atob(key.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.length / 4) * 4, "="));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function same(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const x = new Uint8Array(a);
  return x.every((v, i) => v === b[i]);
}

/** Tells the daemon about a subscription, or that it is gone. */
async function tell(path: "/push/subscribe" | "/push/unsubscribe", body: unknown): Promise<void> {
  const reply = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!reply.ok) throw new Error(`${path}: ${reply.status} ${await reply.text()}`);
}

/**
 * The notifications control: registers the service worker, keeps the daemon's copy of this
 * browser's subscription current, and turns notifications on or off on a tap (a browser asks
 * for permission only from a tap).
 */
async function notifications(doc: Document, bar: HTMLElement, hint: HTMLElement, key: string | undefined): Promise<void> {
  const nav = navigator as Navigator & { standalone?: boolean };
  const ios = /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  const standalone = nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;
  const push = !!key && "serviceWorker" in nav && "PushManager" in window && "Notification" in window;
  const registration = push ? await nav.serviceWorker.register("sw.js", { scope: "/" }) : undefined;
  const applicationServerKey = key ? keyBytes(key) : undefined;
  let subscription = (await registration?.pushManager.getSubscription()) ?? null;
  // A subscription made with another key (the daemon's state was reset) cannot be used.
  if (subscription && applicationServerKey && !same(subscription.options.applicationServerKey, applicationServerKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (subscription) await tell("/push/subscribe", subscription.toJSON()).catch(() => {});
  const button = doc.createElement("button");
  button.className = "remote-notify";
  const draw = () => {
    const state = pushState({
      push,
      ios,
      standalone,
      permission: "Notification" in window ? Notification.permission : undefined,
      subscribed: !!subscription,
    });
    const text = PUSH_TEXT[state];
    button.hidden = !text.button;
    button.textContent = text.button ?? "";
    button.setAttribute("aria-pressed", String(state === "on"));
    hint.textContent = text.hint ?? "";
  };
  button.onclick = async () => {
    button.disabled = true;
    try {
      if (subscription) {
        await tell("/push/unsubscribe", { endpoint: subscription.endpoint }).catch(() => {});
        await subscription.unsubscribe();
        subscription = null;
      } else if (registration && applicationServerKey && (await Notification.requestPermission()) === "granted") {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
        await tell("/push/subscribe", subscription.toJSON());
      }
    } catch (error) {
      hint.textContent = `Notifications could not be turned on: ${error instanceof Error ? error.message : String(error)}`;
      button.disabled = false;
      return;
    }
    button.disabled = false;
    draw();
  };
  bar.append(button);
  draw();
}

/** The thread a notification's link names (`?thread=`), opened once the pane is up. */
export function pickThread(search: string): string | undefined {
  return new URLSearchParams(search).get("thread") || undefined;
}

/** The page's tokens: the theme's colors and the pane's type at `desktop`'s defaults (the page has
 * no `desktop` to read), so the agent pane and its code read in Geist and Geist Mono as on the
 * desktop, from the faces remote.css bundles. */
export function pageStyle(dark: boolean): string {
  const type = Object.entries(paneTypography({})).map(([k, v]) => `  ${k}: ${v};`);
  return `${cssText(dark ? "dark" : "light")}:root {\n${type.join("\n")}\n}\n`;
}

const REMEMBER = "cedian.remote.cwd";

async function main(): Promise<void> {
  const doc = document;
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  const theme = doc.createElement("style");
  theme.textContent = pageStyle(dark);
  doc.head.append(theme);
  const config = (await (await fetch("/config.json", { credentials: "same-origin" })).json()) as { projects?: string[]; push_key?: string };
  const projects = config.projects ?? [];
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(REMEMBER);
  } catch {}
  const cwd = pickProject(projects, location.search, remembered);
  const app = doc.getElementById("app");
  if (!app) return;
  if (!cwd) {
    app.textContent = "No project to show. Add your project folders to desktop.remote.projects in ~/.cedia/settings.json.";
    return;
  }
  try {
    localStorage.setItem(REMEMBER, cwd);
  } catch {}
  const bar = doc.createElement("div");
  bar.className = "remote-bar";
  const hint = doc.createElement("div");
  hint.className = "remote-hint";
  app.append(bar, hint);
  if (projects.length > 1) {
    const select = doc.createElement("select");
    select.className = "remote-projects";
    for (const p of projects) select.append(new Option(p.split("/").filter(Boolean).pop() ?? p, p, false, p === cwd));
    select.onchange = () => {
      location.search = `?cwd=${encodeURIComponent(select.value)}`;
    };
    bar.prepend(select);
  }
  void notifications(doc, bar, hint, config.push_key).catch((error) => {
    hint.textContent = `Notifications are not available: ${error instanceof Error ? error.message : String(error)}`;
  });
  const transport = new SocketTransport(socketUrl(location));
  const client = new DaemonClient(transport);
  const status = doc.createElement("div");
  status.className = "remote-status";
  client.onConnection((state) => {
    status.textContent = state === "connected" ? "" : state === "connecting" ? "Connecting to your Mac…" : "Disconnected; trying again…";
  });
  app.append(status);
  const pane = new AgentPane(doc, new ThreadShare(client).view(), webHost(cwd, window));
  app.append(pane.root);
  const thread = pickThread(location.search);
  // The open is kept as a watch, so it reaches the daemon once the socket connects.
  if (thread) pane.openThread(thread);
  transport.start();
}

if (typeof document !== "undefined" && document.getElementById("app")) void main();
