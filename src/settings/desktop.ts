// Cedian's settings are the `desktop` key of `~/.cedia/settings.json` (spec §5.1, §5.5): the
// daemon writes it atomically one key at a time (`set_desktop`), and the window derives VS Code's
// settings from it. Those derived settings go in as VS Code's defaults, generated and never
// written by hand (spec §9 State ownership: VS Code settings.json is generated read-only).
import { appearanceOf, BASE_THEME, syntaxRules, workbenchColors } from "../theme/theme.js";

/** The keys Cedian reads; anything else in `desktop` is kept as it is. */
export interface Desktop {
  theme?: "dark" | "light" | "system";
  /** The Dock icon: light (the default), dark, or the theme showing now. */
  app_icon?: "light" | "dark" | "theme";
  font?: { ui?: string; code?: string };
  ui_font_size?: number;
  code_font_size?: number;
  density?: "comfortable" | "compact";
  view_mode?: string;
  notifications?: { sound?: boolean };
  keymap?: Record<string, string>;
  roots?: Record<string, string[]>;
  /** The project tabs in the title bar, in the person's order (src/agent-pane/project-tabs.ts). */
  projects?: string[];
  editor?: { auto_save?: boolean; format_on_save?: boolean; tab_completion?: boolean };
  /** Creator mode (spec §3.10): cedia's runs get `--creator on`, so the agent may write and install
   * plugins of its own. Off unless the owner turns it on. */
  creator?: { enabled?: boolean };
  [key: string]: unknown;
}

/** The bundled faces (media/fonts, SIL OFL 1.1): Geist for the interface, Geist Mono for code and
 * the terminal. Neither has Thai, so Thai falls through to the system's Thai face after them. */
export const DEFAULT_UI_FONT = "Geist";
export const DEFAULT_CODE_FONT = "Geist Mono";
/** Thai needs room above and below the line (spec §9 Accessibility: line-height ≥ 1.6). */
export const LINE_HEIGHT = 1.6;
const CODE_FALLBACK = "Menlo, Monaco, 'Courier New', 'Sukhumvit Set', 'Thonburi', monospace";
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
  const ui = desktop.font?.ui?.trim() || DEFAULT_UI_FONT;
  const codeSize = size(desktop.code_font_size, 8, 40) ?? 13;
  return {
    "workbench.colorTheme": base,
    // Unset follows the Mac as "system" does. VS Code paints a placeholder theme until the real
    // one loads, dark unless it detects the system's, so both turn detection on; a window on a
    // light Mac with no theme chosen would otherwise open dark and turn light a second later.
    "window.autoDetectColorScheme": desktop.theme !== "light" && desktop.theme !== "dark",
    "workbench.preferredDarkColorTheme": BASE_THEME.dark,
    "workbench.preferredLightColorTheme": BASE_THEME.light,
    // VS Code's Modern UI draws the editor, side bars and panel as rounded cards with gaps, the
    // prototype's blocks; its default comes from an experiment no Cedian build reaches, so say it.
    // Tabs are pills, as in the prototype's block headers. `desktop.density` compact drops the gaps.
    "workbench.experimental.modernUI": true,
    "workbench.experimental.modernUIEditorTabStyle": "pill",
    "window.density.layout": desktop.density === "compact" ? "compact" : "default",
    // The prototype's window has no activity bar: Threads is on the left and the tools are
    // tabs of one panel on the right (src/blocks/places.ts), named, in the panel's one header row
    // as every block's. VS Code puts a part's tabs where its activity bar goes, and only the
    // default place gives the right panel named tabs in its title row ("top" draws an icon row
    // above the title, "hidden" none), so the bar stays at its default place and the window hides
    // the bar itself (windowPlaces.ts).
    "workbench.activityBar.location": "default",
    "workbench.secondarySideBar.showLabels": true,
    // Its title bar names the project and holds Cedian's own controls (+ Tool, the layout
    // picker), not VS Code's command center and side bar toggles.
    "window.title": "${rootName}",
    "window.commandCenter": false,
    "workbench.layoutControl.enabled": false,
    "workbench.colorCustomizations": {
      // Unkeyed, the appearance showing now: VS Code paints a placeholder theme of its own
      // until the base theme loads, and only these reach it (the keyed ones name a theme it
      // isn't), so the first frame has Cedian's activity bar and status bar, not VS Code's.
      ...workbenchColors(appearance),
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
    // Source Control's commit message box: VS Code's "default" is the platform face, not the
    // interface's, so it names the interface's face as the rest of the workbench takes it.
    "scm.inputFontFamily": `'${ui}', ${UI_FALLBACK}`,
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
    // The minimap is as wide as its 40 columns, not a share of a narrow editor's width: VS Code's
    // own grows and shrinks with the editor (about a ninth of it below 120 columns' worth), so it
    // stretched on every frame while a side block opened beside it (blockStretch.ts).
    "editor.minimap.maxColumn": 40,
    "[markdown]": { "editor.wrappingStrategy": "advanced" },
    "[plaintext]": { "editor.wrappingStrategy": "advanced" },
    // The git pane lists each thread's worktree beside the project (they live under
    // .cedian/worktrees, which the folder scan never reaches).
    "git.detectWorktrees": true,
    ...LEAN,
  };
}

