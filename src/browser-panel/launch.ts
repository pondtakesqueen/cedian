// Dev servers (spec §6.3): the project's `.cedia/launch.json`, else `.claude/launch.json`, the
// same file worktree setup reads. Each configuration is a server the Dev servers menu starts in
// a terminal and opens on localhost, which needs no approval.

export interface DevServer {
  name: string;
  /** The command and its arguments, as the terminal runs them. */
  command: string;
  args: string[];
  /** Where it serves: `url`, else localhost on `port`. */
  url?: string;
  /** The folder it runs in, relative to the project. */
  cwd?: string;
  env?: Record<string, string>;
}

/** The launch files looked for, in order; the first that exists is the one read. */
export const LAUNCH_FILES = [".cedia/launch.json", ".claude/launch.json"];

/** The servers a launch file names; entries without a command are left out. */
export function devServers(text: string): DevServer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const list = (parsed as { configurations?: unknown })?.configurations;
  if (!Array.isArray(list)) return [];
  const servers: DevServer[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const c = entry as Record<string, unknown>;
    const command = typeof c.runtimeExecutable === "string" ? c.runtimeExecutable : typeof c.command === "string" ? c.command : undefined;
    if (!command) continue;
    const args = Array.isArray(c.runtimeArgs) ? c.runtimeArgs.filter((a): a is string => typeof a === "string") : [];
    const port = typeof c.port === "number" && Number.isInteger(c.port) && c.port > 0 && c.port < 65536 ? c.port : undefined;
    const url = typeof c.url === "string" && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(c.url) ? c.url : port ? `http://localhost:${port}/` : undefined;
    const env = typeof c.env === "object" && c.env !== null ? Object.fromEntries(Object.entries(c.env).filter((e): e is [string, string] => typeof e[1] === "string")) : undefined;
    servers.push({
      name: typeof c.name === "string" && c.name.trim() ? c.name.trim() : command,
      command,
      args,
      ...(url ? { url } : {}),
      ...(typeof c.cwd === "string" ? { cwd: c.cwd } : {}),
      ...(env && Object.keys(env).length ? { env } : {}),
    });
  }
  return servers;
}
