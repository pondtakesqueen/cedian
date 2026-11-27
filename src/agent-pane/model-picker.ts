// The model picker over the composer, after Synara's (github.com/Emanuele-web04/synara, MIT): one
// chip names the model and its effort; it opens a panel with a search field, the models by
// provider (the first nine on ⌘1 to ⌘9), and the effort levels as a row of buttons at its foot.
// The pane keeps the native selects beside it for the menu keys and the tests; this panel is what
// a person sees and clicks.
import { button, el } from "../dom/el.js";
import type { ModelList } from "../protocol/wire.js";
import { icon } from "./icons.js";

/** cedia's effort levels in order, lowest first. */
const LEVELS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

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
  /** The provider tab shown: "" for every provider. */
  tab: string;
  onTab(tab: string): void;
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
  // Synara's top row: a tab for every provider (all of them first), the open one underlined.
  const tabs = el(doc, "div", "mp-tabs");
  tabs.setAttribute("role", "tablist");
  const groups = [...new Set(p.models.map((m) => m.group))];
  for (const [value, label] of [["", "All"], ...groups.map((g) => [g, g] as const)] as const) {
    const t = button(doc, label, () => p.onTab(value), `mp-tab${p.tab === value ? " on" : ""}`);
    t.setAttribute("role", "tab");
    t.setAttribute("aria-selected", String(p.tab === value));
    tabs.append(t);
  }
  const search = el(doc, "label", "mp-search");
  const field = el(doc, "input", "");
  field.type = "search";
  field.placeholder = "Search models…";
  field.value = p.query;
  field.setAttribute("aria-label", "Search models");
  search.append(icon(doc, "search"), field);
  const list = el(doc, "div", "mp-list");
  list.setAttribute("role", "listbox");
  const shown = filterModels(p.tab ? p.models.filter((m) => m.group === p.tab) : p.models, p.query);
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
  panel.append(tabs, search, list);
  if (p.efforts.length) {
    // Synara's effort: the level's name over a track of dots, filled up to a knob that slides to
    // the level picked (the panel moves it in place, so the fill and the knob glide); the
    // model's default ("" value) is the reset at the label's right.
    const def = p.efforts.find((e) => e.value === "");
    const levels = p.efforts.filter((e) => e.value !== "" || LEVELS.includes(e.label)).sort((a, b) => LEVELS.indexOf(a.label) - LEVELS.indexOf(b.label));
    const indexOf = (value: string) => Math.max(0, levels.findIndex((e) => e.value === value));
    const nameOf = (value: string) => {
      const name = value === "" ? def?.label ?? "" : levels[indexOf(value)]?.label ?? "";
      return name ? name[0]!.toUpperCase() + name.slice(1) : "Effort";
    };
    const foot = el(doc, "div", "mp-effort");
    const head = el(doc, "div", "mp-effort-head");
    const label = el(doc, "span", "mp-effort-label", nameOf(p.effort));
    head.append(label);
    const track = el(doc, "div", "mp-track");
    track.setAttribute("role", "radiogroup");
    track.setAttribute("aria-label", "Effort");
    const knob = el(doc, "span", "mp-knob");
    const dots: HTMLButtonElement[] = [];
    let last = p.effort;
    const show = (value: string) => {
      const at = indexOf(value);
      track.style.setProperty("--mp-f", String(levels.length > 1 ? at / (levels.length - 1) : 1));
      label.textContent = nameOf(value);
      dots.forEach((dot, i) => {
        dot.classList.toggle("in", i <= at);
        dot.setAttribute("aria-checked", String(i === at));
      });
    };
    const pick = (value: string) => {
      last = value;
      show(value);
      p.onEffort(value);
    };
    if (def) {
      const reset = button(doc, "", () => pick(""), "mp-reset");
      reset.title = `Back to the model's default (${def.label})`;
      reset.setAttribute("aria-label", reset.title);
      reset.append(icon(doc, "reset"));
      head.append(reset);
    }
    levels.forEach((e) => {
      const dot = button(doc, "", () => pick(e.value), "mp-dot");
      dot.setAttribute("role", "radio");
      dot.setAttribute("aria-label", e.label);
      dot.title = e.label;
      dots.push(dot);
      track.append(dot);
    });
    track.append(knob);
    show(p.effort);
    // Dragging along the track snaps the knob from level to level, as Synara's slider does: the
    // nearest dot to the pointer is picked as it passes, so the fill and the knob glide after it.
    let dragging = false;
    const at = (x: number) => {
      const r = track.getBoundingClientRect();
      const span = r.width - 36;
      const f = span > 0 ? Math.min(1, Math.max(0, (x - r.left - 18) / span)) : 0;
      return levels[Math.round(f * (levels.length - 1))]?.value ?? last;
    };
    const follow = (x: number) => {
      const value = at(x);
      if (value === last) return;
      last = value;
      pick(value);
    };
    track.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      // A press drags the knob; it does not leave a dot with the focus ring.
      e.preventDefault();
      dragging = true;
      track.classList.add("dragging");
      track.setPointerCapture?.(e.pointerId);
      follow(e.clientX);
    });
    track.addEventListener("pointermove", (e) => dragging && follow(e.clientX));
    const stop = () => {
      dragging = false;
      track.classList.remove("dragging");
    };
    track.addEventListener("pointerup", stop);
    track.addEventListener("pointercancel", stop);
    foot.append(head, track);
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
