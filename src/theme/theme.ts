// Warm & Lime in the window (spec §9 Theme): the workbench's colors from the tokens, laid over
// VS Code's own Default Modern theme of the same appearance as `workbench.colorCustomizations`
// (so no theme extension ships), the syntax colors as `editor.tokenColorCustomizations`, and the
// `--cedian-*` CSS custom properties that Cedian's blocks draw with.
import { TOKENS, type Appearance, type Token } from "./tokens.js";

/**
 * The VS Code theme each appearance lays its colors over, by its id in VS Code's theme-defaults
 * (1.143 names them "Dark Modern" and "Light Modern"): `workbench.colorCustomizations` keys must
 * match it exactly, or none of the colors apply.
 */
export const BASE_THEME: Record<Appearance, string> = {
  dark: "Dark Modern",
  light: "Light Modern",
};

const alpha = (color: string, percent: number) => `${color.slice(0, 7)}${Math.round((255 * percent) / 100).toString(16).padStart(2, "0").toUpperCase()}`;

/** VS Code color ids → colors. */
export function workbenchColors(appearance: Appearance): Record<string, string> {
  const t = TOKENS[appearance];
  const clear = "#00000000";
  return {
    focusBorder: t.accent,
    foreground: t.text,
    descriptionForeground: t["text.muted"],
    disabledForeground: t["text.faint"],
    errorForeground: t.failed,
    "icon.foreground": t["text.muted"],
    "selection.background": alpha(t.working, 28),
    "widget.border": t.line,
    "widget.shadow": clear,
    "sash.hoverBorder": t.accent,
    "textLink.foreground": t.working,
    "textLink.activeForeground": t.working,
    "textCodeBlock.background": t.code,
    "titleBar.activeBackground": t.frame,
    "titleBar.inactiveBackground": t.frame,
    "titleBar.activeForeground": t.text,
    "titleBar.inactiveForeground": t["text.muted"],
    "titleBar.border": t.line,
    "activityBar.background": t.frame,
    "activityBar.foreground": t.text,
    "activityBar.inactiveForeground": t["text.faint"],
    "activityBar.border": t.line,
    "activityBar.activeBorder": t.accent,
    "activityBarBadge.background": t.accent,
    "activityBarBadge.foreground": TOKENS.dark.frame,
    "sideBar.background": t.app,
    "sideBar.foreground": t.text,
    "sideBar.border": t.line,
    "sideBarTitle.foreground": t["text.muted"],
    "sideBarSectionHeader.background": t.app,
    "sideBarSectionHeader.border": t.line,
    "panel.background": t.app,
    "panel.border": t.line,
    "panelTitle.activeForeground": t.text,
    "panelTitle.inactiveForeground": t["text.muted"],
    "panelTitle.activeBorder": t.accent,
    "statusBar.background": t.app,
    "statusBar.foreground": t["text.muted"],
    "statusBar.border": t.line,
    "statusBar.noFolderBackground": t.app,
    "statusBar.debuggingBackground": t.warn,
    "statusBarItem.remoteBackground": t.app,
    "statusBarItem.remoteForeground": t["accent.text"],
    "editorGroupHeader.tabsBackground": t.frame,
    "editorGroupHeader.tabsBorder": t.line,
    "editorGroup.border": t.line,
    "tab.activeBackground": t.sheet,
    "tab.inactiveBackground": t.frame,
    "tab.activeForeground": t.text,
    "tab.inactiveForeground": t["text.muted"],
    "tab.border": t.line,
    "tab.activeBorderTop": t.accent,
    "tab.hoverBackground": t.hover,
    "editor.background": t.sheet,
    "editor.foreground": t.text,
    "editorLineNumber.foreground": t["text.faint"],
    "editorLineNumber.activeForeground": t.text,
    "editor.lineHighlightBackground": t.hover,
    "editor.lineHighlightBorder": clear,
    "editor.selectionBackground": alpha(t.working, 28),
    "editor.inactiveSelectionBackground": alpha(t.working, 16),
    "editor.findMatchBackground": alpha(t.warn, 40),
    "editor.findMatchHighlightBackground": alpha(t.working, 30),
    "editorCursor.foreground": t.accent,
    "editorWhitespace.foreground": t["line.strong"],
    "editorIndentGuide.background1": t.line,
    "editorIndentGuide.activeBackground1": t["line.strong"],
    "editorRuler.foreground": alpha(t.text, 5),
    "editorWidget.background": t.raised,
    "editorWidget.border": t.line,
    "editorGutter.addedBackground": t["diff.add"],
    "editorGutter.modifiedBackground": t.warn,
    "editorGutter.deletedBackground": t.failed,
    "diffEditor.insertedTextBackground": alpha(t["diff.add"], 20),
    "diffEditor.removedTextBackground": alpha(t.failed, 20),
    "diffEditor.insertedLineBackground": alpha(t["diff.add"], 10),
    "diffEditor.removedLineBackground": alpha(t.failed, 10),
    "input.background": t.field,
    "input.foreground": t.text,
    "input.border": t.line,
    "input.placeholderForeground": t["text.faint"],
    "inputOption.activeBorder": t.accent,
    "dropdown.background": t.field,
    "dropdown.border": t.line,
    "dropdown.foreground": t.text,
    "button.background": t.accent,
    "button.foreground": TOKENS.dark.frame,
    "button.hoverBackground": alpha(t.accent, 85),
    "button.secondaryBackground": t.raised,
    "button.secondaryForeground": t.text,
    "button.secondaryHoverBackground": t.sel,
    "badge.background": t.raised,
    "badge.foreground": t.text,
    "list.hoverBackground": t.hover,
    "list.activeSelectionBackground": t.sel,
    "list.activeSelectionForeground": t.text,
    "list.inactiveSelectionBackground": t.sel,
    "list.focusOutline": t.accent,
    "list.highlightForeground": t["accent.text"],
    "quickInput.background": t.raised,
    "quickInputList.focusBackground": t.sel,
    "menu.background": t.raised,
    "menu.foreground": t.text,
    "menu.selectionBackground": t.sel,
    "menu.border": t.line,
    "scrollbarSlider.background": alpha(t["text.muted"], 30),
    "scrollbarSlider.hoverBackground": alpha(t["text.muted"], 50),
    "scrollbarSlider.activeBackground": alpha(t["text.muted"], 60),
    "terminal.background": t.code,
    "terminal.foreground": t.text,
    "terminalCursor.foreground": t.accent,
    "terminal.ansiBlack": appearance === "dark" ? t.app : t.text,
    "terminal.ansiRed": t.failed,
    "terminal.ansiGreen": t["diff.add"],
    "terminal.ansiYellow": t.warn,
    "terminal.ansiBlue": t.working,
    "terminal.ansiMagenta": t["ansi.magenta"],
    "terminal.ansiCyan": t["ansi.cyan"],
    "terminal.ansiWhite": appearance === "dark" ? t.text : t["text.faint"],
    "terminal.ansiBrightBlack": t["text.faint"],
    "gitDecoration.addedResourceForeground": t["diff.add"],
    "gitDecoration.modifiedResourceForeground": t.warn,
    "gitDecoration.deletedResourceForeground": t.failed,
    "gitDecoration.untrackedResourceForeground": t["diff.add"],
    "gitDecoration.ignoredResourceForeground": t["text.faint"],
    "notifications.background": t.raised,
    "notifications.border": t.line,
    "editorError.foreground": t.failed,
    "editorWarning.foreground": t.warn,
    "editorInfo.foreground": t.working,
    "progressBar.background": t.accent,
  };
}

