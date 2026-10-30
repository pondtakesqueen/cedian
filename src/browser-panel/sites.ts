// The browser's per-project site allowlist (spec §6.3, §3.7): localhost always, any other site
// only once the owner adds it. It lives in `desktop.browser_sites` (project slug → hosts), where
// the daemon reads it for each run (cedia's `--browser-sites`), so the agent keeps to it too.
import { projectSlug, type Desktop } from "../settings/desktop.js";

/** Spec §8.3: what the block says on a page the agent may not use. */
export const TOOLS_OFF = "Claude tools are off for this site";

/** The page's host, lowercased without brackets; none for a page that is not http(s). */
export function hostOf(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return undefined;
  }
}

/** Loopback: where the project's dev servers run, open with no approval. */
export function isLocal(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/** The project's added sites. */
export function sitesOf(desktop: Desktop, root: string): string[] {
  const all = desktop.browser_sites;
  if (typeof all !== "object" || all === null) return [];
  const listed = (all as Record<string, unknown>)[projectSlug(root)];
  return Array.isArray(listed) ? listed.filter((h): h is string => typeof h === "string").map((h) => h.toLowerCase()) : [];
}

/** Whether the agent may use the page at `url`: a blank page, localhost or an added site. */
export function toolsOn(url: string, sites: string[]): boolean {
  if (url === "" || url === "about:blank") return true;
  const host = hostOf(url);
  if (host === undefined) return false;
  return isLocal(host) || sites.includes(host);
}

/** `desktop.browser_sites` with `host` added for the project. */
export function allowSite(desktop: Desktop, root: string, host: string): Record<string, string[]> {
  const all = { ...((desktop.browser_sites as Record<string, string[]> | undefined) ?? {}) };
  const sites = sitesOf(desktop, root);
  all[projectSlug(root)] = sites.includes(host) ? sites : [...sites, host];
  return all;
}

/** `desktop.browser_sites` without `host` for the project; spec §6.3: revocable. */
export function revokeSite(desktop: Desktop, root: string, host: string): Record<string, string[]> {
  const all = { ...((desktop.browser_sites as Record<string, string[]> | undefined) ?? {}) };
  all[projectSlug(root)] = sitesOf(desktop, root).filter((h) => h !== host);
  return all;
}

/**
 * What the address bar's text opens: a URL as typed, a bare host on http when local and https
 * otherwise. Words are not a search: the browser goes only where it is told.
 */
export function addressOf(text: string): { url: string } | { error: string } {
  const typed = text.trim();
  if (typed === "") return { error: "Type a web address" };
  if (typed === "about:blank") return { url: typed };
  if (/^https?:\/\//i.test(typed)) {
    return hostOf(typed) === undefined ? { error: `Not a web address: ${typed}` } : { url: new URL(typed).href };
  }
  if (/\s/.test(typed) || /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(typed)) return { error: `Not a web address: ${typed}` };
  const host = typed.split(/[/:?#]/)[0].toLowerCase();
  const scheme = isLocal(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host) ? "http" : "https";
  const url = `${scheme}://${typed}`;
  return hostOf(url) === undefined || !host.includes(".") && !isLocal(host) ? { error: `Not a web address: ${typed}` } : { url: new URL(url).href };
}
