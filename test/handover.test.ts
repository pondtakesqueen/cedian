// The window's check of the daemon that answered (vscode/contrib/cedian/common/daemon.ts).
import { describe, expect, it } from "vitest";
import { daemonGone, dialStartsDaemon, isOtherBuild } from "../vscode/contrib/cedian/common/daemon";

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
  it("starts the daemon again when the one it started died before serving (a rebuild's killed launch)", () => {
    expect(daemonGone(undefined)).toBe(true);
    expect(daemonGone({ exitCode: null, signalCode: null })).toBe(false);
    expect(daemonGone({ exitCode: null, signalCode: "SIGKILL" })).toBe(true);
    expect(daemonGone({ exitCode: 0, signalCode: null })).toBe(true);
    expect([0, 1, 9, 10, 20].map(dialStartsDaemon)).toEqual([true, false, false, true, true]);
  });
});
