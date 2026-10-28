import { describe, expect, it } from "vitest";
import { addRoot, desktopOf, paneTypography, projectSlug, removeRoot, rootsOf, vscodeSettings } from "./desktop";

describe("VS Code settings from desktop", () => {
  it("defaults: Warm & Lime over Default Dark Modern, Lilex, Thai line height", () => {
    const s = vscodeSettings({}, true);
    expect(s["workbench.colorTheme"]).toBe("Default Dark Modern");
    expect(s["editor.fontFamily"]).toMatch(/^'Lilex'/);
    expect(s["editor.lineHeight"]).toBeGreaterThanOrEqual(1.6);
    expect(s["files.autoSave"]).toBe("afterDelay");
    expect(Object.keys(s["workbench.colorCustomizations"] as object)).toEqual(["[Default Dark Modern]", "[Default Light Modern]"]);
  });
  it("follows the keys the person set", () => {
    const s = vscodeSettings({ theme: "light", font: { code: "JetBrains Mono" }, code_font_size: 15, editor: { auto_save: false, format_on_save: true } }, true);
    expect(s["workbench.colorTheme"]).toBe("Default Light Modern");
    expect(s["editor.fontSize"]).toBe(15);
    expect(s["files.autoSave"]).toBe("off");
    expect(s["editor.formatOnSave"]).toBe(true);
    expect(vscodeSettings({ theme: "system" }, false)["window.autoDetectColorScheme"]).toBe(true);
    expect(vscodeSettings({ code_font_size: 400 }, true)["editor.fontSize"]).toBe(13);
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
});
