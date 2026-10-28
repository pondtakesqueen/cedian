// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { Notice, Request } from "../protocol/wire";
import { mcpAddRequest, SettingsView, splitCommand } from "./settings-view";

function fake() {
  const sent: Request[] = [];
  let listener: (n: Notice) => void = () => {};
  return { sent, wire: { request: (r: Request) => sent.push(r), onAny: (l: (n: Notice) => void) => ((listener = l), () => {}) }, emit: (n: Notice) => listener(n) };
}

describe("settings window", () => {
  it("asks for settings and the MCP list, and writes one key per change", () => {
    const f = fake();
    const view = new SettingsView(document, f.wire, { isGitRepo: async () => true });
    expect(f.sent).toEqual([{ op: "settings" }, { op: "mcp_list" }]);
    f.emit({ kind: "settings", desktop: { theme: "light" }, path: "/h/.cedia/settings.json" });
    const theme = view.root.querySelector("select")!;
    expect(theme.value).toBe("light");
    theme.value = "dark";
    theme.dispatchEvent(new Event("change"));
    expect(f.sent.at(-1)).toEqual({ op: "set_desktop", key: "theme", value: "dark" });
    expect(view.root.textContent).toContain("/h/.cedia/settings.json");
  });

  it("adds a root only when it is a git repository, and never removes the primary", async () => {
    const f = fake();
    const view = new SettingsView(document, f.wire, { primary: "/r/main", isGitRepo: async (p) => p === "/r/lib" });
    view.show("roots");
    const input = view.root.querySelector("input")!;
    input.value = "/r/notes";
    const add = [...view.root.querySelectorAll("button")].find((b) => b.textContent === "เพิ่ม root")!;
    add.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(view.root.textContent).toContain("ไม่ใช่ git repository");
    (view.root.querySelector("input") as HTMLInputElement).value = "/r/lib";
    [...view.root.querySelectorAll("button")].find((b) => b.textContent === "เพิ่ม root")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent.at(-1)).toEqual({ op: "set_desktop", key: "roots", value: { "r-main": ["/r/lib"] } });
    f.emit({ kind: "settings", desktop: { roots: { "r-main": ["/r/lib"] } }, path: "" });
    const items = [...view.root.querySelectorAll("li")].map((li) => li.textContent);
    expect(items[0]).toContain("หลัก");
    expect(items[0]).not.toContain("เอาออก");
    expect(items[1]).toContain("เอาออก");
  });

  it("lists MCP servers with checks", () => {
    const f = fake();
    const view = new SettingsView(document, f.wire, { isGitRepo: async () => true });
    view.show("mcp");
    f.emit({ kind: "mcp", list: { servers: [{ name: "gh", command: "npx", args: ["gh-mcp"], env: ["GH_TOKEN"] }] } });
    [...view.root.querySelectorAll("button")].find((b) => b.textContent === "ตรวจ")!.click();
    expect(f.sent.at(-1)).toEqual({ op: "mcp_check", name: "gh" });
    f.emit({ kind: "mcp_checked", check: { name: "gh", ok: true, tools: [{ name: "a" }, { name: "b" }] as never } });
    expect(view.root.textContent).toContain("ต่อได้ · 2 tools");
    expect(view.root.textContent).toContain("GH_TOKEN");
  });

  it("builds mcp_add from the form", () => {
    expect(splitCommand(`npx -y "my server" a\\ b ''`)).toEqual(["npx", "-y", "my server", "a b", ""]);
    expect(mcpAddRequest("gh", "npx gh-mcp --x", "GH_TOKEN=abc", true)).toEqual({ op: "mcp_add", name: "gh", server: { target: { kind: "command", command: "npx", args: ["gh-mcp", "--x"] }, pairs: [["GH_TOKEN", "abc"]], read_only: true } });
    expect(mcpAddRequest("web", "https://x/mcp", "", false)).toMatchObject({ server: { target: { kind: "url", url: "https://x/mcp" } } });
    expect(mcpAddRequest("bad name", "x", "", false)).toHaveProperty("error");
    expect(mcpAddRequest("a", "x", "nokey", false)).toHaveProperty("error");
  });
});
