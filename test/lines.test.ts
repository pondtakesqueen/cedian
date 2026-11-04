// The main process's splitting of the daemon socket (vscode/contrib/cedian/common/lines.ts).
import { describe, expect, it } from "vitest";
import { LineSplitter } from "../vscode/contrib/cedian/common/lines";

describe("LineSplitter", () => {
  it("keeps a line cut across reads whole", () => {
    const split = new LineSplitter();
    expect(split.push('{"kind":"caught","thr')).toEqual([]);
    expect(split.push('ead":"t-1"}\n{"kind":')).toEqual(['{"kind":"caught","thread":"t-1"}']);
    expect(split.push('"error","message":"x"}\n\n')).toEqual(['{"kind":"error","message":"x"}']);
    expect(split.end()).toEqual([]);
    split.push("tail");
    expect(split.end()).toEqual(["tail"]);
  });
});
