import { describe, expect, it } from "vitest";
import { completionRequest, inlineItem, shouldAsk, withSuggestion } from "./completion.js";

const ok = (text: string) => ({ file: "a.ts", at: { line: 1, column: 1 }, text, model: "faux/a", costUsd: 0, ms: 5 });

describe("tab completion", () => {
  it("asks after a word or at a line's end, not in the middle of one", () => {
    expect(shouldAsk("  return ", 10)).toBe(true);
    expect(shouldAsk("foo(", 5)).toBe(true);
    expect(shouldAsk("foo()", 5)).toBe(true);
    expect(shouldAsk("fooBar", 4)).toBe(false);
    expect(shouldAsk("ไทย", 2)).toBe(false);
  });

  it("asks with the file under the project and the buffer's text, and not for a file outside it", () => {
    expect(completionRequest({ id: "c-1", cwd: "/r", file: "/r/src/a.ts", line: 2, column: 9, text: "x" })).toEqual({ op: "complete", id: "c-1", cwd: "/r", file: "src/a.ts", at: { line: 2, column: 9 }, text: "x" });
    expect(completionRequest({ id: "c-1", cwd: "/r", file: "/elsewhere/a.ts", line: 1, column: 1, text: "" })).toBeUndefined();
  });

  it("offers the line up to the cursor with the answer after it, keeping what follows the cursor", () => {
    expect(inlineItem("  return ", 10, ok("a + b;"))).toEqual({ insertText: "  return a + b;", startColumn: 1, endColumn: 10 });
    expect(inlineItem("add()", 5, ok("a, b"))).toEqual({ insertText: "add(a, b", startColumn: 1, endColumn: 5 });
  });

  it("offers several lines only where the rest of the line is empty", () => {
    expect(inlineItem("if (x) {", 9, ok("\n  y();\n}"))).toEqual({ insertText: "if (x) {\n  y();\n}", startColumn: 1, endColumn: 9 });
    expect(inlineItem("f()", 3, ok("a,\n  b"))).toEqual({ insertText: "f(a,", startColumn: 1, endColumn: 3 });
    expect(inlineItem("f()", 3, ok("\n  b"))).toBeUndefined();
  });

  it("offers nothing for an empty answer or a refusal", () => {
    expect(inlineItem("x", 2, ok(""))).toBeUndefined();
    expect(inlineItem("x", 2, ok("  "))).toBeUndefined();
    expect(inlineItem("x", 2, { error: "no completion" })).toBeUndefined();
  });

  it("with the suggest list open, asks at the end of its pick, and the item goes on from it", () => {
    // `  n = xs.le|` with `length` picked over `le`.
    const at = withSuggestion("  n = xs.le", 12, { startColumn: 10, endColumn: 12, text: "length", isSnippetText: false });
    expect(at).toEqual({ lineText: "  n = xs.length", column: 16, endColumn: 12 });
    // The item replaces the original line up to the pick's end, so it carries the pick and goes on.
    expect(inlineItem(at!.lineText, at!.column, ok(";"))).toMatchObject({ insertText: "  n = xs.length;" });
    // Right after `.`, nothing of the word is typed and the pick is only the list's first item.
    expect(withSuggestion("xs.", 4, { startColumn: 4, endColumn: 4, text: "at", isSnippetText: false })).toBeUndefined();
    expect(withSuggestion("xs.m", 5, { startColumn: 4, endColumn: 5, text: "map(${1})", isSnippetText: true })).toBeUndefined();
  });
});
