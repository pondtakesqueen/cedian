// The model picker over the composer, after Synara's (github.com/Emanuele-web04/synara, MIT): one
// chip names the model and its effort; it opens a panel with a search field, the models by
// provider (the first nine on ⌘1 to ⌘9), and the effort levels as a row of buttons at its foot.
// The pane keeps the native selects beside it for the menu keys and the tests; this panel is what
// a person sees and clicks.
import { button, el } from "../dom/el.js";
import type { ModelList } from "../protocol/wire.js";
import { icon } from "./icons.js";

export interface PickerModel {
  /** What the pane's model select takes: "" for cedia's default. */
  value: string;
  label: string;
  group: string;
  disabled: boolean;
  title: string;
}

/** The models by provider, then cedia's modes, as the picker lists them. */
export function pickerModels(models: ModelList): PickerModel[] {
  const count = new Map<string, number>();
  for (const m of models.models) count.set(m.label, (count.get(m.label) ?? 0) + 1);
  return [
    ...models.models.map((m) => ({
      value: m.ref === models.default ? "" : m.ref,
      label: (count.get(m.label) ?? 0) > 1 ? `${m.label} · ${m.provider}` : m.label,
      group: m.provider,
      disabled: !m.available,
      title: m.reason ?? m.ref,
    })),
    ...models.modes.map((m) => ({ value: m.name, label: m.label, group: "Modes", disabled: false, title: m.name })),
  ];
}

/** The rows a query keeps: every word in the label or the provider, any case. */
export function filterModels(rows: PickerModel[], query: string): PickerModel[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => words.every((w) => `${r.label} ${r.group}`.toLowerCase().includes(w)));
}

export interface PickerProps {
  models: PickerModel[];
  /** The model select's value now. */
  model: string;
  /** The effort levels as the effort select offers them, or none when the model takes none. */
  efforts: { value: string; label: string }[];
  effort: string;
  query: string;
  onQuery(query: string): void;
  onModel(value: string): void;
  onEffort(value: string): void;
  onClose(): void;
}

/** The panel, drawn again whole on each change. */
export function modelPicker(doc: Document, p: PickerProps): HTMLElement {
  const panel = el(doc, "div", "model-picker");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Model and effort");
  const search = el(doc, "label", "mp-search");
  const field = el(doc, "input", "");
  field.type = "search";
  field.placeholder = "Search models…";
  field.value = p.query;
  field.setAttribute("aria-label", "Search models");
  search.append(icon(doc, "search"), field);
  const list = el(doc, "div", "mp-list");
  list.setAttribute("role", "listbox");
  const shown = filterModels(p.models, p.query);
  let group = "";
  shown.forEach((m, i) => {
    if (m.group !== group) {
      group = m.group;
      list.append(el(doc, "div", "mp-group", group));
    }
    const row = button(doc, "", () => p.onModel(m.value), `mp-row${m.value === p.model ? " on" : ""}`);
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(m.value === p.model));
    row.disabled = m.disabled;
    row.title = m.title;
    row.append(el(doc, "span", "mp-label", m.label));
    if (i < 9) row.append(el(doc, "span", "mp-key", `⌘${i + 1}`));
    if (m.value === p.model) row.append(icon(doc, "check"));
    list.append(row);
  });
  if (!shown.length) list.append(el(doc, "div", "mp-empty", "No model matches"));
  panel.append(search, list);
  if (p.efforts.length) {
    const foot = el(doc, "div", "mp-effort");
    foot.append(icon(doc, "bolt"), el(doc, "span", "mp-effort-label", "Effort"));
    const levels = el(doc, "div", "mp-levels");
    for (const e of p.efforts) {
      const b = button(doc, e.label, () => p.onEffort(e.value), `mp-level${e.value === p.effort ? " on" : ""}`);
      b.setAttribute("aria-pressed", String(e.value === p.effort));
      levels.append(b);
    }
    foot.append(levels);
    panel.append(foot);
  }
  field.addEventListener("input", () => p.onQuery(field.value));
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      p.onClose();
    } else if (e.key === "Enter" && e.target === field) {
      e.preventDefault();
      const first = shown.find((m) => !m.disabled);
      if (first) p.onModel(first.value);
    } else if (e.metaKey && /^[1-9]$/.test(e.key)) {
      const m = shown[Number(e.key) - 1];
      if (m && !m.disabled) {
        e.preventDefault();
        p.onModel(m.value);
      }
    }
  });
  return panel;
}
