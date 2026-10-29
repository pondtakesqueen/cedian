import { describe, expect, it } from "vitest";
import { cediaProblem } from "./welcome.js";

const ok = (protocol: string) => ({ Ok: { name: "cedia" as const, version: "1", protocol, capabilities: [] } });

describe("the daemon's welcome", () => {
  it("is fine when cedia speaks the protocol the daemon was built on, or the daemon doesn't say", () => {
    expect(cediaProblem({ kind: "welcome", daemon: "0.1", cedia: ok("a294"), protocol: "a294" })).toBeUndefined();
    expect(cediaProblem({ kind: "welcome", daemon: "0.1", cedia: ok("a294") })).toBeUndefined();
  });

  it("names a protocol mismatch in the spec's words, and a cedia that can't be asked", () => {
    expect(cediaProblem({ kind: "welcome", daemon: "0.1", cedia: ok("b000"), protocol: "a294" })?.message).toBe("cedia speaks protocol b000, cedian was built on a294");
    expect(cediaProblem({ kind: "welcome", daemon: "0.1", cedia: { Err: "no cedia on PATH" } })?.detail).toContain("no cedia on PATH");
  });
});
