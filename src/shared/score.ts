// The fuzzy scorer for every completion source. It scores like fzf version 1: a match earns points, a gap costs
// points, and a match at the start of a word earns a bonus. A dot counts as a word break, so `tc` finds `tab.close`.
// Pure: no DOM, no `browser`.

const MATCH = 16;
const GAP_START = -3;
const GAP_EXTENSION = -1;
const BONUS_AFTER_SPACE = 10;
const BONUS_AFTER_DELIMITER = 9;
const BONUS_CAMEL = 7;
const BONUS_CONSECUTIVE = 4;
const FIRST_CHAR_MULTIPLIER = 2;
// A hit in the name beats the same hit in the description or a keyword.
const NAME_HIT_BONUS = 8;
const DESCRIPTION_WEIGHT = 0.6;
const KEYWORD_WEIGHT = 0.5;
const EXACT_NAME_BONUS = 1000;
// The most a usage `boost` raises a hit, as a fraction of its score.
export const MAX_BOOST = 0.6;

// `also_named` holds other names the user may type for the same thing, such as the dotted id behind a family word.
// They count as name hits but show no highlight, since the list shows `name`.
// `boost` is opt-in: how much use (visits, an open tab) raises a hit, from 0 to `MAX_BOOST`. It never makes a miss a hit.
export type Candidate = { name: string; also_named?: readonly string[]; description?: string; keywords?: readonly string[]; boost?: number | undefined };

export type Ranked<Item> = Item & { positions: number[] };

type Hit = { score: number; positions: number[] };

const char_class = (char: string | undefined) =>
  char === undefined || /\s/.test(char)
    ? "space"
    : /[/,:;|\-_.()[\]]/.test(char)
      ? "delimiter"
      : /[0-9]/.test(char)
        ? "number"
        : char !== char.toLowerCase()
          ? "upper"
          : "lower";

function bonus_at(text: string, index: number): number {
  const before = char_class(text[index - 1]);
  const here = char_class(text[index]);
  if (here === "space" || here === "delimiter") return 0;
  if (before === "space") return BONUS_AFTER_SPACE;
  if (before === "delimiter") return BONUS_AFTER_DELIMITER;
  return (before === "lower" && here === "upper") || (before !== "number" && here === "number") ? BONUS_CAMEL : 0;
}

// One lowercase term against a text, or null when its letters do not appear in order.
function match_term(term: string, text: string): Hit | null {
  const lower = text.toLowerCase();
  let matched = 0;
  let end = -1;
  for (let index = 0; index < lower.length && end < 0; index++) {
    if (lower[index] === term[matched] && ++matched === term.length) end = index;
  }
  if (end < 0) return null;
  // The shortest window that holds the term, found from the end backward.
  let start = end;
  matched = term.length - 1;
  for (let index = end; index >= 0 && matched >= 0; index--) {
    if (lower[index] === term[matched] && --matched < 0) start = index;
  }
  const positions: number[] = [];
  let score = 0;
  let run = 0;
  let run_bonus = 0;
  let in_gap = false;
  matched = 0;
  for (let index = start; index <= end; index++) {
    if (matched < term.length && lower[index] === term[matched]) {
      let bonus = bonus_at(text, index);
      if (run === 0) run_bonus = bonus;
      else {
        if (bonus >= BONUS_AFTER_DELIMITER && bonus > run_bonus) run_bonus = bonus;
        bonus = Math.max(bonus, run_bonus, BONUS_CONSECUTIVE);
      }
      score += MATCH + (matched === 0 ? bonus * FIRST_CHAR_MULTIPLIER : bonus);
      positions.push(index);
      run += 1;
      in_gap = false;
      matched += 1;
    } else {
      score += in_gap ? GAP_EXTENSION : GAP_START;
      run = 0;
      in_gap = true;
    }
  }
  return { score, positions };
}

// Every space-separated term must hit the name, the description or a keyword. Only the name hits get positions.
export function score_candidate(query: string, candidate: Candidate): Hit | null {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term !== "");
  // A final period ends the sentence and is not a letter to match, or `tab.` would find every "...the tab."
  const description = candidate.description?.replace(/\.$/, "");
  const keywords = (candidate.keywords ?? []).join(" ");
  let score = 0;
  const positions: number[] = [];
  for (const term of terms) {
    const in_name = match_term(term, candidate.name);
    const in_other_name = (candidate.also_named ?? []).map((other) => match_term(term, other)).reduce<Hit | null>((best, hit) => (hit && (!best || hit.score > best.score) ? hit : best), null);
    const in_description = description ? match_term(term, description) : null;
    const in_keywords = keywords ? match_term(term, keywords) : null;
    const name_score = Math.max(in_name ? in_name.score : -Infinity, in_other_name ? in_other_name.score : -Infinity) + NAME_HIT_BONUS;
    const best = Math.max(name_score, in_description ? in_description.score * DESCRIPTION_WEIGHT : -Infinity, in_keywords ? in_keywords.score * KEYWORD_WEIGHT : -Infinity);
    if (best === -Infinity) return null;
    score += best;
    if (in_name && in_name.score + NAME_HIT_BONUS === best) positions.push(...in_name.positions);
  }
  // Scaled by the size of the score, so a gappy hit with a negative score still rises. Before the exact bonus, so use never outranks an exact name.
  if (candidate.boost) score += Math.abs(score) * Math.min(candidate.boost, MAX_BOOST);
  const typed = query.trim().toLowerCase();
  if ([candidate.name, ...(candidate.also_named ?? [])].some((name) => name.toLowerCase() === typed)) score += EXACT_NAME_BONUS;
  return { score, positions };
}

// Best first. A tie goes to the lower `group_of` when the caller ranks several groups as one list, then to the shorter name, then to the order of the source. An empty query keeps the source order.
export function rank<Item extends Candidate>(query: string, items: readonly Item[], group_of: (item: Item) => number = () => 0): Ranked<Item>[] {
  if (query.trim() === "") return items.map((item) => ({ ...item, positions: [] }));
  const hits: { item: Item; hit: Hit; order: number }[] = [];
  items.forEach((item, order) => {
    const hit = score_candidate(query, item);
    if (hit) hits.push({ item, hit, order });
  });
  hits.sort((left, right) => right.hit.score - left.hit.score || group_of(left.item) - group_of(right.item) || left.item.name.length - right.item.name.length || left.order - right.order);
  return hits.map(({ item, hit }) => ({ ...item, positions: hit.positions }));
}

export type BestMatch<Item> = { found: "none" } | { found: "one"; item: Item } | { found: "tie"; first: Item; second: Item };

// For a handler that runs one item from typed text. Equal top scores give a `tie` so the caller can refuse instead of guessing.
export function best_match<Item>(query: string, items: readonly Item[], candidate_of: (item: Item) => Candidate): BestMatch<Item> {
  const hits: { item: Item; score: number }[] = [];
  for (const item of items) {
    const hit = score_candidate(query, candidate_of(item));
    if (hit) hits.push({ item, score: hit.score });
  }
  hits.sort((left, right) => right.score - left.score);
  const [best, next] = hits;
  if (!best) return { found: "none" };
  return next && next.score === best.score ? { found: "tie", first: best.item, second: next.item } : { found: "one", item: best.item };
}
