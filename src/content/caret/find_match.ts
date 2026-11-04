// The pure half of page search: a query to a regex, the match list over the model's text, and which match is next.
// A match is the pair of arrays `from` and `to`, one entry each, in text order. A page can hold hundreds of thousands, so no object per match.

export type Direction = "forward" | "backward";

export type Query = { regex: RegExp; invalid: boolean };

export type Matches = { from: number[]; to: number[] };

const ESCAPED = /[.*+?^${}()|[\]\\]/g;

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

// Smartcase: a capital letter outside an escape such as \S makes the search exact. An invalid pattern searches for its own characters, so typing "(" never blocks the line.
export function compile_query(query: string): Query | undefined {
  if (query === "") return undefined;
  const flags = /\p{Lu}/u.test(query.replace(/\\./gu, "")) ? "gu" : "giu";
  try {
    return { regex: new RegExp(space_matches_line_break(query), flags), invalid: false };
  } catch {
    return { regex: new RegExp(space_matches_line_break(query.replace(ESCAPED, "\\$&")), flags), invalid: true };
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

// A scan runs in slices, so a keystroke typed mid-scan is heard and the old scan stops. Undefined means the scan was dropped as stale.
// A slice ends between two matches, so a pattern that finds none in a huge text runs as one slice.
export async function collect_matches(text: string, regex: RegExp, slicing: Slicing): Promise<Matches | undefined> {
  const found: Matches = { from: [], to: [] };
  regex.lastIndex = 0;
  let slice_started = slicing.now();
  for (let hit = regex.exec(text); hit; hit = regex.exec(text)) {
    if (hit[0] === "") regex.lastIndex++;
    else {
      found.from.push(hit.index);
      found.to.push(hit.index + hit[0].length);
    }
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
export function describe_match(query: string, count: number, index: number, invalid: boolean, wrapped = false): string {
  if (count === 0) return `Not found: ${query}`;
  return `${index + 1} of ${count}${wrapped ? ", wrapped" : ""}${invalid ? " (not a regex, searched as text)" : ""}`;
}
