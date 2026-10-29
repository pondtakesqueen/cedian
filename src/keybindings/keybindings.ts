// Cedian's keybinding layer (spec §7.2): laid over VS Code's defaults at a weight above every
// built-in and extension rule, so Cedian wins where the two want the same key. `desktop.keymap`
// changes a key by command id. Keys are written as VS Code's keybindings.json writes them.

export interface Binding {
  command: string;
  /** macOS; `cmd` is Ctrl elsewhere. */
  mac: string;
  label: string;
  /** A VS Code when-clause; none: everywhere. */
  when?: string;
}

/** Where the agent pane's text box has focus. */
export const COMPOSER_FOCUS = "cedianComposerFocus";
/** Where the agent pane (any of it) has focus. */
export const PANE_FOCUS = "cedianPaneFocus";

export const KEYBINDINGS: Binding[] = [
  { command: "cedian.projectChat", mac: "cmd+0", label: "Project chat" },
  { command: "cedian.newThread", mac: "cmd+n", label: "New thread" },
  // ⌘K is the inline edit (owner, 2026-10-28), so the thread search takes ⌘T, "go to".
  { command: "cedian.searchThreads", mac: "cmd+t", label: "Search threads" },
  { command: "cedian.closeThread", mac: "cmd+w", label: "Close thread", when: PANE_FOCUS },
  { command: "cedian.nextThread", mac: "ctrl+tab", label: "Next thread", when: PANE_FOCUS },
  { command: "cedian.previousThread", mac: "ctrl+shift+tab", label: "Previous thread", when: PANE_FOCUS },
  { command: "cedian.toggleReview", mac: "cmd+shift+d", label: "Toggle review" },
  { command: "cedian.cycleViewMode", mac: "ctrl+o", label: "Switch view (Answers / + Thinking / All tools)" },
  { command: "cedian.permissionMenu", mac: "cmd+shift+m", label: "Permission menu" },
  { command: "cedian.modelMenu", mac: "cmd+shift+i", label: "Model menu" },
  { command: "cedian.effortMenu", mac: "cmd+shift+e", label: "Effort menu" },
  // Cmd+K: an inline edit where a text editor has focus (owner, 2026-10-28). Elsewhere VS Code's
  // Cmd+K chords keep working, and the command palette stays on Cmd+Shift+P.
  { command: "cedian.inlineEdit", mac: "cmd+k", label: "Edit selection (inline edit)", when: "editorTextFocus && !editorReadonly" },
  { command: "cedian.settings", mac: "cmd+,", label: "Settings" },
  { command: "cedian.stop", mac: "cmd+.", label: "Stop" },
  { command: "cedian.focusComposer", mac: "cmd+l", label: "Focus the composer" },
];

/** The table with the person's keys in place of Cedian's, by command id. */
export function withKeymap(bindings: Binding[], keymap: unknown): Binding[] {
  if (typeof keymap !== "object" || keymap === null) return bindings;
  const map = keymap as Record<string, unknown>;
  return bindings.map((b) => (typeof map[b.command] === "string" && isKey(map[b.command] as string) ? { ...b, mac: map[b.command] as string } : b));
}

const MODIFIERS = new Set(["cmd", "ctrl", "shift", "alt"]);

/** `cmd+shift+e`: modifiers once each, then one key. */
export function isKey(text: string): boolean {
  const parts = text.toLowerCase().split("+");
  const key = parts.pop();
  if (!key || MODIFIERS.has(key)) return false;
  return parts.every((p) => MODIFIERS.has(p)) && new Set(parts).size === parts.length;
}

/** The parts of a key: which modifiers, and the key itself. */
export function parseKey(text: string): { cmd: boolean; ctrl: boolean; shift: boolean; alt: boolean; key: string } | undefined {
  if (!isKey(text)) return undefined;
  const parts = text.toLowerCase().split("+");
  const key = parts.pop()!;
  return { cmd: parts.includes("cmd"), ctrl: parts.includes("ctrl"), shift: parts.includes("shift"), alt: parts.includes("alt"), key };
}
