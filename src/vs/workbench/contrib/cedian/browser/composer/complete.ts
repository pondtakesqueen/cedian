// `@` and `/` in the composer. `@` names a file of the project (the thread reads it; the text
// keeps `@path`), `/` a command at the start of the message (`cedia commands`: a prompt that
// starts `/<skill>` asks the writer to load it). Pure: the caller gives the files and commands.
import type { CommandEntry } from "../protocol/wire.js";

export interface Token {
  trigger: "@" | "/";
  /** What was typed after the trigger. */
  query: string;
  /** Where the trigger is in the text. */
  start: number;
  /** Just past the query (the cursor). */
  end: number;
}

export interface Completion {
  label: string;
  detail?: string;
  /** What replaces the token, trigger included, with a space after. */
  insert: string;
}

/** The `@` or `/` token the cursor is in, if any. `/` only counts at the start of the message. */
export function tokenAt(text: string, cursor: number): Token | undefined {
  let start = cursor;
  while (start > 0 && !/\s/.test(text[start - 1]!)) start--;
  const word = text.slice(start, cursor);
  if (word.startsWith("@")) return { trigger: "@", query: word.slice(1), start, end: cursor };
  if (word.startsWith("/") && text.slice(0, start).trim() === "") return { trigger: "/", query: word.slice(1), start, end: cursor };
  return undefined;
}

/** Scores how well `query` names `candidate`: a prefix beats a word start beats letters in order. */
export function score(query: string, candidate: string): number | undefined {
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  if (q === "") return 0;
  if (c.startsWith(q)) return 3;
  const base = c.slice(c.lastIndexOf("/") + 1);
  if (base.startsWith(q)) return 2.5;
  if (c.split(/[/._-]/).some((part) => part.startsWith(q))) return 2;
  let at = 0;
  for (const ch of c) if (ch === q[at]) at++;
  return at === q.length ? 1 : undefined;
}

export function complete(token: Token, files: string[], commands: CommandEntry[], limit = 8): Completion[] {
  const ranked = <T>(items: T[], key: (item: T) => string) =>
    items
      .map((item) => ({ item, s: score(token.query, key(item)) }))
      .filter((x): x is { item: T; s: number } => x.s !== undefined)
      .sort((a, b) => b.s - a.s || key(a.item).length - key(b.item).length || key(a.item).localeCompare(key(b.item)))
      .slice(0, limit)
      .map((x) => x.item);
  if (token.trigger === "@") return ranked(files, (f) => f).map((f) => ({ label: f, insert: `@${f} ` }));
  return ranked(commands, (c) => c.name).map((c) => ({ label: `/${c.name}`, detail: c.description, insert: `/${c.name} ` }));
}

/** The text with the token replaced by the completion, and where the cursor goes. */
export function accept(text: string, token: Token, completion: Completion): { text: string; cursor: number } {
  const next = text.slice(0, token.start) + completion.insert + text.slice(token.end);
  return { text: next, cursor: token.start + completion.insert.length };
}
