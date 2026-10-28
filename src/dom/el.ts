// The one way Cedian's views make DOM: an element with classes and text, never HTML.
export function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(doc: Document, label: string, onClick: () => void, cls = "btn"): HTMLButtonElement {
  const b = el(doc, "button", cls, label);
  b.type = "button";
  b.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  return b;
}

export function select<T extends string>(doc: Document, options: { value: T; label: string; disabled?: boolean; title?: string }[], value: T | undefined, onChange: (value: T) => void, cls = "sel"): HTMLSelectElement {
  const s = el(doc, "select", cls);
  for (const o of options) {
    const opt = el(doc, "option", "", o.label);
    opt.value = o.value;
    if (o.disabled) opt.disabled = true;
    if (o.title) opt.title = o.title;
    s.append(opt);
  }
  if (value !== undefined) s.value = value;
  s.addEventListener("change", () => onChange(s.value as T));
  return s;
}

/** The client side views need: send a request, hear every notice. `DaemonClient` is one. */
export interface Wire<Req, Note> {
  request(request: Req): void;
  onAny(listener: (notice: Note) => void): () => void;
}