/** The syntax colors, as `editor.tokenColorCustomizations.textMateRules`. */
export function syntaxRules(appearance: Appearance): { scope: string[]; settings: { foreground: string; fontStyle?: string } }[] {
  const t = TOKENS[appearance];
  const rule = (foreground: string, ...scope: string[]) => ({ scope, settings: { foreground } });
  return [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: t["text.faint"], fontStyle: "" } },
    rule(t.working, "keyword", "storage", "storage.type", "keyword.control"),
    rule(t["text.muted"], "keyword.operator", "punctuation"),
    rule(t["accent.text"], "string", "markup.inline.raw"),
    rule(t.constant, "constant", "constant.numeric", "constant.language", "string.regexp"),
    rule(t.function, "entity.name.function", "support.function", "meta.function-call"),
    rule(t.type, "entity.name.type", "entity.name.class", "support.type", "support.class"),
    rule(t.tag, "entity.name.tag", "entity.other.attribute-name"),
    rule(t.text, "variable", "variable.parameter", "meta.object-literal.key"),
    rule(t["diff.add"], "markup.inserted"),
    rule(t.failed, "markup.deleted", "invalid"),
    { scope: ["markup.heading", "markup.bold"], settings: { foreground: t.text, fontStyle: "bold" } },
  ];
}

/** `--cedian-<token>` for every token, with `.` as `-`. */
export function cssVars(appearance: Appearance): Record<string, string> {
  const t = TOKENS[appearance];
  return Object.fromEntries((Object.keys(t) as Token[]).map((name) => [`--cedian-${name.replace(/\./g, "-")}`, t[name]]));
}

/** The properties as one CSS rule body, for a style element. */
export function cssText(appearance: Appearance, selector = ":root"): string {
  const vars = Object.entries(cssVars(appearance)).map(([k, v]) => `  ${k}: ${v};`);
  return `${selector} {\n${vars.join("\n")}\n}\n`;
}

/** `desktop.theme`: dark, light, or system (follow the OS, here what the window was told). */
export function appearanceOf(theme: unknown, systemDark: boolean): Appearance {
  if (theme === "light" || theme === "dark") return theme;
  return systemDark ? "dark" : "light";
}
