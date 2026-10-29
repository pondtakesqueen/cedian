// Draws the agent pane's items as DOM, with the prototype's class names, into any Document
// (the workbench's, or a test's). Text always goes in as text, never as HTML.
import type { Item } from "./items.js";

export function renderItems(doc: Document, items: Item[]): HTMLElement {
  return new ItemsView(doc).update(items);
}

/**
 * The drawn items of one log, kept between draws: an item drawn the same as last time keeps its
 * element (and a `details` the person opened stays open), so a notice that adds a block costs
 * one element, not the whole thread (10k blocks took 209 ms to draw again on the owner's Mac).
 */
export class ItemsView {
  readonly root: HTMLElement;
  private readonly col: HTMLElement;
  private drawn: { key: string; node: HTMLElement }[] = [];

  constructor(private readonly doc: Document) {
    this.col = el(doc, "div", "col");
    this.root = el(doc, "div", "conv");
    this.root.append(this.col);
  }

  update(items: Item[]): HTMLElement {
    const next = items.map((item, i) => {
      const key = JSON.stringify(item);
      const old = this.drawn[i];
      return old && old.key === key ? old : { key, node: labelled(renderItem(this.doc, item), item) };
    });
    setChildren(this.col, next.map((d) => d.node));
    this.drawn = next;
    return this.root;
  }
}

/** Makes `parent`'s children `nodes`, moving only the ones not already in place. */
export function setChildren(parent: HTMLElement, nodes: Node[]): void {
  nodes.forEach((node, i) => {
    const at = parent.childNodes[i];
    if (at !== node) parent.insertBefore(node, at ?? null);
  });
  while (parent.childNodes.length > nodes.length) parent.lastChild!.remove();
}

function renderItem(doc: Document, item: Item): HTMLElement {
  switch (item.k) {
    case "divider":
      return el(doc, "div", "sdiv", item.text);
    case "user": {
      const bubble = el(doc, "div", "ubub", item.text);
      if (item.images > 0) bubble.append(el(doc, "span", "small", ` · ${item.images} ${item.images === 1 ? "image" : "images"}`));
      return bubble;
    }
    case "think": {
      const label = item.streaming
        ? "Thinking…"
        : item.seconds === null
          ? "Thought"
          : `Thought for ${item.seconds}s`;
      const think = el(doc, "details", "think");
      think.append(el(doc, "summary", "", label), el(doc, "div", "thinkbody", item.text));
      return think;
    }
    case "answer":
      return el(doc, "div", item.streaming ? "ans streaming" : "ans", item.text);
    case "tools": {
      const names = new Map<string, number>();
      for (const call of item.calls) names.set(call.name, (names.get(call.name) ?? 0) + 1);
      const summary = [...names].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ");
      const box = el(doc, "details", item.failure ? "tools fail" : "tools");
      // A failed run of tools opens by itself, as the prototype's does.
      if (item.failure) box.setAttribute("open", "");
      const line = el(doc, "summary", "tline");
      line.append(el(doc, "span", "ell", `${item.calls.length} tools · ${summary}`));
      if (item.running) line.append(el(doc, "span", "dot st-working"));
      const list = el(doc, "div", "tlist");
      for (const call of item.calls) {
        const row = el(doc, "div", call.failed ? "ti bad" : "ti");
        row.append(el(doc, "span", "m", call.name), el(doc, "span", "m ell", call.detail));
        list.append(row);
      }
      if (item.failure) list.append(el(doc, "div", "fail-out m", item.failure));
      box.append(line, list);
      return box;
    }
    case "receipt": {
      const card = el(doc, "div", item.verified ? "receipt" : "receipt unv");
      const head = el(doc, "div", "row");
      head.append(
        item.verified
          ? el(doc, "span", "vbadge", "verified")
          : el(doc, "span", "ubadge", badge(item)),
        el(doc, "span", "verdict", item.verdict),
        el(doc, "span", "small m num", meta(item)),
      );
      const checks = el(doc, "div", "checks");
      for (const check of item.checks) {
        const ok = check.exitCode === 0;
        const row = el(doc, "div", "row");
        row.append(
          el(doc, "span", ok ? "ok" : "bad", ok ? "✓" : "✕"),
          el(doc, "span", "m ell", check.command),
          el(doc, "span", "small", `exit ${check.exitCode}`),
        );
        checks.append(row);
      }
      card.append(head, checks);
      return card;
    }
  }
}

/**
 * What a screen reader announces before an item's own text (spec §9 Accessibility: VoiceOver
 * labels for blocks): who said it, or what it is and how it went. The text itself is read as is.
 */
export function itemLabel(item: Item): string {
  switch (item.k) {
    case "divider":
      return `New session: ${item.text}`;
    case "user":
      return item.images > 0 ? `You, with ${item.images} ${item.images === 1 ? "image" : "images"}` : "You";
    case "think":
      return item.streaming ? "cedia is thinking" : "cedia's thinking";
    case "answer":
      return item.streaming ? "cedia is answering" : "cedia";
    case "tools": {
      const failed = item.calls.filter((c) => c.failed).length;
      const state = item.running ? ", running" : failed ? `, ${failed} failed` : "";
      return `${item.calls.length} tool ${item.calls.length === 1 ? "call" : "calls"}${state}`;
    }
    case "receipt":
      return `Run ended: ${item.verified ? "verified" : badge(item)}`;
  }
}

/** Each item is a labelled group, and one still streaming says it is busy. */
function labelled(node: HTMLElement, item: Item): HTMLElement {
  node.setAttribute("role", "group");
  node.setAttribute("aria-label", itemLabel(item));
  if ("streaming" in item && item.streaming) node.setAttribute("aria-busy", "true");
  return node;
}

/** Why a receipt is not verified: how the run ended, or what its evidence left open. */
function badge(item: Extract<Item, { k: "receipt" }>): string {
  if (item.subtype !== "success") return item.subtype.replace(/^error_/, "").replace(/_/g, " ");
  return item.unverified ? `unverified ${item.unverified}` : "unverified";
}

function meta(item: Extract<Item, { k: "receipt" }>): string {
  const parts = [`${item.turns} turns`];
  if (item.seconds !== null) parts.push(`${item.seconds}s`);
  parts.push(`$${item.costUsd.toFixed(2)}`);
  return parts.join(" · ");
}

function el(doc: Document, tag: string, cls: string, text?: string): HTMLElement {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
