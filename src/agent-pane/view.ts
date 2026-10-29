// What a window holds of one open thread: the blocks the daemon last sent, its own and each
// sub-thread's. A viewer only; the daemon can always send it all again.
import type { Block } from "./block.js";

/** `cedian_wire::Notice::Blocks`. */
export interface BlocksNotice {
  kind: "blocks";
  thread: string;
  sub?: string;
  from: number;
  blocks: Block[];
  context?: number;
  run_cost: number;
}

/** `cedian_wire::Notice::Text`. */
export interface TextNotice {
  kind: "text";
  thread: string;
  sub?: string;
  index: number;
  append: string;
}

export interface ThreadView {
  thread: string;
  blocks: Block[];
  subthreads: Map<string, Block[]>;
  /** Tokens in the context after the latest turn. */
  context?: number;
  runCost: number;
}

export function emptyView(thread: string): ThreadView {
  return { thread, blocks: [], subthreads: new Map(), runCost: 0 };
}

/** Blocks from `from` on replace the view's, as the daemon's fold changed them. */
export function applyBlocks(view: ThreadView, notice: BlocksNotice): ThreadView {
  if (notice.thread !== view.thread) return view;
  const splice = (old: Block[]) => [...old.slice(0, notice.from), ...notice.blocks];
  if (notice.sub !== undefined) {
    const subthreads = new Map(view.subthreads);
    subthreads.set(notice.sub, splice(subthreads.get(notice.sub) ?? []));
    return { ...view, subthreads };
  }
  return { ...view, blocks: splice(view.blocks), context: notice.context, runCost: notice.run_cost };
}

/** The streaming block `index` grows by `append`; nothing else changes. */
export function applyText(view: ThreadView, notice: TextNotice): ThreadView {
  if (notice.thread !== view.thread) return view;
  const grow = (old: Block[]) => {
    const block = old[notice.index];
    if (!block || (block.kind !== "text" && block.kind !== "thinking")) return old;
    const next = old.slice();
    next[notice.index] = { ...block, text: block.text + notice.append };
    return next;
  };
  if (notice.sub !== undefined) {
    const subthreads = new Map(view.subthreads);
    subthreads.set(notice.sub, grow(subthreads.get(notice.sub) ?? []));
    return { ...view, subthreads };
  }
  return { ...view, blocks: grow(view.blocks) };
}
