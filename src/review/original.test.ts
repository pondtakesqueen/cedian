import { describe, expect, it } from "vitest";
import type { FileReview, Hunk } from "../protocol/wire.js";
import { hunkLine, newSpan, originalText, summarize } from "./original.js";

const hunk = (header: string, lines: string[], id = header): Hunk => ({
  header,
  id,
  lines,
  new_start: Number(/\+(\d+)/.exec(header)![1]),
  path: "f.ts",
  state: "pending",
});
const file = (hunks: Hunk[]): FileReview => ({ path: "f.ts", added: 0, removed: 0, binary: false, hunks });

describe("originalText", () => {
  it("undoes each hunk from the bottom up", () => {
    const now = ["a", "B", "c", "d", "e", "F", "G", "h"].join("\n");
    const f = file([
      hunk("@@ -1,3 +1,3 @@", [" a", "-b", "+B", " c"]),
      hunk("@@ -5,3 +5,4 @@", [" e", "-f", "+F", "+G", " h"]),
    ]);
    expect(originalText(now, f)).toEqual({ text: ["a", "b", "c", "d", "e", "f", "h"].join("\n"), stale: [] });
  });

  it("puts back a deleted file's lines and takes out a new file's", () => {
    expect(originalText("", file([hunk("@@ -1,2 +0,0 @@", ["-x", "-y"])])).text).toBe("x\ny\n");
    expect(originalText("x\ny", file([hunk("@@ -0,0 +1,2 @@", ["+x", "+y"])])).text).toBe("");
  });

  it("leaves a hunk the file no longer matches, and names it", () => {
    const f = file([hunk("@@ -1,1 +1,1 @@", ["-old", "+new"], "h1")]);
    expect(originalText("changed since", f)).toEqual({ text: "changed since", stale: ["h1"] });
  });

  it("keeps CRLF files CRLF", () => {
    expect(originalText("A\r\nb", file([hunk("@@ -1 +1 @@", ["-a", "+A"])])).text).toBe("a\r\nb");
  });

  it("reads spans, lines and totals", () => {
    expect(newSpan(hunk("@@ -3 +4 @@", []))).toEqual({ start: 4, length: 1 });
    expect(hunkLine(hunk("@@ -1,2 +0,0 @@", []))).toBe(1);
    const stale = { ...hunk("@@ -1 +1 @@", []), state: "stale" as const };
    expect(summarize([{ ...file([hunk("@@ -1 +1 @@", []), stale]), added: 3, removed: 1 }])).toEqual({ files: 1, added: 3, removed: 1, pending: 1, stale: 1 });
  });
});
