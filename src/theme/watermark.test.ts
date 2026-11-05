// The empty editor's watermark in workbench.css is Cedian's mark inlined, so it has to be the mark
// script/brand/icon.py writes: a changed mark changes the watermark too.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const css = readFileSync(new URL("vscode/contrib/cedian/browser/media/workbench.css", root), "utf8");
const mark = (name: string) => readFileSync(new URL(`brand/mark/${name}`, root), "utf8").trim();

describe("watermark", () => {
  it("is the mono marks brand/mark holds", () => {
    for (const name of ["cedian-mark-mono-white.svg", "cedian-mark-mono-black.svg"]) {
      expect(css).toContain(`data:image/svg+xml,${encodeURIComponent(mark(name))}`);
    }
  });
});
