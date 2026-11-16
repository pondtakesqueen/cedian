// The project tabs in the window's splash (vscode/patches/0020-cedian-splash.patch). A project tab
// switch loads the window again, and before the workbench is drawn VS Code paints a splash from
// what the last window stored: the parts' outlines in VS Code's colours and an empty title bar. So
// the tabs vanished for half a second and the frame flickered between VS Code's colours and
// Cedian's. The last window now leaves a snapshot of its title bar (the tabs row, as plain styled
// boxes and text, never markup) in localStorage, and the splash draws that instead of the parts.

/** One box of the snapshot: an element's own text, the styles it was drawn with, its children. */
export interface SplashNode {
  style: string;
  text?: string;
  children?: SplashNode[];
}

export interface SplashSnapshot {
  /** The workbench's and the title bar's backgrounds as drawn (transparent over vibrancy). */
  background: string;
  titleBackground: string;
  /** Where the tabs row sat in the window. */
  top: number;
  left: number;
  height: number;
  row: SplashNode;
}

/** Where the snapshot is kept: the window's own localStorage, which the splash reads synchronously. */
export const SPLASH_KEY = "cedian.splash";

/** The computed styles a tab needs to look the same in the splash. */
const PROPS = [
  "display", "align-items", "justify-content", "gap", "box-sizing", "width", "min-width", "max-width", "height",
  "padding", "margin", "border-radius", "background-color", "color", "font-family", "font-size", "font-weight",
  "line-height", "letter-spacing", "white-space", "overflow", "text-overflow", "text-align", "flex",
];

/** An element as a snapshot node: its visible children, each with its computed style inlined. */
export function snapshotNode(el: Element, styleOf: (el: Element) => CSSStyleDeclaration): SplashNode | undefined {
  const style = styleOf(el);
  if (style.display === "none" || style.visibility === "hidden") return undefined;
  const node: SplashNode = { style: PROPS.map((p) => `${p}:${style.getPropertyValue(p)}`).filter((d) => !d.endsWith(":")).join(";") };
  const children = [...el.children].map((c) => snapshotNode(c, styleOf)).filter((c): c is SplashNode => !!c);
  if (children.length) node.children = children;
  else if (el.textContent) node.text = el.textContent;
  return node;
}

/** The snapshot as text for localStorage. */
export const splashText = (snapshot: SplashSnapshot): string => JSON.stringify(snapshot);

/** A stored snapshot, or undefined when there is none or it is not one. */
export function readSplash(text: string | null | undefined): SplashSnapshot | undefined {
  if (!text) return undefined;
  try {
    const s = JSON.parse(text) as SplashSnapshot;
    const num = (n: unknown) => typeof n === "number" && Number.isFinite(n);
    return s && typeof s === "object" && num(s.top) && num(s.left) && num(s.height) && typeof s.background === "string" && typeof s.titleBackground === "string" && isNode(s.row) ? s : undefined;
  } catch {
    return undefined;
  }
}

function isNode(n: unknown): n is SplashNode {
  if (!n || typeof n !== "object") return false;
  const { style, text, children } = n as SplashNode;
  return typeof style === "string" && (text === undefined || typeof text === "string") && (children === undefined || (Array.isArray(children) && children.every(isNode)));
}

/** Draws a node with DOM calls only (the window's Trusted Types policy refuses markup). */
export function buildNode(doc: Document, node: SplashNode): HTMLElement {
  const el = doc.createElement("div");
  el.style.cssText = node.style;
  if (node.children) for (const c of node.children) el.appendChild(buildNode(doc, c));
  else if (node.text) el.textContent = node.text;
  return el;
}
