// The settings window (spec §7.1): Cedian's own, in place of VS Code's settings UI. Every change
// is one `set_desktop` (the daemon writes the key atomically and answers with the whole
// `desktop`), or a `cedia mcp` request; nothing is kept here that the daemon does not send back.
import { button, el, select, type Wire } from "../dom/el.js";
import type { McpEntry, ModelList, Notice, PermissionList, Request } from "../protocol/wire.js";
import { VIEW_MODES } from "../agent-pane/view-modes.js";
import { KEYBINDINGS } from "../keybindings/keybindings.js";
import { addRoot, desktopOf, removeRoot, rootsOf, type Desktop } from "./desktop.js";

export type Section = "appearance" | "models" | "mcp" | "roots" | "editor" | "keys";

export const SECTIONS: { id: Section; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "models", label: "Models" },
  { id: "mcp", label: "MCP" },
  { id: "roots", label: "Roots" },
  { id: "editor", label: "Editor" },
  { id: "keys", label: "Shortcuts" },
];

export interface SettingsHost {
  /** The window's project folder, the primary root; none with no folder open. */
  primary?: string;
  isGitRepo(path: string): Promise<boolean>;
}

/** `npx x --flag "a b"` → its words, quotes holding spaces, as a shell splits them. */
export function splitCommand(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: string | undefined;
  let any = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = undefined;
      else if (c === "\\" && quote === '"' && i + 1 < line.length) word += line[++i];
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      any = true;
    } else if (c === "\\" && i + 1 < line.length) {
      word += line[++i];
      any = true;
    } else if (/\s/.test(c)) {
      if (word || any) words.push(word);
      word = "";
      any = false;
    } else word += c;
  }
  if (word || any) words.push(word);
  return words;
}

/** The form's fields as a `mcp_add`, or why not. */
export function mcpAddRequest(name: string, target: string, pairs: string, readOnly: boolean): Request | { error: string } {
  const n = name.trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(n)) return { error: "A name may use only A-Z a-z 0-9 . _ -" };
  const t = target.trim();
  if (!t) return { error: "Enter a command or a URL" };
  const kv: [string, string][] = [];
  for (const line of pairs.split(/\n/).map((l) => l.trim()).filter(Boolean)) {
    const at = line.indexOf("=");
    if (at <= 0) return { error: `${line}: must be NAME=value` };
    kv.push([line.slice(0, at), line.slice(at + 1)]);
  }
  if (/^https?:\/\//.test(t)) return { op: "mcp_add", name: n, server: { target: { kind: "url", url: t }, pairs: kv, read_only: readOnly } };
  const [command, ...args] = splitCommand(t);
  if (!command) return { error: "Enter a command or a URL" };
  return { op: "mcp_add", name: n, server: { target: { kind: "command", command, args }, pairs: kv, read_only: readOnly } };
}

export class SettingsView {
  readonly root: HTMLElement;
  private section: Section = "appearance";
  private desktop: Desktop = {};
  private path = "";
  private models?: ModelList;
  private permissions?: PermissionList;
  private mcp: McpEntry[] = [];
  private mcpNote?: string;
  private checks = new Map<string, string>();
  private rootError?: string;
  private readonly body: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly off: () => void;

  constructor(private readonly doc: Document, private readonly wire: Wire<Request, Notice>, private readonly host: SettingsHost) {
    this.root = el(doc, "div", "cedian-settings");
    this.nav = el(doc, "nav", "nav");
    this.nav.setAttribute("role", "tablist");
    this.body = el(doc, "div", "body");
    this.root.append(this.nav, this.body);
    this.off = wire.onAny((n) => this.notice(n));
    wire.request({ op: "settings" });
    wire.request({ op: "mcp_list" });
    this.render();
  }

  show(section: Section): void {
    this.section = section;
    this.render();
  }

  dispose(): void {
    this.off();
  }

  private set(key: string, value: unknown): void {
    this.wire.request({ op: "set_desktop", key, value });
  }

  private notice(n: Notice): void {
    switch (n.kind) {
      case "settings":
        this.desktop = desktopOf(n.desktop);
        this.path = n.path;
        break;
      case "choices":
        if (n.models) this.models = n.models;
        if (n.permissions) this.permissions = n.permissions;
        break;
      case "mcp":
        this.mcp = n.list.servers;
        this.mcpNote = n.refused ?? undefined;
        break;
      // An ask of this window's that failed (an MCP change, a setting it could not write).
      case "error":
        if (!n.settings) return;
        this.mcpNote = n.message;
        break;
      case "mcp_checked": {
        const c = n.check;
        this.checks.set(c.name, "error" in c ? c.error : `Connected · ${c.tools.length} tools`);
        break;
      }
      default:
        return;
    }
    this.render();
  }

