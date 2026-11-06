// How a thread stands, in the words every list and pill uses, and the orders lists keep.
import type { Status, ThreadInfo } from "../protocol/wire.js";

const LABEL: Record<Status, string> = {
  queued: "Queued",
  working: "Working",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
  interrupted: "Interrupted",
  asking: "Waiting for you",
};

/** A status in words; a status this window does not know yet shows as it is. */
export const statusLabel = (status: Status): string => LABEL[status] ?? status;

/** True while a thread has a run going or waiting to start. */
export const isBusy = (status: Status | undefined): boolean => status === "working" || status === "queued";

/** Sorts threads newest first, by when each last changed. */
export const newestFirst = (a: ThreadInfo, b: ThreadInfo): number => b.updated_at.localeCompare(a.updated_at);
