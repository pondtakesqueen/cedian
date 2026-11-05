// The agent pane's line icons, drawn as SVG elements (never HTML strings), 16 px on a 16 grid,
// stroked in the text's colour so a state's colour reaches them through `color`.
const NS = "http://www.w3.org/2000/svg";

type Shape = ["path", string] | ["circle", number, number, number] | ["rect", number, number, number, number, number];

const ICONS = {
  chevron: [["path", "M4 6l4 4 4-4"]],
  float: [["rect", 2, 3, 12, 10, 2], ["rect", 7.5, 8, 4.5, 3, 1]],
  popOut: [["path", "M9 2.5h4.5V7M13.5 2.5L8 8M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"]],
  branch: [["circle", 5, 3.5, 1.5], ["circle", 5, 12.5, 1.5], ["circle", 11, 5.5, 1.5], ["path", "M5 5v6M11 7c0 2.5-6 2-6 4"]],
  pr: [["circle", 4.5, 3.5, 1.5], ["circle", 4.5, 12.5, 1.5], ["circle", 11.5, 12.5, 1.5], ["path", "M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7M8.5 3L7 4.5 8.5 6"]],
  eye: [["path", "M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"], ["circle", 8, 8, 2]],
  attach: [["path", "M13 7.5l-5 5a3 3 0 0 1-4.3-4.2l5.4-5.4a2 2 0 0 1 2.8 2.8L6.6 11a1 1 0 0 1-1.4-1.4L10 4.8"]],
  send: [["path", "M8 13V3.5M4 7l4-4 4 4"]],
  stop: [["rect", 4.5, 4.5, 7, 7, 1.5]],
  shield: [["path", "M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z"]],
  model: [["path", "M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2L12 12M12 4l-1.8 1.8M5.8 10.2L4 12"]],
  close: [["path", "M4.5 4.5l7 7M11.5 4.5l-7 7"]],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

/** An icon for `name`; decorative (hidden from screen readers), so its button carries the name. */
export function icon(doc: Document, name: IconName): SVGSVGElement {
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", `i i-${name}`);
  svg.setAttribute("aria-hidden", "true");
  for (const shape of ICONS[name] as Shape[]) {
    const node = doc.createElementNS(NS, shape[0]);
    if (shape[0] === "path") node.setAttribute("d", shape[1]);
    else if (shape[0] === "circle") (["cx", "cy", "r"] as const).forEach((k, i) => node.setAttribute(k, String(shape[i + 1])));
    else (["x", "y", "width", "height", "rx"] as const).forEach((k, i) => node.setAttribute(k, String(shape[i + 1])));
    svg.append(node);
  }
  return svg;
}
