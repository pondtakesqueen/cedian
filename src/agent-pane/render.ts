// Draws the agent pane's items as DOM, with the prototype's class names, into any Document
// (the workbench's, or a test's). Text always goes in as text, never as HTML.
import type { Item } from "./items";

export function renderItems(doc: Document, items: Item[]): HTMLElement {
  const col = el(doc, "div", "col");
  for (const item of items) col.append(renderItem(doc, item));
  const conv = el(doc, "div", "conv");
  conv.append(col);
  return conv;
}

function renderItem(doc: Document, item: Item): HTMLElement {
  switch (item.k) {
    case "divider":
      return el(doc, "div", "sdiv", item.text);
    case "user": {
      const bubble = el(doc, "div", "ubub", item.text);
      if (item.images > 0) bubble.append(el(doc, "span", "small", ` · ${item.images} รูป`));
      return bubble;
    }
    case "think": {
      const label = item.streaming
        ? "กำลังคิด…"
        : item.seconds === null
          ? "คิด"
          : `คิดอยู่ ${item.seconds} วินาที`;
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
