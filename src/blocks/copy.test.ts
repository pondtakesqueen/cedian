// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ScrollNotes, stillCopy } from "./copy.js";

describe("stillCopy", () => {
  it("keeps each <select>'s option and puts each scrolled list back where it was", () => {
    document.body.innerHTML = `<div id="b"><div><div class="log" style="height:50px;overflow:auto"><div style="height:500px"></div></div></div><select><option>Opus</option><option>Sonnet</option></select></div>`;
    const notes = new ScrollNotes(document);
    const block = document.getElementById("b")!;
    block.querySelector("select")!.selectedIndex = 1;
    const log = block.querySelector(".log") as HTMLElement;
    log.scrollTop = 120;
    log.dispatchEvent(new Event("scroll"));
    const { copy, settle } = stillCopy(block, notes);
    expect(copy.querySelector("select")!.selectedIndex).toBe(1);
    document.body.append(copy);
    settle();
    expect((copy.querySelector(".log") as HTMLElement).scrollTop).toBe(120);
    notes.dispose();
  });

  it("forgets what scrolled once it leaves the document", () => {
    document.body.innerHTML = `<div id="b"><div class="log"></div></div>`;
    const notes = new ScrollNotes(document);
    const log = document.querySelector(".log") as HTMLElement;
    log.scrollTop = 10;
    log.dispatchEvent(new Event("scroll"));
    expect(notes.within(document.body)).toEqual([log]);
    log.remove();
    expect(notes.within(document.body)).toEqual([]);
    notes.dispose();
  });
});
