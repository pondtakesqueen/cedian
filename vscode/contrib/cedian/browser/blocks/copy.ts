// A still copy of a block, to fold away where it stood after the window has taken the block out
// (blockStretch.ts). `cloneNode` copies the DOM but not what the page holds outside it: where each
// list is scrolled to, which option each <select> shows, and what each <canvas> has drawn. Without
// them a side block folding away jumped its agent log to the top, showed its model and permission
// chips at their first option, and drew its terminal blank. The copy carries them over.
//
// Asking every element of a side block where it is scrolled costs ~40 ms on a 9,000-element tree,
// a frame lost at the start of the fold; so the window notes what scrolls as it scrolls
// (`ScrollNotes`), and the copy asks only those.

/** The elements that have scrolled in a document, noted by one capturing listener. */
export class ScrollNotes {
  private readonly scrolled = new Set<Element>();
  private readonly listener = (e: Event) => {
    const target = e.target as Node | null;
    if (target?.nodeType === 1) this.scrolled.add(target as Element);
  };

  constructor(private readonly doc: Document) {
    doc.addEventListener("scroll", this.listener, true);
  }

  /** The elements in `root` (itself too) that have scrolled and are not at their start now. */
  within(root: Element): Element[] {
    const out: Element[] = [];
    for (const node of this.scrolled) {
      if (!node.isConnected) this.scrolled.delete(node);
      else if (root.contains(node) && (node.scrollTop || node.scrollLeft)) out.push(node);
    }
    return out;
  }

  dispose(): void {
    this.doc.removeEventListener("scroll", this.listener, true);
    this.scrolled.clear();
  }
}

/** A copy of a block, and what to put back once it is in the document (a scroll needs a box). */
export interface StillCopy {
  copy: HTMLElement;
  /** Scrolls the copy's lists to where the block's were. Call it once the copy is attached. */
  settle(): void;
}

export function stillCopy(element: HTMLElement, notes?: ScrollNotes): StillCopy {
  const copy = element.cloneNode(true) as HTMLElement;
  // Same tree, same order: the copy's nth <select> or <canvas> is the block's nth.
  const from = element.querySelectorAll("select, canvas");
  const to = copy.querySelectorAll("select, canvas");
  for (let i = 0; i < from.length && i < to.length; i++) {
    const a = from[i];
    // By tag: the block may live in another window than this module's globals.
    if (a.tagName === "SELECT") (to[i] as HTMLSelectElement).selectedIndex = (a as HTMLSelectElement).selectedIndex;
    else paint(a as HTMLCanvasElement, to[i] as HTMLCanvasElement);
  }
  const scrolls = (notes?.within(element) ?? []).flatMap((node) => {
    const at = follow(copy, pathTo(element, node));
    return at ? [{ node: at, top: node.scrollTop, left: node.scrollLeft }] : [];
  });
  return {
    copy,
    settle: () => {
      for (const s of scrolls) {
        s.node.scrollTop = s.top;
        s.node.scrollLeft = s.left;
      }
    },
  };
}

/** The child indices from `root` down to `node`. */
function pathTo(root: Element, node: Element): number[] {
  const path: number[] = [];
  for (let at: Element = node; at !== root && at.parentElement; at = at.parentElement) {
    path.unshift(Array.prototype.indexOf.call(at.parentElement.children, at));
  }
  return path;
}

function follow(root: Element, path: number[]): Element | undefined {
  let at: Element | undefined = root;
  for (const i of path) at = at?.children[i];
  return at;
}

/** What `source` has drawn, onto its copy. A canvas that will not give it up stays blank. */
function paint(source: HTMLCanvasElement, copy: HTMLCanvasElement): void {
  if (!source.width || !source.height) return;
  try {
    copy.width = source.width;
    copy.height = source.height;
    copy.getContext("2d")?.drawImage(source, 0, 0);
  } catch {
    // A canvas another origin drew on, or no 2D context here: it folds blank.
  }
}
