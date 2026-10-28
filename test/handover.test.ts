// The window's check of the daemon that answered (vscode/contrib/cedian/common/daemon.ts).
import { describe, expect, it } from "vitest";
import { isOtherBuild } from "../vscode/contrib/cedian/common/daemon";

describe("daemon handover", () => {
  const own = { exe: "/Applications/Cedian.app/Contents/MacOS/cedian-daemon", modified: 2000 };
  it("keeps a daemon of the window's own build", () => {
    expect(isOtherBuild({ ...own }, own)).toBe(false);
  });
  it("replaces one from another binary, one replaced in place since it started, and one too old to say", () => {
    expect(isOtherBuild({ ...own, exe: "/Users/p/cedian/target/release/cedian-daemon" }, own)).toBe(true);
    expect(isOtherBuild({ ...own, modified: 1000 }, own)).toBe(true);
    expect(isOtherBuild(undefined, own)).toBe(true);
  });
});
