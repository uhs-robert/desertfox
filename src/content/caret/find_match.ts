// The pure half of page search: a query to a search, the match list over the model's text, and which match is next.
// A match is the pair of arrays `from` and `to`, one entry each, in text order. A page can hold hundreds of thousands, so no object per match.

export type Direction = "forward" | "backward";

// Plain text is searched as text and never becomes a regex. A pattern that is not a regex, or that could freeze the tab, is also searched as its own characters, and `fallback` says why.
export type Search = { kind: "literal"; needle: string; exact: boolean } | { kind: "regex"; regex: RegExp };

export type Fallback = "invalid" | "costly";

export type Query = { search: Search; fallback: Fallback | undefined };

export type Matches = { from: number[]; to: number[] };

const ESCAPED = /[.*+?^${}()|[\]\\]/;

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

// A group that repeats without a limit and holds an unlimited repeat or a choice, such as `(a+)+` or `(a|a)*`. A regex engine backtracks without end on these, and one `exec` cannot be interrupted.
// It also flags harmless ones such as `(foo|bar)+`: the fallback is a text search, which costs the user little.
const UNLIMITED_OR_CHOICE = /[*+|]|\{\d+,\}/u;

export function is_costly_pattern(source: string): boolean {
  // The innermost groups first: the contents of a group that holds no other group are checked, then that group is replaced by a plain letter and the search repeats.
  let rest = source;
  for (let guard = 0; guard < 64; guard++) {
    const innermost = /\((?:[^()\\]|\\.)*\)((?:[*+]|\{\d+,\})?)/u.exec(rest);
    if (!innermost) return false;
    const whole = innermost[0];
    const quantifier = innermost[1]!;
    const inside = whole.slice(0, whole.length - quantifier.length).replace(/\\./gu, "");
    const loose = UNLIMITED_OR_CHOICE.test(inside);
    if (quantifier !== "" && loose) return true;
    // The group becomes one letter, which repeats without a limit when the group did or held a repeat or a choice, so the group around it sees that.
    rest = rest.slice(0, innermost.index) + (quantifier !== "" || loose ? "x*" : "x") + rest.slice(innermost.index + whole.length);
  }
  return true;
}

// Smartcase: a capital letter outside an escape such as \S makes the search exact.
const is_exact = (query: string) => /\p{Lu}/u.test(query.replace(/\\./gu, ""));

export function compile_query(query: string): Query | undefined {
  if (query === "") return undefined;
  const exact = is_exact(query);
  if (!ESCAPED.test(query)) return { search: { kind: "literal", needle: query, exact }, fallback: undefined };
  // Typed text, or a pattern that cannot run as a regex, is searched as its own characters.
  const as_text: Search = { kind: "literal", needle: query, exact };
  if (is_costly_pattern(query)) return { search: as_text, fallback: "costly" };
  try {
    return { search: { kind: "regex", regex: new RegExp(space_matches_line_break(query), exact ? "gu" : "giu") }, fallback: undefined };
  } catch {
    return { search: as_text, fallback: "invalid" };
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

// Lower case that keeps every length, so an index in the folded text is an index in the real one. A letter whose lower case is longer (such as "İ") stays as it is.
const fold = (text: string) => text.replace(/\p{Lu}/gu, (letter) => (letter.toLowerCase().length === letter.length ? letter.toLowerCase() : letter));

// A scan runs in slices, so a keystroke typed mid-scan is heard and the old scan stops. Undefined means the scan was dropped as stale.
// A slice ends between two matches, and one `exec` cannot be interrupted, so a regex that could run away is kept out by is_costly_pattern.
export async function collect_matches(text: string, search: Search, slicing: Slicing): Promise<Matches | undefined> {
  const found: Matches = { from: [], to: [] };
  let slice_started = slicing.now();
  // The next match after the last one, or undefined when the scan is over.
  let next: () => { from: number; to: number } | undefined;
  if (search.kind === "literal") {
    // A typed space matches a line break, as in the regex path. Both texts keep their length.
    const flat = (value: string) => (search.exact ? value : fold(value)).replace(/\n/g, " ");
    const haystack = flat(text);
    const needle = flat(search.needle);
    let at = 0;
    next = () => {
      const from = haystack.indexOf(needle, at);
      if (from < 0) return undefined;
      at = from + needle.length;
      return { from, to: at };
    };
  } else {
    const { regex } = search;
    regex.lastIndex = 0;
    next = () => {
      for (let hit = regex.exec(text); hit; hit = regex.exec(text)) {
        // An empty match moves on by a whole code point: from the middle of a pair, a `u` regex steps back and finds the same match again.
        if (hit[0] !== "") return { from: hit.index, to: hit.index + hit[0].length };
        regex.lastIndex += hit.index + 1 < text.length && text.codePointAt(hit.index)! > 0xffff ? 2 : 1;
      }
      return undefined;
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
