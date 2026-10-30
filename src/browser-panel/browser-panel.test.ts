import { describe, expect, test } from "vitest";
import { devServers } from "./launch.js";
import { keyParams, loadError, modifiersOf } from "./session.js";
import { addressOf, allowSite, hostOf, revokeSite, sitesOf, toolsOn } from "./sites.js";

describe("the site allowlist (spec §6.3)", () => {
  const root = "/Users/pond/app";
  const desktop = { browser_sites: { "Users-pond-app": ["docs.example.com"], "Users-pond-other": ["x.com"] } };
  test("localhost and a blank page need no approval; other sites only once added", () => {
    const sites = sitesOf(desktop, root);
    expect(sites).toEqual(["docs.example.com"]);
    expect(toolsOn("about:blank", sites)).toBe(true);
    expect(toolsOn("http://localhost:5173/settings", sites)).toBe(true);
    expect(toolsOn("http://127.0.0.1:3000/", sites)).toBe(true);
    expect(toolsOn("http://app.localhost/", sites)).toBe(true);
    expect(toolsOn("https://docs.example.com/a", sites)).toBe(true);
    expect(toolsOn("https://x.com/", sites)).toBe(false);
    expect(toolsOn("file:///etc/passwd", sites)).toBe(false);
    expect(toolsOn("chrome://settings", sites)).toBe(false);
  });
  test("added and removed per project, keeping the others", () => {
    const added = allowSite(desktop, root, "github.com");
    expect(added).toEqual({ "Users-pond-app": ["docs.example.com", "github.com"], "Users-pond-other": ["x.com"] });
    expect(allowSite({ browser_sites: added }, root, "github.com")).toEqual(added);
    expect(revokeSite({ browser_sites: added }, root, "docs.example.com")).toEqual({ "Users-pond-app": ["github.com"], "Users-pond-other": ["x.com"] });
    expect(allowSite({}, root, "a.com")).toEqual({ "Users-pond-app": ["a.com"] });
  });
  test("hosts are lowercased and unbracketed", () => {
    expect(hostOf("https://Docs.Example.COM/x")).toBe("docs.example.com");
    expect(hostOf("http://[::1]:3000/")).toBe("::1");
    expect(hostOf("about:blank")).toBeUndefined();
  });
});

describe("the address bar", () => {
  test("a bare host opens on http when local and https otherwise; words are no search", () => {
    expect(addressOf("localhost:3000/a")).toEqual({ url: "http://localhost:3000/a" });
    expect(addressOf("127.0.0.1:8080")).toEqual({ url: "http://127.0.0.1:8080/" });
    expect(addressOf("example.com")).toEqual({ url: "https://example.com/" });
    expect(addressOf("https://example.com/x?y=1")).toEqual({ url: "https://example.com/x?y=1" });
    expect(addressOf("how to center a div")).toEqual({ error: "Not a web address: how to center a div" });
    expect(addressOf("javascript:alert(1)")).toEqual({ error: "Not a web address: javascript:alert(1)" });
    expect(addressOf("file:///etc/passwd")).toEqual({ error: "Not a web address: file:///etc/passwd" });
    expect(addressOf("intranet")).toEqual({ error: "Not a web address: intranet" });
    expect(addressOf("  ")).toEqual({ error: "Type a web address" });
  });
});

describe("dev servers (launch.json)", () => {
  test("each configuration with a command, served on localhost at its port or url", () => {
    const text = JSON.stringify({
      version: "0.0.1",
      configurations: [
        { name: "web", runtimeExecutable: "bun", runtimeArgs: ["run", "dev"], port: 5173 },
        { name: "docs", runtimeExecutable: "npm", runtimeArgs: ["run", "docs"], url: "http://localhost:4000/docs", cwd: "site", env: { A: "1", B: 2 } },
        { name: "remote", runtimeExecutable: "x", url: "https://evil.example.com/" },
        { name: "nothing" },
      ],
    });
    expect(devServers(text)).toEqual([
      { name: "web", command: "bun", args: ["run", "dev"], url: "http://localhost:5173/" },
      { name: "docs", command: "npm", args: ["run", "docs"], url: "http://localhost:4000/docs", cwd: "site", env: { A: "1" } },
      { name: "remote", command: "x", args: [] },
    ]);
    expect(devServers("{ not json")).toEqual([]);
  });
});

describe("input and errors", () => {
  const key = (k: Partial<Parameters<typeof keyParams>[1]>) => ({ key: "a", code: "KeyA", keyCode: 65, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...k });
  test("a printable key types its text; Enter types a return; others are raw", () => {
    expect(keyParams("keyDown", key({}))).toMatchObject({ type: "keyDown", text: "a" });
    expect(keyParams("keyDown", key({ key: "Enter", code: "Enter", keyCode: 13 }))).toMatchObject({ type: "keyDown", text: "\r" });
    expect(keyParams("keyDown", key({ key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 }))).toMatchObject({ type: "rawKeyDown" });
    expect(keyParams("keyUp", key({}))).not.toHaveProperty("text");
  });
  test("Cmd+A selects all on macOS, Ctrl+A elsewhere", () => {
    expect(keyParams("keyDown", key({ metaKey: true }), true)).toMatchObject({ type: "rawKeyDown", commands: ["selectAll"], modifiers: 4 });
    expect(keyParams("keyDown", key({ ctrlKey: true }), false)).toMatchObject({ commands: ["selectAll"], modifiers: 2 });
    expect(keyParams("keyDown", key({ ctrlKey: true }), true)).not.toHaveProperty("commands");
    expect(modifiersOf({ altKey: true, ctrlKey: false, metaKey: true, shiftKey: true })).toBe(13);
  });
  test("spec §8: the network and timeouts are notifications; other failures stay in the block", () => {
    expect(loadError("net::ERR_INTERNET_DISCONNECTED")).toEqual({ message: "the network went away", transient: true });
    expect(loadError("net::ERR_CONNECTION_TIMED_OUT")).toEqual({ message: "the connection timed out", transient: true });
    expect(loadError("net::ERR_ABORTED")).toBeUndefined();
    expect(loadError("net::ERR_NAME_NOT_RESOLVED")).toEqual({ message: "This page didn't load (net::ERR_NAME_NOT_RESOLVED)", transient: false });
  });
});