  private render(): void {
    const d = this.doc;
    this.nav.replaceChildren(
      ...SECTIONS.map((s) => {
        const b = button(d, s.label, () => this.show(s.id), s.id === this.section ? "tab on" : "tab");
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(s.id === this.section));
        return b;
      }),
    );
    const content = el(d, "div", "section");
    content.setAttribute("role", "tabpanel");
    content.append(el(d, "h2", "", SECTIONS.find((s) => s.id === this.section)!.label));
    switch (this.section) {
      case "appearance": this.appearance(content); break;
      case "models": this.modelsSection(content); break;
      case "mcp": this.mcpSection(content); break;
      case "roots": this.roots(content); break;
      case "editor": this.editor(content); break;
      case "keys": this.keys(content); break;
    }
    if (this.path) content.append(el(d, "div", "small path", `Saved in ${this.path} (desktop key)`));
    this.body.replaceChildren(content);
  }

  private row(parent: HTMLElement, label: string, control: HTMLElement, hint?: string): void {
    const r = el(this.doc, "label", "row");
    const text = el(this.doc, "span", "label", label);
    r.append(text, control);
    if (hint) r.append(el(this.doc, "span", "small", hint));
    parent.append(r);
  }

  private text(value: string | undefined, placeholder: string, commit: (value: string) => void): HTMLInputElement {
    const input = el(this.doc, "input", "input");
    input.value = value ?? "";
    input.placeholder = placeholder;
    input.addEventListener("change", () => commit(input.value.trim()));
    return input;
  }

  private number(value: number | undefined, fallback: number, min: number, max: number, commit: (value: number) => void): HTMLInputElement {
    const input = el(this.doc, "input", "input num");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.value = String(value ?? fallback);
    input.addEventListener("change", () => {
      const n = Number(input.value);
      if (Number.isFinite(n) && n >= min && n <= max) commit(n);
    });
    return input;
  }

  private check(value: boolean, commit: (value: boolean) => void): HTMLInputElement {
    const input = el(this.doc, "input", "check");
    input.type = "checkbox";
    input.checked = value;
    input.addEventListener("change", () => commit(input.checked));
    return input;
  }

  private appearance(p: HTMLElement): void {
    const d = this.doc;
    const desk = this.desktop;
    this.row(p, "Theme", select(d, [{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }], desk.theme ?? "dark", (v) => this.set("theme", v)));
    this.row(p, "UI font", this.text(desk.font?.ui, "System", (v) => this.set("font", { ...(desk.font ?? {}), ui: v || undefined })));
    this.row(p, "Code font", this.text(desk.font?.code, "Lilex", (v) => this.set("font", { ...(desk.font ?? {}), code: v || undefined })));
    this.row(p, "UI size", this.number(desk.ui_font_size, 14, 10, 24, (v) => this.set("ui_font_size", v)));
    this.row(p, "Code size", this.number(desk.code_font_size, 13, 8, 40, (v) => this.set("code_font_size", v)));
    this.row(p, "Density", select(d, [{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }], desk.density ?? "comfortable", (v) => this.set("density", v)));
    this.row(p, "Default view", select(d, VIEW_MODES.map((v) => ({ value: v.mode, label: v.label })), (desk.view_mode as string | undefined) ?? "answers", (v) => this.set("view_mode", v)));
    this.row(p, "Notification sound", this.check(desk.notifications?.sound !== false, (v) => this.set("notifications", { ...(desk.notifications ?? {}), sound: v })));
  }

  private modelsSection(p: HTMLElement): void {
    const d = this.doc;
    if (!this.models) {
      p.append(el(d, "div", "small", "This cedia does not list its models (cedia models)"));
      return;
    }
    const chosen = typeof this.desktop.model === "string" ? this.desktop.model : this.models.default;
    this.row(
      p,
      "Model for new threads",
      select(d, this.models.models.map((m) => ({ value: m.ref, label: m.label, disabled: !m.available, title: m.reason ?? m.ref })), chosen, (v) => this.set("model", v)),
      `cedia default: ${this.models.default}`,
    );
    if (this.permissions) {
      const perm = typeof this.desktop.permission === "string" ? this.desktop.permission : this.permissions.default;
      this.row(p, "Permission for new threads", select(d, this.permissions.modes.map((m) => ({ value: m.mode, label: m.label, title: m.description })), perm, (v) => this.set("permission", v)));
    }
    const list = el(d, "ul", "list");
    for (const m of this.models.models) {
      const li = el(d, "li", m.available ? "item" : "item off");
      li.append(el(d, "span", "", m.label), el(d, "span", "small m", m.ref));
      li.append(el(d, "span", "small", m.available ? `${Math.round(m.contextWindow / 1000)}k` : m.reason ?? "No key"));
      list.append(li);
    }
    p.append(list, el(d, "div", "small", "Each provider's key lives in the environment or in cedia's Keychain; roles are set in ~/.cedia/settings.json"));
  }

  private mcpSection(p: HTMLElement): void {
    const d = this.doc;
    const list = el(d, "ul", "list");
    for (const s of this.mcp) {
      const li = el(d, "li", "item");
      li.append(el(d, "span", "", s.name), el(d, "span", "small m ell", s.url ?? [s.command, ...(s.args ?? [])].filter(Boolean).join(" ")));
      for (const tag of [...(s.env ?? []), ...(s.headers ?? [])]) li.append(el(d, "span", "tag", tag));
      if (s.readOnly) li.append(el(d, "span", "tag", "Read-only"));
      if (s.error) li.append(el(d, "span", "small bad", s.error));
      const status = this.checks.get(s.name);
      if (status) li.append(el(d, "span", "small", status));
      li.append(
        button(d, "Check", () => {
          this.checks.set(s.name, "Checking…");
          this.wire.request({ op: "mcp_check", name: s.name });
          this.render();
        }),
        button(d, "Remove", () => this.wire.request({ op: "mcp_remove", name: s.name }), "btn danger"),
      );
      list.append(li);
    }
    if (this.mcp.length === 0) list.append(el(d, "li", "small", "No MCP servers yet"));
    p.append(list);
    if (this.mcpNote) p.append(el(d, "div", "small bad", this.mcpNote));
    const form = el(d, "form", "form");
    const name = this.text("", "Name", () => {});
    const target = this.text("", "Command or https://…", () => {});
    const pairs = el(d, "textarea", "input");
    pairs.placeholder = "NAME=value (one per line)";
    const ro = el(d, "input", "check");
    ro.type = "checkbox";
    const error = el(d, "div", "small bad");
    form.append(name, target, pairs);
    const roLabel = el(d, "label", "row");
    roLabel.append(ro, el(d, "span", "", "Read-only"));
    form.append(roLabel, button(d, "Add", () => {
      const r = mcpAddRequest(name.value, target.value, pairs.value, ro.checked);
      if ("error" in r) error.textContent = r.error;
      else this.wire.request(r);
    }), error);
    p.append(form);
  }

  private roots(p: HTMLElement): void {
    const d = this.doc;
    const primary = this.host.primary;
    if (!primary) {
      p.append(el(d, "div", "small", "Open the project's folder first"));
      return;
    }
    const list = el(d, "ul", "list");
    rootsOf(this.desktop, primary).forEach((root, i) => {
      const li = el(d, "li", "item");
      li.append(el(d, "span", "m ell", root));
      if (i === 0) li.append(el(d, "span", "tag", "Primary"));
      else li.append(button(d, "Remove", () => {
        const r = removeRoot(this.desktop, primary, root);
        if ("roots" in r) this.set("roots", r.roots);
      }, "btn danger"));
      list.append(li);
    });
    p.append(list);
    const input = this.text("", "/path/to/repo", () => {});
    const error = el(d, "div", "small bad", this.rootError ?? "");
    const add = button(d, "Add root", async () => {
      const path = input.value.trim();
      // A folder that can't be read counts as not a repository, so its error shows below.
      const isRepo = await this.host.isGitRepo(path.replace(/\/+$/, "")).catch(() => false);
      const r = addRoot(this.desktop, primary, path, isRepo);
      this.rootError = "error" in r ? r.error : undefined;
      if ("roots" in r) this.set("roots", r.roots);
      else this.render();
    });
    const row = el(d, "div", "row");
    row.append(input, add);
    p.append(row, error);
  }

  private editor(p: HTMLElement): void {
    const e = this.desktop.editor ?? {};
    this.row(p, "Auto save", this.check(e.auto_save !== false, (v) => this.set("editor", { ...e, auto_save: v })));
    this.row(p, "Format on save", this.check(e.format_on_save === true, (v) => this.set("editor", { ...e, format_on_save: v })));
    this.row(p, "Tab completion", this.check(e.tab_completion !== false, (v) => this.set("editor", { ...e, tab_completion: v })));
    p.append(el(this.doc, "div", "small", "VS Code's settings (fonts, theme, auto save, tab completion) are made from this page; there is no need to edit VS Code's settings.json"));
  }

  private keys(p: HTMLElement): void {
    const d = this.doc;
    const table = el(d, "table", "keys");
    for (const k of KEYBINDINGS) {
      const tr = el(d, "tr");
      tr.append(el(d, "td", "m", this.desktop.keymap?.[k.command] ?? k.mac), el(d, "td", "", k.label));
      table.append(tr);
    }
    p.append(table, el(d, "div", "small", "Change a key in desktop.keymap: { \"<command>\": \"cmd+shift+x\" }; Cedian's keys win over VS Code's"));
  }
}
