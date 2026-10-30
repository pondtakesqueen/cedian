import { describe, expect, it } from "vitest";
import { addRoot, appIconOf, desktopOf, paneTypography, projectSlug, removeRoot, rootsOf, vscodeSettings } from "./desktop";

describe("VS Code settings from desktop", () => {
  it("defaults: Warm & Lime over Dark Modern, Lilex, Thai line height", () => {
    const s = vscodeSettings({}, true);
    expect(s["workbench.colorTheme"]).toBe("Dark Modern");
    expect(s["editor.fontFamily"]).toMatch(/^'Lilex'/);
    expect(s["editor.lineHeight"]).toBeGreaterThanOrEqual(1.6);
    expect(s["files.autoSave"]).toBe("afterDelay");
    expect(s["editor.inlineSuggest.enabled"]).toBe(true);
    expect(Object.keys(s["workbench.colorCustomizations"] as object)).toEqual(["[Dark Modern]", "[Light Modern]"]);
  });
  it("follows the keys the person set", () => {
    const s = vscodeSettings({ theme: "light", font: { code: "JetBrains Mono" }, code_font_size: 15, editor: { auto_save: false, format_on_save: true } }, true);
    expect(s["workbench.colorTheme"]).toBe("Light Modern");
    expect(s["editor.fontSize"]).toBe(15);
    expect(s["files.autoSave"]).toBe("off");
    expect(s["editor.formatOnSave"]).toBe(true);
    expect(vscodeSettings({ editor: { tab_completion: false } }, true)["editor.inlineSuggest.enabled"]).toBe(false);
    expect(vscodeSettings({}, true)["editor.inlineSuggest.suppressSuggestions"]).toBe(true);
    // Thai: word moves by its dictionary, and prose wraps between words.
    expect(vscodeSettings({}, true)["editor.wordSegmenterLocales"]).toBe("th");
    expect(vscodeSettings({}, true)["git.detectWorktrees"]).toBe(true);
    expect(vscodeSettings({}, true)["[markdown]"]).toEqual({ "editor.wrappingStrategy": "advanced" });
    expect(vscodeSettings({ editor: { tab_completion: false } }, true)["editor.inlineSuggest.suppressSuggestions"]).toBe(false);
    expect(vscodeSettings({ theme: "system" }, false)["window.autoDetectColorScheme"]).toBe(true);
    expect(vscodeSettings({ code_font_size: 400 }, true)["editor.fontSize"]).toBe(13);
  });
  it("picks the app icon: light unless dark, or the theme's when it matches the theme", () => {
    expect(appIconOf({}, "dark")).toBe("light");
    expect(appIconOf({ app_icon: "dark" }, "light")).toBe("dark");
    expect(appIconOf({ app_icon: "theme" }, "dark")).toBe("dark");
    expect(appIconOf({ app_icon: "theme" }, "light")).toBe("light");
    expect(appIconOf({ app_icon: "bogus" as never }, "dark")).toBe("light");
  });
  it("types the pane", () => {
    expect(paneTypography({ ui_font_size: 16, density: "compact" })).toMatchObject({ "--cedian-ui-size": "16px", "--cedian-gap": "8px", "--cedian-line-height": "1.6" });
    expect(desktopOf([1])).toEqual({});
  });
});

describe("roots", () => {
  const primary = "/Users/pond/My Projects/a b";
  it("keys by cedia's slug", () => {
    expect(projectSlug(primary)).toBe("Users-pond-My-Projects-a-b");
    expect(projectSlug("/tmp/งาน/x")).toBe("tmp-x");
    expect(projectSlug("/")).toBe("root");
  });
  it("adds a git repository once and keeps the primary first", () => {
    const added = addRoot({}, primary, "/Users/pond/lib/", true);
    expect(added).toEqual({ roots: { "Users-pond-My-Projects-a-b": [primary, "/Users/pond/lib"] } });
    const desktop = "roots" in added ? { roots: added.roots } : {};
    expect(rootsOf(desktop, primary)).toEqual([primary, "/Users/pond/lib"]);
    expect(addRoot(desktop, primary, "/Users/pond/lib", true)).toHaveProperty("error");
    expect(addRoot(desktop, primary, "/Users/pond/notes", false)).toHaveProperty("error");
    expect(addRoot(desktop, primary, "lib", true)).toHaveProperty("error");
    expect(addRoot(desktop, primary, primary, true)).toHaveProperty("error");
  });
  it("never removes the primary", () => {
    const desktop = { roots: { "Users-pond-My-Projects-a-b": ["/x"], other: ["/y"] } };
    expect(removeRoot(desktop, primary, primary)).toHaveProperty("error");
    expect(removeRoot(desktop, primary, "/x")).toEqual({ roots: { other: ["/y"] } });
    expect(removeRoot({ roots: { "Users-pond-My-Projects-a-b": [primary, "/x", "/z"] } }, primary, "/x")).toEqual({ roots: { "Users-pond-My-Projects-a-b": [primary, "/z"] } });
  });
  it("keeps a root a thread still works in", () => {
    const desktop = { roots: { "Users-pond-My-Projects-a-b": [primary, "/x"] } };
    expect(removeRoot(desktop, primary, "/x", [{ title: "Tidy", archived: false, root: "/x" }])).toEqual({ error: "A thread is using this root: Tidy. Archive it first" });
    expect(removeRoot(desktop, primary, "/x", [{ title: "Tidy", archived: false, cwd: "/x/.cedian/worktrees/tidy" }])).toHaveProperty("error");
    // Archived, or in a folder that only starts the same: the root goes.
    expect(removeRoot(desktop, primary, "/x", [{ title: "Tidy", archived: true, root: "/x" }, { title: "Other", archived: false, cwd: "/xy" }])).toEqual({ roots: {} });
  });
});
