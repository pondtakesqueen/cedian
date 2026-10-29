// Cedian's settings are the `desktop` key of `~/.cedia/settings.json` (spec §5.1, §5.5): the
// daemon writes it atomically one key at a time (`set_desktop`), and the window derives VS Code's
// settings from it. Those derived settings go in as VS Code's defaults, generated and never
// written by hand (spec §9 State ownership: VS Code settings.json is generated read-only).
import { appearanceOf, BASE_THEME, syntaxRules, workbenchColors } from "../theme/theme.js";

/** The keys Cedian reads; anything else in `desktop` is kept as it is. */
export interface Desktop {
  theme?: "dark" | "light" | "system";
  font?: { ui?: string; code?: string };
  ui_font_size?: number;
  code_font_size?: number;
  density?: "comfortable" | "compact";
  view_mode?: string;
  notifications?: { sound?: boolean };
  keymap?: Record<string, string>;
  roots?: Record<string, string[]>;
  editor?: { auto_save?: boolean; format_on_save?: boolean; tab_completion?: boolean };
  [key: string]: unknown;
}

export const DEFAULT_CODE_FONT = "Lilex";
/** Thai needs room above and below the line (spec §9 Accessibility: line-height ≥ 1.6). */
export const LINE_HEIGHT = 1.6;
const CODE_FALLBACK = "Menlo, Monaco, 'Courier New', monospace";
const UI_FALLBACK = "-apple-system, BlinkMacSystemFont, 'Sukhumvit Set', 'Thonburi', sans-serif";

/** `desktop`, or nothing usable as one, as a Desktop. */
export function desktopOf(value: unknown): Desktop {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Desktop) : {};
}

const size = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;

/** VS Code's settings as `desktop` says them, given whether the system is dark now. */
export function vscodeSettings(desktop: Desktop, systemDark: boolean): Record<string, unknown> {
  const appearance = appearanceOf(desktop.theme, systemDark);
  const base = BASE_THEME[appearance];
  const code = desktop.font?.code?.trim() || DEFAULT_CODE_FONT;
  const codeSize = size(desktop.code_font_size, 8, 40) ?? 13;
  return {
    "workbench.colorTheme": base,
    "window.autoDetectColorScheme": desktop.theme === "system",
    "workbench.preferredDarkColorTheme": BASE_THEME.dark,
    "workbench.preferredLightColorTheme": BASE_THEME.light,
    "workbench.colorCustomizations": {
      [`[${BASE_THEME.dark}]`]: workbenchColors("dark"),
      [`[${BASE_THEME.light}]`]: workbenchColors("light"),
    },
    "editor.tokenColorCustomizations": {
      [`[${BASE_THEME.dark}]`]: { textMateRules: syntaxRules("dark") },
      [`[${BASE_THEME.light}]`]: { textMateRules: syntaxRules("light") },
    },
    "editor.fontFamily": `'${code}', ${CODE_FALLBACK}`,
    "editor.fontSize": codeSize,
    "editor.lineHeight": LINE_HEIGHT,
    "terminal.integrated.fontFamily": `'${code}', ${CODE_FALLBACK}`,
    "terminal.integrated.fontSize": codeSize,
    "terminal.integrated.lineHeight": 1.2,
    "markdown.preview.lineHeight": LINE_HEIGHT,
    "files.autoSave": desktop.editor?.auto_save === false ? "off" : "afterDelay",
    "editor.formatOnSave": desktop.editor?.format_on_save === true,
    // Cedia's ghost text is the only inline suggestion provider; off turns tab completion off.
    "editor.inlineSuggest.enabled": desktop.editor?.tab_completion !== false,
    // While ghost text shows, typing on doesn't open the suggest list over it (VS Code shows ghost
    // text only where it agrees with the list's pick). A list already open still wins.
    "editor.inlineSuggest.suppressSuggestions": desktop.editor?.tab_completion !== false,
    // Thai has no spaces between words (spec §9 Thai text): word moves and selection go by
    // Intl.Segmenter's Thai dictionary, and the files that wrap by default (prose) wrap where the
    // browser's line breaker says, between words, not at any character. Code files keep the
    // faster simple wrapping.
    "editor.wordSegmenterLocales": "th",
    "[markdown]": { "editor.wrappingStrategy": "advanced" },
    "[plaintext]": { "editor.wrappingStrategy": "advanced" },
  };
}

/** The agent pane's own type, as CSS custom properties. */
export function paneTypography(desktop: Desktop): Record<string, string> {
  const ui = desktop.font?.ui?.trim();
  return {
    "--cedian-font-ui": ui ? `'${ui}', ${UI_FALLBACK}` : UI_FALLBACK,
    "--cedian-font-code": `'${desktop.font?.code?.trim() || DEFAULT_CODE_FONT}', ${CODE_FALLBACK}`,
    "--cedian-ui-size": `${size(desktop.ui_font_size, 10, 24) ?? 14}px`,
    "--cedian-code-size": `${size(desktop.code_font_size, 8, 40) ?? 13}px`,
    "--cedian-line-height": String(LINE_HEIGHT),
    "--cedian-gap": desktop.density === "compact" ? "8px" : "12px",
  };
}

/** cedia's project key for a main worktree root (`project_slug` in cedian_index). */
export function projectSlug(root: string): string {
  const text = root.startsWith("/") ? root.slice(1) : root;
  const slug = text.replace(/[^A-Za-z0-9._-]+/g, "-");
  return slug === "" ? "root" : slug;
}

/**
 * A project's roots: the primary (the project's own folder, which keys it) first. `desktop.roots`
 * keeps the primary first in each list too, so the daemon can find a workspace from any of its
 * roots; a list written before that holds only the others.
 */
export function rootsOf(desktop: Desktop, primary: string): string[] {
  const listed = desktop.roots?.[projectSlug(primary)];
  const rest = Array.isArray(listed) ? listed.filter((r): r is string => typeof r === "string" && r !== primary) : [];
  return [primary, ...rest];
}

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);

/**
 * `desktop.roots` with one more root for the project, or why not. The caller says whether the
 * folder is a git repository (the window asks the file system).
 */
export function addRoot(desktop: Desktop, primary: string, path: string, isGitRepo: boolean): { roots: Record<string, string[]> } | { error: string } {
  const root = trimSlash(path.trim());
  if (!root.startsWith("/")) return { error: "Must be a full path, such as /Users/you/repo" };
  if (!isGitRepo) return { error: `${root} is not a git repository` };
  const roots = rootsOf(desktop, primary);
  if (roots.includes(root)) return { error: `${root} is already listed` };
  return { roots: { ...(desktop.roots ?? {}), [projectSlug(primary)]: [...roots, root] } };
}

/** `desktop.roots` without one root; the primary stays (it keys the project). */
export function removeRoot(desktop: Desktop, primary: string, path: string): { roots: Record<string, string[]> } | { error: string } {
  if (path === primary) return { error: "The project's primary root cannot be removed" };
  const rest = rootsOf(desktop, primary).slice(1).filter((r) => r !== path);
  const roots = { ...(desktop.roots ?? {}) };
  if (rest.length) roots[projectSlug(primary)] = [primary, ...rest];
  else delete roots[projectSlug(primary)];
  return { roots };
}
