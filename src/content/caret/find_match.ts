import type { FindScanAnswer } from "../../shared/messages.ts";

// The pure half of page search: a query to a search, the match list over the model's text, and which match is next.
// A match is the pair of arrays `from` and `to`, one entry each, in text order. A page can hold hundreds of thousands, so no object per match.

export type Direction = "forward" | "backward";

// A capitalised plain-text query is a literal search and never becomes a regex. Plain text with no capital is `folded`: an escaped regex, which cannot backtrack, so it runs in the page.
// A `regex` is the user's own pattern. It runs in a background Worker that stops it at the time limit, because one `exec` cannot be interrupted.
// A pattern that is not a regex, that could freeze the tab, or that ran past the time limit, is searched as its own characters (`as_text`), and `fallback` says why.
export type Search = { kind: "literal"; needle: string } | { kind: "folded"; regex: RegExp } | { kind: "regex"; regex: RegExp };

export type Fallback = "invalid" | "costly";

export type Query = { search: Search; fallback: Fallback | undefined; as_text: Search };

export type Matches = { from: number[]; to: number[] };

const ESCAPED = /[.*+?^${}()|[\]\\]/;
const ESCAPED_EVERYWHERE = new RegExp(ESCAPED.source, "g");

// The model keeps one space between words and a "\n" at a line break, so a typed space has to match either.
function space_matches_line_break(source: string): string {
  let out = "";
  let in_class = false;
  for (let at = 0; at < source.length; at++) {
    const char = source[at]!;
    if (char === "\\") out += char + (source[++at] ?? "");
    else if (char === " " && !in_class) out += "[ \\n]";
    else {
      if (char === "[") in_class = true;
      else if (char === "]") in_class = false;
      out += char;
    }
  }
  return out;
}

// A group that repeats (`*`, `+` or a `{n}` count) and holds an unlimited repeat or a choice, such as `(a+)+` or `(a|a)*`. A regex engine backtracks without end on these, and one `exec` cannot be interrupted.
// It also flags harmless ones such as `(foo|bar)+`: the fallback is a text search, which costs the user little.
const UNLIMITED_OR_CHOICE = /[*+|]|\{\d+(?:,\d*)?\}/u;

// An escape or a character class holds no group, so a `)` in one is not the end of a group.
const ESCAPE_OR_CLASS = /\\.|\[(?:\\.|[^\]\\])*\]/gu;

// The same atom with an unlimited repeat twice in a row, such as `a*a*b`, `\w*\w*x` or `.*.*=`. The two repeats split a run of that atom in every possible way, so the cost grows with each repeat. A longer chain, such as `.*.*.*`, holds this pair too.
// Only identical atoms count. A different atom next (`a+b+`, `foo.*bar`) is allowed, and so are overlapping ones such as `.*a*b` or `\w*a*b`: a static check cannot tell them from ordinary searches, so the background's time limit stops them.
// The pattern is walked one atom at a time (an escape such as `\x61` or `\p{L}` taken whole, a class or one character), so a match never starts inside a class or after an escape.
const ATOM = /\\(?:x[\da-f]{2}|u[\da-f]{4}|u\{[\da-f]+\}|c[a-z]|[pP]\{[^}]*\}|k<[^>]*>|\d+)|\\.|\[(?:\\.|[^\]\\])*\]|[^]/iuy;
const UNLIMITED = /(?:[*+]|\{\d+,\})\??/uy;

function has_stacked_repeats(source: string): boolean {
  const atom_at = (at: number) => (ATOM.lastIndex = at, ATOM.exec(source)?.[0]);
  const repeat_end = (at: number) => (UNLIMITED.lastIndex = at, UNLIMITED.test(source) ? UNLIMITED.lastIndex : -1);
  for (let at = 0, atom = atom_at(0); atom; at += atom.length, atom = atom_at(at)) {
    const first_end = repeat_end(at + atom.length);
    if (first_end >= 0 && atom_at(first_end) === atom && repeat_end(first_end + atom.length) >= 0) return true;
  }
  return false;
}

export function is_costly_pattern(source: string): boolean {
  if (has_stacked_repeats(source)) return true;
  // The innermost groups first: the contents of a group that holds no other group are checked, then that group is replaced by a plain letter and the search repeats.
  let rest = source.replace(ESCAPE_OR_CLASS, "x");
  for (let guard = 0; guard < 64; guard++) {
    const innermost = /\((?:[^()\\]|\\.)*\)((?:[*+]|\{\d+(?:,\d*)?\})?)/u.exec(rest);
    if (!innermost) return false;
    const whole = innermost[0];
    const quantifier = innermost[1]!;
    const loose = UNLIMITED_OR_CHOICE.test(whole.slice(0, whole.length - quantifier.length));
    if (quantifier !== "" && loose) return true;
    // The group becomes one letter, which repeats without a limit when the group did or held a repeat or a choice, so the group around it sees that.
    rest = rest.slice(0, innermost.index) + (quantifier !== "" || loose ? "x*" : "x") + rest.slice(innermost.index + whole.length);
  }
  return true;
}

// Smartcase: a capital letter outside an escape such as \S makes the search exact.
const is_exact = (query: string) => /\p{Lu}/u.test(query.replace(/\\./gu, ""));

