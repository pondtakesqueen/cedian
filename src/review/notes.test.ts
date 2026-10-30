import { describe, expect, it } from "vitest";
import type { Notes } from "../protocol/wire.js";
import { addComment, anchorAt, byFile, commentCount, findingCount, goesNext, lineNotes, openFindings, removeComment, resolveComment, stateLabel, walkSteps } from "./notes.js";

const notes = (dismissed: string[] = []): Notes => ({
  comments: [],
  dismissed,
  review: {
    model: "faux/review",
    verdict: "changes",
    summary: "",
    files: ["a.ts", "b.ts"],
    dropped: [],
    costUsd: 0,
    findings: [
      { id: "f1", path: "b.ts", line: 4, text: "b.ts:4 drops the last item" },
      { id: "f2", text: "the tests are gone" },
      { id: "f3", path: "a.ts", line: 9, text: "a.ts:9 never closes" },
      { id: "f4", path: "b.ts", line: 1, text: "b.ts:1 shadows x" },
    ],
  },
});

describe("review notes", () => {
  it("groups findings by file in the order the reviewer named them, loose ones last", () => {
    expect(byFile(notes(["f4"])).map((g) => [g.path, g.rows.map((r) => `${r.finding.id}${r.dismissed ? "-" : ""}`)])).toEqual([
      ["b.ts", ["f1", "f4-"]],
      ["a.ts", ["f3"]],
      [undefined, ["f2"]],
    ]);
    expect(byFile({ comments: [], review: { error: "no snapshots" } })).toEqual([]);
  });

  it("walks the open findings that name a line, and counts what was skipped", () => {
    expect(walkSteps(notes(["f1"])).map((f) => f.id)).toEqual(["f3", "f4"]);
    expect(openFindings(notes(["f1"])).map((f) => f.id)).toEqual(["f2", "f3", "f4"]);
    expect(findingCount(notes(["f1"]))).toBe("4 findings · 1 skipped");
    const clean = notes();
    if (clean.review && "findings" in clean.review) clean.review.findings = [];
    expect(findingCount(clean)).toBe("No findings");
  });

  it("adds a comment with text and removes it by id", () => {
    const one = addComment([], { path: "a.ts", line: 3, quote: "x()", text: " call y " }, "c1");
    expect(one).toEqual([{ id: "c1", path: "a.ts", line: 3, quote: "x()", text: "call y" }]);
    expect(addComment(one, { path: "a.ts", line: 4, text: "  " })).toBe(one);
    expect(removeComment(one, "c1")).toEqual([]);
  });

  it("puts a file's comments and open findings under their lines, comments first", () => {
    const n = { ...notes(["f4"]), comments: [{ id: "c1", path: "b.ts", line: 4, text: "and here" }, { id: "c2", path: "a.ts", line: 1, text: "elsewhere" }] };
    expect(lineNotes(n, "b.ts").map((l) => `${l.kind}:${l.id}@${l.line}`)).toEqual(["comment:c1@4", "finding:f1@4"]);
    expect(lineNotes(n, "src/a.ts").map((l) => l.id)).toEqual(["f3"]);
    expect(lineNotes(n, "b.ts")[0]).toMatchObject({ state: "draft" });
  });

  it("anchors a comment by its line and up to three lines around it, as the daemon does", () => {
    const lines = ["fn main() {", "    let x = 1;", "", "    print(x);", "    done();", "}"];
    expect(anchorAt(lines, 4)).toEqual({ quote: "print(x);", before: ["fn main() {", "let x = 1;", ""], after: ["done();", "}"] });
    expect(anchorAt(lines, 3)).toEqual({ before: ["fn main() {", "let x = 1;"], after: ["print(x);", "done();", "}"] });
    expect(anchorAt(lines, 1).before).toEqual([]);
  });

  it("sends drafts and still-open comments, and counts each state", () => {
    const c = (id: string, state?: "sent" | "open" | "resolved") => ({ id, path: "a.ts", line: 1, text: id, ...(state ? { state } : {}) });
    const comments = [c("d"), c("s", "sent"), c("o", "open"), c("r", "resolved")];
    expect(comments.filter(goesNext).map((x) => x.id)).toEqual(["d", "o"]);
    expect(commentCount(comments)).toBe("2 to send · 1 sent · 1 resolved");
    expect(commentCount([])).toBe("No comments");
    expect(stateLabel(c("o", "open"))).toBe("Still open");
    expect(resolveComment(comments, "o", true)[2].state).toBe("resolved");
    expect(resolveComment(comments, "r", false)[3].state).toBe("open");
  });
});
