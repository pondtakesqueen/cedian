// Keeps the agent pane's log at its newest message while the pane is resized. A redraw already
// scrolls to the end when the log was near it; a resize does not redraw, yet the same messages
// wrap onto more or fewer lines, so without this the newest one slid up to 199 px out of view
// while dragging a divider (measured on the mockup's 220–720 px sweep).

/** Within this of the end counts as at the bottom, as `renderLog`'s redraw has it. */
export const NEAR_BOTTOM = 40;

/** Follows `log`'s size; returns what stops it. Without a ResizeObserver it does nothing. */
export function stickToBottom(log: HTMLElement, Observer: typeof ResizeObserver | undefined = globalThis.ResizeObserver): () => void {
  if (!Observer) return () => {};
  let atBottom = true;
  const onScroll = () => {
    atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < NEAR_BOTTOM;
  };
  log.addEventListener("scroll", onScroll, { passive: true });
  const observer = new Observer(() => {
    if (atBottom) log.scrollTop = log.scrollHeight;
  });
  observer.observe(log);
  return () => {
    observer.disconnect();
    log.removeEventListener("scroll", onScroll);
  };
}
