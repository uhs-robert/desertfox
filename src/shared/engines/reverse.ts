// Reads the query of a search back out of a results page address: the inverse of `fill_template`.
// An engine reads its own pages by its URL template, or by its `reverse` regex when it has one.

import { SITE_ENGINE_NAME } from "../config.ts";
import type { SearchEngine } from "../config.ts";
import { parse_template } from "./fill.ts";

// A regex that long, or with a quantifier on a group, is refused: a page address is read on a key press, so a pattern must not backtrack badly.
// A quantifier on a group is the shape of every nested-repeat blowup, so the rule needs no case analysis. Escapes and character classes are removed first, so `\)` and `[)]` do not count.
export const REVERSE_MAX_CHARS = 200;
const QUANTIFIED_GROUP = /\)[*+?{]/;
// One placeholder each, so removing them cannot join a `)` to the quantifier of the next token: `([^/]+)\/?` is safe.
const without_escapes_and_classes = (text: string): string => text.replace(/\\.|\[[^\]]*\]/g, "x");

// The problem with a `reverse` text, or undefined when it can be used.
export function reverse_problem(text: string): string | undefined {
  if (text.length === 0 || text.length > REVERSE_MAX_CHARS) return `reverse must be 1 to ${REVERSE_MAX_CHARS} characters`;
  try {
    // The unmodified text first: the `|` added below would hide a pattern that ends on a bare `|` or a backslash.
    new RegExp(text);
    if (QUANTIFIED_GROUP.test(without_escapes_and_classes(text))) return "reverse has a quantifier on a group, which can backtrack without end: write the group once, with no *, +, ? or { after it";
    const groups = new RegExp(`${text}|`).exec("")!.length - 1;
    if (groups !== 1) return `reverse needs exactly one capture group, it has ${groups}`;
  } catch {
    return "reverse is not a valid JavaScript regular expression";
  }
  return undefined;
}

const escape_regex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
// `fill_template` writes a space of the template as %20, so the reader looks for that.
const literal_regex = (text: string): string => escape_regex(text.replaceAll(" ", "%20"));
const OTHER_SLOT = "[^/?&#]*?";

function decode(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw.replaceAll("+", " "));
  } catch {
    return undefined;
  }
}

// One part of the template (path, a query value or the fragment) as a regex with the query in group 1, or undefined when the part has no plain `{query}`.
// `{query|url}` and `{query:raw}` give nothing: a raw value cannot be decoded back, and an alternative may have filled something else.
function part_regex(text: string, capture: string): string | undefined {
  let found = false;
  const source = parse_template(text)
    .map((piece) => {
      if ("literal" in piece) return literal_regex(piece.literal);
      const { alternatives, raw } = piece.expression;
      if (alternatives.length === 1 && alternatives[0] === "query" && !raw && !found) {
        found = true;
        return capture;
      }
      return OTHER_SLOT;
    })
    .join("");
  return found ? source : undefined;
}

