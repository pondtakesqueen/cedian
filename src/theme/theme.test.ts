import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appearanceOf, cssText, cssVars, syntaxRules, workbenchColors } from "./theme";
import { TOKENS } from "./tokens";

describe("Warm & Lime", () => {
  it("tokens.ts is what script/themes/cedian.py writes", () => {
    const before = readFileSync("src/theme/tokens.ts", "utf8");
    execFileSync("python3", ["-I", "script/themes/cedian.py"]);
    expect(readFileSync("src/theme/tokens.ts", "utf8")).toBe(before);
  });

  it("maps every token appearance to valid colors", () => {
    for (const a of ["dark", "light"] as const) {
      for (const [id, color] of Object.entries(workbenchColors(a))) expect(color, id).toMatch(/^#[0-9A-F]{6}([0-9A-F]{2})?$/i);
      for (const rule of syntaxRules(a)) expect(rule.settings.foreground).toMatch(/^#/);
    }
    expect(workbenchColors("dark").focusBorder).toBe(TOKENS.dark.accent);
    expect(workbenchColors("light")["editor.background"]).toBe(TOKENS.light.code);
    expect(workbenchColors("dark")["tab.activeBorderTop"]).toBe("#00000000");
    expect(workbenchColors("dark")["editor.selectionBackground"]).toBe("#6FB0FF47");
  });

  it("marks the palette's and a menu's row in the accent, the editor header on the app's ground", () => {
    for (const a of ["dark", "light"] as const) {
      const c = workbenchColors(a);
      expect(c["quickInputList.focusBackground"]).toBe(`${TOKENS[a].accent}29`);
      expect(c["menu.selectionBackground"]).toBe(`${TOKENS[a].accent}29`);
      expect(c["editorGroupHeader.tabsBackground"]).toBe(TOKENS[a].app);
    }
  });

  it("keeps text on a filled accent and the bracket pairs at 4.5:1 in both appearances", () => {
    const lum = (hex: string) =>
      [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const a of ["dark", "light"] as const) {
      const c = workbenchColors(a);
      expect(ratio(c["button.foreground"]!, c["button.background"]!), `${a} button`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c["activityBarBadge.foreground"]!, c["activityBarBadge.background"]!), `${a} badge`).toBeGreaterThanOrEqual(4.5);
      for (const n of [1, 2, 3]) expect(ratio(c[`editorBracketHighlight.foreground${n}`]!, TOKENS[a].code), `${a} bracket ${n}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("names a --cedian-* property for every token", () => {
    const vars = cssVars("dark");
    expect(Object.keys(vars)).toHaveLength(Object.keys(TOKENS.dark).length);
    expect(vars["--cedian-accent"]).toBe("#C6F432");
    expect(vars["--cedian-text-muted"]).toBe("#ADA99F");
    expect(cssText("light", ".x")).toContain(".x {\n  --cedian-frame: #F3F3F3;");
  });

  it("follows desktop.theme, else the system", () => {
    expect(appearanceOf("light", true)).toBe("light");
    expect(appearanceOf("system", true)).toBe("dark");
    expect(appearanceOf(undefined, false)).toBe("light");
  });
});
