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

  it("names a --cedian-* property for every token", () => {
    const vars = cssVars("dark");
    expect(Object.keys(vars)).toHaveLength(Object.keys(TOKENS.dark).length);
    expect(vars["--cedian-accent"]).toBe("#C6F432");
    expect(vars["--cedian-text-muted"]).toBe("#ADA99F");
    expect(cssText("light", ".x")).toContain(".x {\n  --cedian-frame: #EAEAE6;");
  });

  it("follows desktop.theme, else the system", () => {
    expect(appearanceOf("light", true)).toBe("light");
    expect(appearanceOf("system", true)).toBe("dark");
    expect(appearanceOf(undefined, false)).toBe("light");
  });
});
