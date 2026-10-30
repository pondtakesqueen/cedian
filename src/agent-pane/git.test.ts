import { describe, expect, it } from "vitest";
import { branchLine, gitActions, pendingLine } from "./git";

const state = { branch: "fix-login", base: "origin/main", ahead: 2, behind: 1, upstream: null, unpushed: 2, changed: 1 };

describe("git pane", () => {
  it("says where the branch stands against its base and upstream", () => {
    expect(branchLine(state)).toBe("fix-login → origin/main · ahead 2 · behind 1");
    expect(branchLine({ ...state, ahead: 0, behind: 0 })).toBe("fix-login → origin/main · up to date");
    expect(branchLine({ ...state, base: null })).toBe("fix-login");
    expect(branchLine({ ...state, branch: null })).toBe("detached HEAD → origin/main · ahead 2 · behind 1");
    expect(pendingLine(state)).toBe("1 uncommitted file · 2 not pushed");
    expect(pendingLine({ ...state, changed: 0, unpushed: 0 })).toBe("");
  });

  it("offers Pull when the base moved and Push when the branch has commits to send", () => {
    expect(gitActions(state)).toEqual(["pull", "push"]);
    expect(gitActions({ ...state, behind: 0 })).toEqual(["push"]);
    expect(gitActions({ ...state, behind: 0, upstream: "origin/fix-login", unpushed: 0 })).toEqual(["pull"]);
    // On the base itself there is nothing to push to a PR from.
    expect(gitActions({ ...state, branch: "main", base: null, behind: 0, ahead: 0, unpushed: 0 })).toEqual([]);
  });
});
