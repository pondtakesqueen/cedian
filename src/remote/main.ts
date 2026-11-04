// Remote control in a browser (spec §6.5): the same agent pane as a desktop window, over the
// daemon's `/ws` socket instead of `daemon.sock`. The daemon serves this page on 127.0.0.1 and
// the owner reaches it from a phone through `tailscale serve`; the page holds nothing the daemon
// cannot send again, so a dropped connection redraws whole once it comes back.
import { AgentPane, type PaneHost } from "../agent-pane/pane.js";
import { DaemonClient, type ConnectionState, type Transport } from "../daemon-client/client.js";
import { ThreadShare } from "../daemon-client/thread-share.js";
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

const REMEMBER = "cedian.remote.cwd";

async function main(): Promise<void> {
  const doc = document;
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  const theme = doc.createElement("style");
  theme.textContent = cssText(dark ? "dark" : "light");
  doc.head.append(theme);
  const config = (await (await fetch("/config.json", { credentials: "same-origin" })).json()) as { projects?: string[] };
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
  if (projects.length > 1) {
    const select = doc.createElement("select");
    select.className = "remote-projects";
    for (const p of projects) select.append(new Option(p.split("/").filter(Boolean).pop() ?? p, p, false, p === cwd));
    select.onchange = () => {
      location.search = `?cwd=${encodeURIComponent(select.value)}`;
    };
    app.append(select);
  }
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
  transport.start();
}

if (typeof document !== "undefined" && document.getElementById("app")) void main();
