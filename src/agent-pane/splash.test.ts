// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { buildNode, readSplash, snapshotNode, splashText, type SplashSnapshot } from "./splash";

function row(doc: Document): HTMLElement {
  const r = doc.createElement("div");
  r.style.cssText = "display:flex;gap:2px";
  for (const [name, on] of [["cedia-code", false], ["<b>cedian</b>", true]] as const) {
    const tab = doc.createElement("button");
    tab.style.cssText = `display:flex;color:${on ? "black" : "gray"}`;
    const label = doc.createElement("span");
    label.textContent = name;
    const close = doc.createElement("span");
    close.style.display = "none";
    close.textContent = "×";
    tab.append(label, close);
    r.append(tab);
  }
  doc.body.replaceChildren(r); // computed styles need a connected element
  return r;
}

describe("splash snapshot of the project tabs", () => {
  it("keeps each visible box with its styles and text, and leaves hidden ones out", () => {
    const doc = document;
    const node = snapshotNode(row(doc), (el) => getComputedStyle(el))!;
    expect(node.children).toHaveLength(2);
    expect(node.children![1].children).toHaveLength(1); // the hidden × is left out
    expect(node.children![1].children![0].text).toBe("<b>cedian</b>");
    expect(node.children![1].style).toContain("color:black");
  });

  it("round-trips through localStorage text and draws text as text, never markup", () => {
    const snap: SplashSnapshot = { background: "rgb(250, 247, 240)", titleBackground: "transparent", top: 0, left: 70, height: 38, row: snapshotNode(row(document), (el) => getComputedStyle(el))! };
    const back = readSplash(splashText(snap))!;
    expect(back).toEqual(snap);
    const drawn = buildNode(document, back.row);
    expect(drawn.querySelector("b")).toBeNull();
    expect(drawn.textContent).toContain("<b>cedian</b>");
  });

  it("refuses what is not a snapshot", () => {
    expect(readSplash(null)).toBeUndefined();
    expect(readSplash("{")).toBeUndefined();
    expect(readSplash(JSON.stringify({ top: 0, left: 0, height: 38, background: "", titleBackground: "", row: { style: 1 } }))).toBeUndefined();
  });
});
