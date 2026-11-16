// What a daemon's welcome says is wrong with the cedia it runs, for a blocking error (spec §8.3,
// §8.4: a modal): cedia could not be asked at all, or it speaks another protocol than the one the
// daemon was built on, so its threads may not read right.
import type { Notice } from "../protocol/wire.js";

type Welcome = Extract<Notice, { kind: "welcome" }>;

export interface CediaProblem {
  message: string;
  detail: string;
}

export function cediaProblem(welcome: Welcome): CediaProblem | undefined {
  if ("Err" in welcome.cedia) {
    return { message: "Cedian can't run cedia", detail: `${welcome.cedia.Err}\n\nInstall cedia, or set CEDIAN_CEDIA_BIN to the cedia to run, then restart Cedian.` };
  }
  const speaks = welcome.cedia.Ok.protocol;
  if (welcome.protocol && speaks !== welcome.protocol) {
    return {
      message: `cedia speaks protocol ${speaks}, cedian was built on ${welcome.protocol}`,
      detail: "Threads may not show right until they match: install the cedia this Cedian was built with, or a Cedian built on this cedia (script/pin-cedia).",
    };
  }
  return undefined;
}
