// Find in the open thread (⌘F): every place the text shows in the log, a count, and next and
// previous. The matches are painted with the CSS highlight API, which marks ranges without
// changing the log's nodes, so the log goes on redrawing under it as the thread streams.
import { button, el } from "../dom/el.js";

/** One match: a stretch of one text node. */
export interface Hit {
  node: Text;
  start: number;
  end: number;
}

const BAR = "find";

/** Every match of `query` in `root`'s text, any letter case, in reading order; the bar's own text is left out. */
export function findIn(root: HTMLElement, query: string): Hit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: Hit[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const text = (node.textContent ?? "").toLowerCase();
      for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) hits.push({ node: node as Text, start: at, end: at + needle.length });
      return;
    }
    if (node.nodeType !== 1 || (node as HTMLElement).classList.contains(BAR)) return;
    node.childNodes.forEach(walk);
  };
  walk(root);
  return hits;
}

/** The match after (or before) `at` of `count`, around the ends. */
export const step = (at: number, count: number, delta: 1 | -1): number => (count === 0 ? 0 : (at + delta + count) % count);

/** The names workbench.css paints: every match, and the one the bar is on. */
export const HIGHLIGHT_ALL = "cedian-find";
export const HIGHLIGHT_CURRENT = "cedian-find-current";

type Highlights = { set(name: string, value: unknown): void; delete(name: string): void };

/** The floating bar over the log's top: the query, `2/7`, previous, next, close. */
export class FindBar {
  private bar?: HTMLElement;
  private input?: HTMLInputElement;
  private count?: HTMLElement;
  private hits: Hit[] = [];
  private at = 0;

  constructor(
    private readonly doc: Document,
    private readonly pane: HTMLElement,
    private readonly log: HTMLElement,
    private readonly closed: () => void = () => {},
  ) {}

  get isOpen(): boolean {
    return this.bar !== undefined;
  }

  /** Opens the bar, or goes back to it with its text selected. */
  open(): void {
    if (!this.bar) {
      const d = this.doc;
      this.bar = el(d, "div", BAR);
      this.bar.setAttribute("role", "search");
      this.input = el(d, "input", "query");
      this.input.type = "text";
      this.input.placeholder = "Find in thread";
      this.input.setAttribute("aria-label", "Find in thread");
      this.count = el(d, "span", "count small");
      this.count.setAttribute("aria-live", "polite");
      const prev = button(d, "↑", () => this.move(-1), "btn small");
      prev.setAttribute("aria-label", "Previous match");
      const next = button(d, "↓", () => this.move(1), "btn small");
      next.setAttribute("aria-label", "Next match");
      const close = button(d, "×", () => this.close(), "btn small");
      close.setAttribute("aria-label", "Close find");
      this.bar.append(this.input, this.count, prev, next, close);
      this.input.addEventListener("input", () => this.search(true));
      this.input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          this.move(e.shiftKey ? -1 : 1);
        } else if (e.key === "Escape") {
          e.preventDefault();
          this.close();
        }
      });
      this.pane.append(this.bar);
    }
    this.input!.focus();
    this.input!.select();
  }

  close(): void {
    if (!this.bar) return;
    this.bar.remove();
    this.bar = this.input = this.count = undefined;
    this.hits = [];
    this.paint();
    this.closed();
  }

  /** The log was redrawn: count again, and stay on the match the bar was on. */
  refresh(): void {
    if (this.bar) this.search(false);
  }

  private search(fromStart: boolean): void {
    this.hits = findIn(this.log, this.input!.value);
    this.at = fromStart ? 0 : Math.min(this.at, Math.max(0, this.hits.length - 1));
    this.show(fromStart);
  }

  private move(delta: 1 | -1): void {
    this.at = step(this.at, this.hits.length, delta);
    this.show(true);
  }

  private show(reveal: boolean): void {
    const typed = this.input!.value.trim() !== "";
    this.count!.textContent = this.hits.length ? `${this.at + 1}/${this.hits.length}` : typed ? "No results" : "";
    this.paint();
    const hit = this.hits[this.at];
    if (reveal && hit) hit.node.parentElement?.scrollIntoView?.({ block: "center" });
  }

  /** Paints the matches where the window has the highlight API (Electron does; the tests' DOM does not). */
  private paint(): void {
    const view = this.doc.defaultView as (Window & { CSS?: { highlights?: Highlights }; Highlight?: new (...ranges: Range[]) => unknown }) | null;
    const highlights = view?.CSS?.highlights;
    const Highlight = view?.Highlight;
    if (!highlights || !Highlight) return;
    const range = (h: Hit) => {
      const r = this.doc.createRange();
      r.setStart(h.node, h.start);
      r.setEnd(h.node, h.end);
      return r;
    };
    highlights.delete(HIGHLIGHT_ALL);
    highlights.delete(HIGHLIGHT_CURRENT);
    if (!this.hits.length) return;
    highlights.set(HIGHLIGHT_ALL, new Highlight(...this.hits.map(range)));
    const current = this.hits[this.at];
    if (current) highlights.set(HIGHLIGHT_CURRENT, new Highlight(range(current)));
  }
}
