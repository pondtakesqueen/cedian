import { describe, expect, it } from "vitest";
import { inlineEditRequest, outcome, proposedText, relativeTo } from "./inline-edit";

const sel = { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 6 };

describe("inline edit", () => {
  it("asks cedia with the buffer and the selection", () => {
    expect(inlineEditRequest({ id: "e1", cwd: "/r", file: "/r/src/a.ts", selection: sel, instruction: " rename ", text: "x\n  foo()\n" })).toEqual({
      op: "inline_edit", id: "e1", cwd: "/r", file: "src/a.ts", range: { start: { line: 2, column: 3 }, end: { line: 2, column: 6 } }, instruction: "rename", text: "x\n  foo()\n",
    });
    expect(inlineEditRequest({ id: "e1", cwd: "/r", file: "/other/a.ts", selection: sel, instruction: "x", text: "" })).toHaveProperty("error");
    expect(inlineEditRequest({ id: "e1", cwd: "/r", file: "/r/a.ts", selection: sel, instruction: " ", text: "" })).toHaveProperty("error");
    expect(relativeTo("/r/", "/r/a")).toBe("a");
    expect(relativeTo("/r", "/rx/a")).toBeUndefined();
  });
  it("puts the replacement in place for the diff", () => {
    expect(proposedText("x\n  foo()\n", sel, "bar")).toBe("x\n  bar()\n");
    expect(proposedText("ab", { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 2 }, "-")).toBe("a-b");
    expect(proposedText("a\nb\nc", { startLineNumber: 1, startColumn: 2, endLineNumber: 3, endColumn: 1 }, "")).toBe("ac");
  });
  it("says why there is no edit", () => {
    expect(outcome({ error: "the selection holds a secret" })).toEqual({ error: "the selection holds a secret" });
    expect(outcome({ file: "a", range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } }, replacement: "", patch: "", model: "m", costUsd: 0 })).toHaveProperty("error");
    expect(outcome({ file: "a", range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } }, replacement: "x", patch: "@@", model: "m", costUsd: 0.01 })).toEqual({ replacement: "x", costUsd: 0.01, model: "m" });
  });
});
