import { describe, expect, it } from "vitest";
import { isKey, KEYBINDINGS, parseKey, withKeymap } from "./keybindings";

describe("keybinding layer", () => {
  it("names each command once, except Cmd+K split by focus", () => {
    const ids = KEYBINDINGS.map((b) => b.command);
    expect(new Set(ids).size).toBe(ids.length);
    const cmdK = KEYBINDINGS.filter((b) => b.mac === "cmd+k");
    expect(cmdK.map((b) => b.when)).toEqual(["editorTextFocus && !editorReadonly", "!editorTextFocus || editorReadonly"]);
    for (const b of KEYBINDINGS) expect(isKey(b.mac), b.mac).toBe(true);
  });
  it("takes the person's keys by command id, ignoring nonsense", () => {
    const t = withKeymap(KEYBINDINGS, { "cedian.stop": "cmd+shift+.", "cedian.newThread": "shift+shift", other: "cmd+x" });
    expect(t.find((b) => b.command === "cedian.stop")?.mac).toBe("cmd+shift+.");
    expect(t.find((b) => b.command === "cedian.newThread")?.mac).toBe("cmd+n");
    expect(withKeymap(KEYBINDINGS, null)).toBe(KEYBINDINGS);
  });
  it("parses", () => {
    expect(parseKey("ctrl+shift+tab")).toEqual({ cmd: false, ctrl: true, shift: true, alt: false, key: "tab" });
    expect(parseKey("cmd")).toBeUndefined();
  });
});
