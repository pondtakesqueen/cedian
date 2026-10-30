// Help → Check for updates (spec §11 Phase D; VENDORING step 10): a manual check, asked only when
// the person picks it, against the repository's latest GitHub release. Auto-update waits (spec
// §11 item 11), so a newer release is offered as its page to download from.

/** GitHub's latest published release of Cedian (no drafts or pre-releases). */
export const LATEST_RELEASE = "https://api.github.com/repos/pondtakesqueen/cedian/releases/latest";
/** Where a person sees every release, when there is none to name. */
export const RELEASES_PAGE = "https://github.com/pondtakesqueen/cedian/releases";

export type UpdateCheck =
  | { kind: "newer"; version: string; url: string }
  | { kind: "current"; version: string }
  /** The repository has published no release yet. */
  | { kind: "none" }
  | { kind: "error"; message: string };

/** `v1.2.3-beta.1` → numbers and the pre-release tag, or undefined when it is no version. */
function parse(version: string): { parts: number[]; pre?: string } | undefined {
  const m = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(version.trim());
  if (!m) return undefined;
  return { parts: m[1]!.split(".").map(Number), pre: m[2] };
}

/**
 * Below zero when `a` is older than `b`, zero when the same, above when newer. Missing parts
 * count as 0, and a pre-release comes before its release. Undefined when either is no version.
 */
export function compareVersions(a: string, b: string): number | undefined {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return undefined;
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === undefined) return 1;
  if (y.pre === undefined) return -1;
  return x.pre.localeCompare(y.pre, "en", { numeric: true }) < 0 ? -1 : 1;
}

/** What GitHub's answer for the latest release says about `current`. */
export function updateCheck(current: string, status: number, body: unknown): UpdateCheck {
  if (status === 404) return { kind: "none" };
  if (status === 403 || status === 429) return { kind: "error", message: "GitHub is limiting requests from this address; try again later" };
  if (status < 200 || status >= 300) return { kind: "error", message: `GitHub answered ${status}` };
  const release = body as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown } | null;
  const tag = typeof release?.tag_name === "string" ? release.tag_name : undefined;
  if (!tag) return { kind: "error", message: "GitHub's answer names no release" };
  const order = compareVersions(tag, current);
  if (order === undefined) return { kind: "error", message: `Can't compare release ${tag} with ${current}` };
  const version = tag.replace(/^v/, "");
  if (order <= 0) return { kind: "current", version: current };
  const url = typeof release?.html_url === "string" && release.html_url.startsWith("https://github.com/") ? release.html_url : RELEASES_PAGE;
  return { kind: "newer", version, url };
}

/** The dialog's words for a check, and the page Download opens when there is one. */
export function updateMessage(check: UpdateCheck, current: string): { message: string; detail: string; download?: string } {
  switch (check.kind) {
    case "newer":
      return { message: `Cedian ${check.version} is available`, detail: `You have ${current}. Download it from its release page, then replace Cedian in Applications.`, download: check.url };
    case "current":
      return { message: "Cedian is up to date", detail: `You have ${current}, the latest release.` };
    case "none":
      return { message: "No Cedian release yet", detail: `You have ${current}. Nothing has been published to download yet.` };
    case "error":
      return { message: "Couldn't check for updates", detail: check.message };
  }
}
