import { describe, expect, it } from "vitest";
import { compareVersions, RELEASES_PAGE, updateCheck, updateMessage } from "./updates.js";

describe("update check", () => {
  it("orders versions by their numbers, a pre-release before its release", () => {
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("v0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("0.1", "0.1.1")).toBe(-1);
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0-beta.10", "1.0.0-beta.2")).toBe(1);
    expect(compareVersions("nightly", "0.1.0")).toBeUndefined();
  });

  it("offers a newer release's page, and says when this one is the latest", () => {
    const newer = updateCheck("0.1.0", 200, { tag_name: "v0.2.0", html_url: "https://github.com/pondtakesqueen/cedian/releases/tag/v0.2.0" });
    expect(newer).toEqual({ kind: "newer", version: "0.2.0", url: "https://github.com/pondtakesqueen/cedian/releases/tag/v0.2.0" });
    expect(updateMessage(newer, "0.1.0")).toMatchObject({ message: "Cedian 0.2.0 is available", download: newer.kind === "newer" ? newer.url : "" });
    expect(updateCheck("0.2.0", 200, { tag_name: "v0.2.0" })).toEqual({ kind: "current", version: "0.2.0" });
    expect(updateCheck("0.3.0", 200, { tag_name: "v0.2.0" })).toEqual({ kind: "current", version: "0.3.0" });
    // A page that is not GitHub's is never opened; the releases list stands in.
    expect(updateCheck("0.1.0", 200, { tag_name: "0.2.0", html_url: "https://example.com/x" })).toMatchObject({ url: RELEASES_PAGE });
  });

  it("says when nothing is released yet, and why a check failed", () => {
    expect(updateCheck("0.1.0", 404, { message: "Not Found" })).toEqual({ kind: "none" });
    expect(updateMessage({ kind: "none" }, "0.1.0").message).toBe("No Cedian release yet");
    expect(updateCheck("0.1.0", 403, {})).toMatchObject({ kind: "error" });
    expect(updateCheck("0.1.0", 500, {})).toEqual({ kind: "error", message: "GitHub answered 500" });
    expect(updateCheck("0.1.0", 200, {})).toMatchObject({ kind: "error" });
    expect(updateCheck("0.1.0", 200, { tag_name: "latest" })).toMatchObject({ kind: "error" });
    expect(updateMessage({ kind: "error", message: "offline" }, "0.1.0")).toEqual({ message: "Couldn't check for updates", detail: "offline" });
  });
});