// The template up to its first slot: what ranks two engines that both read a page.
const literal_start = (template: string): string => template.slice(0, template.search(/\{|%s/) === -1 ? undefined : template.search(/\{|%s/));

// The path of a template with no query in it: literals as they are, every slot as any text. A raw slot (`{channel:raw}`) can hold a slash.
const path_without_query = (path: string): string =>
  parse_template(path).map((piece) => ("literal" in piece ? literal_regex(piece.literal) : piece.expression.raw ? ".*?" : OTHER_SLOT)).join("");

type Reader = { read: (page: URL) => string | undefined; prefix_length: number; constraints: number };

const TEMPLATE_START = /^(https?):\/\/([^/?#{]+)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/;

// The reader a template implies. Scheme, host and path must equal the template's, every literal query pair of the template must be on the page too
// (so `type=issues` and `type=repos` engines on one path tell their pages apart), and the query comes from the part that holds `{query}`.
function template_reader(template: string): Reader | undefined {
  const parts = TEMPLATE_START.exec(template);
  if (!parts) return undefined;
  const [, scheme, host, path = "", search, fragment] = parts as unknown as [string, string, string, string, string | undefined, string | undefined];
  const pairs = search === undefined ? [] : search.split("&");

  const in_path = part_regex(path, "([^/?#]*)");
  const path_ends_on_query = in_path !== undefined && /\{query\}$|%s$/.test(path);
  let query_pair: { name: string; value: RegExp } | undefined;
  const required: [string, string][] = [];
  for (const pair of pairs) {
    const mark = pair.indexOf("=");
    const name = mark === -1 ? pair : pair.slice(0, mark);
    const value = mark === -1 ? "" : pair.slice(mark + 1);
    const regex = part_regex(value, "([^&#]*)");
    if (regex !== undefined) query_pair ??= { name, value: new RegExp(`^${regex}$`) };
    else if (!/\{|%s/.test(value)) required.push([name, value]);
  }
  const in_fragment = fragment === undefined ? undefined : part_regex(fragment, "(.*)");
  if (in_path === undefined && query_pair === undefined && in_fragment === undefined) return undefined;

  const path_regex = new RegExp(`^${path === "" ? "/?" : (in_path ?? path_without_query(path))}${path_ends_on_query ? "(?:/.*)?" : ""}$`);
  const read = (page: URL): string | undefined => {
    if (page.protocol !== `${scheme}:` || page.host !== host.toLowerCase()) return undefined;
    const path_match = path_regex.exec(page.pathname === "" ? "/" : page.pathname);
    if (!path_match) return undefined;
    if (required.some(([name, value]) => !page.searchParams.getAll(name).includes(decode(value) ?? value))) return undefined;
    if (in_path !== undefined) return decode(path_match[1] ?? "");
    if (query_pair) {
      const raw_pair = page.search.slice(1).split("&").find((candidate) => (candidate.split("=", 1)[0] ?? "") === query_pair.name);
      const value = raw_pair === undefined ? undefined : raw_pair.slice(query_pair.name.length + 1);
      const found = value === undefined ? undefined : query_pair.value.exec(value)?.[1];
      return found === undefined ? undefined : decode(found);
    }
    const found = new RegExp(`^${in_fragment}$`).exec(page.hash.slice(1))?.[1];
    return found === undefined ? undefined : decode(found);
  };
  return { read, prefix_length: literal_start(template).length, constraints: required.length };
}

function explicit_reader(engine: SearchEngine, pattern: string): Reader | undefined {
  if (reverse_problem(pattern) !== undefined) return undefined;
  const regex = new RegExp(`^(?:${pattern})$`);
  return { read: (page) => { const found = regex.exec(page.href)?.[1]; return found === undefined ? undefined : decode(found); }, prefix_length: literal_start(engine.url).length, constraints: 0 };
}

// The query the engine's own results page at `page_url` holds, or undefined when the page is not one of its results pages or the query is empty.
export function read_query(engine: SearchEngine, page_url: string): string | undefined {
  if (!URL.canParse(page_url)) return undefined;
  const reader = reader_of(engine);
  const query = reader?.read(new URL(page_url));
  return query === undefined || query.trim() === "" ? undefined : query;
}

function reader_of(engine: SearchEngine): Reader | undefined {
  return engine.reverse === undefined ? template_reader(engine.url) : explicit_reader(engine, engine.reverse);
}

// The engine that owns a results page and the query on it. When several read the page, the one with the longest literal start of its template wins,
// then the one with more literal query pairs, then the first by name. `site` is built from the default engine at run time and would read the same page twice.
export function engine_of_page(engines: Record<string, SearchEngine>, page_url: string): { name: string; query: string } | undefined {
  if (!URL.canParse(page_url)) return undefined;
  const page = new URL(page_url);
  let best: { name: string; query: string; prefix_length: number; constraints: number } | undefined;
  for (const name of Object.keys(engines).sort()) {
    const engine = engines[name]!;
    if (name === SITE_ENGINE_NAME) continue;
    const reader = reader_of(engine);
    const raw = reader?.read(page);
    if (reader === undefined || raw === undefined || raw.trim() === "") continue;
    const better = best === undefined || reader.prefix_length > best.prefix_length || (reader.prefix_length === best.prefix_length && reader.constraints > best.constraints);
    if (better) best = { name, query: raw, prefix_length: reader.prefix_length, constraints: reader.constraints };
  }
  return best && { name: best.name, query: best.query };
}