// Plain text with no capital searches as an escaped regex, since only `giu` folds case the way the page expects (`s` finds `ſ`, `σ` finds `ς`). An escaped regex has no group or repeat, so it cannot backtrack.
// Plain text with a capital is exact, so it needs no folding and skips the regex.
export function compile_query(query: string): Query | undefined {
  if (query === "") return undefined;
  const exact = is_exact(query);
  const as_text: Search = exact ? { kind: "literal", needle: query } : { kind: "folded", regex: new RegExp(space_matches_line_break(query.replace(ESCAPED_EVERYWHERE, "\\$&")), "giu") };
  if (!ESCAPED.test(query)) return { search: as_text, fallback: undefined, as_text };
  if (is_costly_pattern(query)) return { search: as_text, fallback: "costly", as_text };
  try {
    return { search: { kind: "regex", regex: new RegExp(space_matches_line_break(query), exact ? "gu" : "giu") }, fallback: undefined, as_text };
  } catch {
    return { search: as_text, fallback: "invalid", as_text };
  }
}

export type Slicing = {
  // True once a newer query or the end of the search made this scan useless.
  is_stale: () => boolean;
  // Lets the page and the keys run, then resumes.
  yield_to_page: () => Promise<void>;
  now: () => number;
  slice_ms: number;
};

// Runs a `regex` search in the background (the `find_scan` message).
export type ScanRegex = (text: string, regex: RegExp) => Promise<FindScanAnswer>;

// The line under the search line when a `regex` search ran past the background's limit (FIND_SCAN_LIMIT_MS in src/background/find_scan.ts).
export const describe_timeout = (query: string) => `Pattern too slow, stopped after 0.3 s: ${query}`;

// A page-side scan runs in slices, so a keystroke typed mid-scan is heard and the old scan stops. Undefined means the scan was dropped as stale.
// A slice ends between two matches. Only a `literal` or `folded` search runs here, and neither can backtrack, so one step is short.
export async function collect_matches(text: string, search: Search, slicing: Slicing, scan_regex: ScanRegex): Promise<Matches | "timeout" | undefined> {
  if (search.kind === "regex") {
    const answer = await scan_regex(text, search.regex);
    if (slicing.is_stale()) return undefined;
    if (answer.ok) return { from: Array.from(answer.from), to: Array.from(answer.to) };
    if (answer.reason === "failed") throw new Error(answer.message);
    return answer.reason === "timeout" ? "timeout" : undefined;
  }
  const found: Matches = { from: [], to: [] };
  let slice_started = slicing.now();
  // The next match after the last one, or undefined when the scan is over.
  let next: () => { from: number; to: number } | undefined;
  if (search.kind === "literal") {
    // A typed space matches a line break, as in the regex path. A string pattern keeps `replaceAll` from running a regex.
    const haystack = text.replaceAll("\n", " ");
    const needle = search.needle.replaceAll("\n", " ");
    let at = 0;
    next = () => {
      const from = haystack.indexOf(needle, at);
      if (from < 0) return undefined;
      at = from + needle.length;
      return { from, to: at };
    };
  } else {
    // Escaped text of at least one character never matches empty, so `exec` always moves on.
    const { regex } = search;
    regex.lastIndex = 0;
    next = () => {
      const hit = regex.exec(text);
      return hit ? { from: hit.index, to: hit.index + hit[0].length } : undefined;
    };
  }
  for (let hit = next(); hit; hit = next()) {
    found.from.push(hit.from);
    found.to.push(hit.to);
    if (slicing.now() - slice_started < slicing.slice_ms) continue;
    await slicing.yield_to_page();
    if (slicing.is_stale()) return undefined;
    slice_started = slicing.now();
  }
  return slicing.is_stale() ? undefined : found;
}

// The first match at or after `start` going forward, or the last one before it going backward. Wraps to the other end when there is none.
export function nearest_match(from: number[], start: number, direction: Direction): { index: number; wrapped: boolean } | undefined {
  if (from.length === 0) return undefined;
  let low = 0;
  let high = from.length;
  // The first index whose match starts at or after `start`.
  while (low < high) {
    const middle = (low + high) >> 1;
    if (from[middle]! < start) low = middle + 1;
    else high = middle;
  }
  if (direction === "forward") return low < from.length ? { index: low, wrapped: false } : { index: 0, wrapped: true };
  return low > 0 ? { index: low - 1, wrapped: false } : { index: from.length - 1, wrapped: true };
}

// One step from a match, wrapping at the ends.
export function step_match(index: number, count: number, direction: Direction): { index: number; wrapped: boolean } {
  const next = direction === "forward" ? index + 1 : index - 1;
  return { index: (next + count) % count, wrapped: next < 0 || next >= count };
}

export const opposite = (direction: Direction): Direction => (direction === "forward" ? "backward" : "forward");

// The line under the search line while typing and the toast after n.
export function describe_match(query: string, count: number, index: number, fallback: Fallback | undefined, wrapped = false): string {
  if (count === 0) return `Not found: ${query}`;
  const note = fallback === "invalid" ? " (not a regex, searched as text)" : fallback === "costly" ? " (too slow as a regex, searched as text)" : "";
  return `${index + 1} of ${count}${wrapped ? ", wrapped" : ""}${note}`;
}