/**
 * Defaults that keep the window light on CPU and memory, none of which Cedian's own features
 * need. Each is a VS Code setting the person can still change.
 */
const LEAN: Record<string, unknown> = {
  // One TypeScript server, not a syntax server beside the semantic one: about 80 MB less.
  "typescript.tsserver.useSyntaxServer": "never",
  // No typings installer process fetching @types from npm in the background.
  "typescript.disableAutomaticTypeAcquisition": true,
  // The file watcher and search skip build output and thread worktrees (each a full copy of the
  // project), not only node_modules; VS Code's own entries stay, as an override replaces them.
  "files.watcherExclude": {
    "**/.git/objects/**": true,
    "**/.git/subtree-cache/**": true,
    "**/.hg/store/**": true,
    "**/node_modules/*/**": true,
    "**/target/**": true,
    "**/dist/**": true,
    "**/.next/**": true,
    "**/.cedian/worktrees/**": true,
    "**/.claude/worktrees/**": true,
  },
  "search.exclude": {
    "**/node_modules": true,
    "**/bower_components": true,
    "**/*.code-search": true,
    "**/target": true,
    "**/.cedian/worktrees": true,
    "**/.claude/worktrees": true,
  },
  // ripgrep following symlinks into node_modules is the usual cause of a search pinning a core.
  "search.followSymlinks": false,
  // No scanning every package.json, Gruntfile and Gulpfile for tasks at startup.
  "npm.autoDetect": "off",
  "grunt.autoDetect": "off",
  "gulp.autoDetect": "off",
  "jake.autoDetect": "off",
  "typescript.tsc.autoDetect": "off",
  // The auto-attach watcher on every terminal stays off until asked for.
  "debug.javascript.autoAttachFilter": "disabled",
  // No experiment or recommendation lookups over the network.
  "workbench.enableExperiments": false,
  "extensions.ignoreRecommendations": true,
  // The minimap draws blocks, not glyphs: cheaper on every scroll, and it reads the same at 40 columns.
  "editor.minimap.renderCharacters": false,
};

/** Which app icon `desktop.app_icon` asks for, given the appearance of the theme showing now. */
export function appIconOf(desktop: Desktop, showing: "light" | "dark"): "light" | "dark" {
  if (desktop.app_icon === "dark") return "dark";
  return desktop.app_icon === "theme" ? showing : "light";
}

/** The agent pane's own type, as CSS custom properties. */
export function paneTypography(desktop: Desktop): Record<string, string> {
  const ui = desktop.font?.ui?.trim() || DEFAULT_UI_FONT;
  return {
    "--cedian-font-ui": `'${ui}', ${UI_FALLBACK}`,
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

/** What `removeRoot` needs of a thread: whether it works in the root. */
export interface RootUser {
  title: string;
  archived: boolean;
  root?: string | null;
  cwd?: string | null;
}

/**
 * `desktop.roots` without one root, or why not: the primary stays (it keys the project), and a
 * root a thread still works in stays until that thread is archived (spec §8.4: root in use).
 */
export function removeRoot(desktop: Desktop, primary: string, path: string, threads: RootUser[] = []): { roots: Record<string, string[]> } | { error: string } {
  if (path === primary) return { error: "The project's primary root cannot be removed" };
  const user = threads.find((t) => !t.archived && (t.root === path || t.cwd === path || t.cwd?.startsWith(`${path}/`)));
  if (user) return { error: `A thread is using this root: ${user.title}. Archive it first` };
  const rest = rootsOf(desktop, primary).slice(1).filter((r) => r !== path);
  const roots = { ...(desktop.roots ?? {}) };
  if (rest.length) roots[projectSlug(primary)] = [primary, ...rest];
  else delete roots[projectSlug(primary)];
  return { roots };
}

/** Whether the owner turned creator mode on (spec §3.10); anything but `true` is off. */
export const creatorOn = (desktop: Desktop): boolean => desktop.creator?.enabled === true;
