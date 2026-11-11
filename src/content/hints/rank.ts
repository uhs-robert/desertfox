// Ranks hint texts against a typed query. Pure and free of page types, so a caller that gathers texts from several frames can rank them in one place.
// This is whole-word and prefix matching, a different model from the letters-in-order scoring of the command line in `../../shared/score.ts`.

const WHOLE_FIRST_WORD = 8;
const WHOLE_LATER_WORD = 4;
const PREFIX_FIRST_WORD = 6;
const PREFIX_LATER_WORD = 2;
const SUBSTRING = 1;

const words_of = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// The best way one query word matches the text, 0 for none.
function score_word(query_word: string, text_words: readonly string[], lower_text: string): number {
  let best = lower_text.includes(query_word) ? SUBSTRING : 0;
  text_words.forEach((word, position) => {
    const first = position === 0;
    if (word === query_word) best = Math.max(best, first ? WHOLE_FIRST_WORD : WHOLE_LATER_WORD);
    else if (word.startsWith(query_word)) best = Math.max(best, first ? PREFIX_FIRST_WORD : PREFIX_LATER_WORD);
  });
  return best;
}

// Every query word must match, and a shorter text beats a longer one with the same matches. An empty query matches everything equally.
export function score_text(query: string, text: string): number {
  const lower_text = text.toLowerCase();
  const text_words = words_of(text);
  const query_words = words_of(query);
  if (query_words.length === 0) return SUBSTRING;
  let total = 0;
  for (const query_word of query_words) {
    const score = score_word(query_word, text_words, lower_text);
    if (score === 0) return 0;
    total += score;
  }
  return total / Math.log2(lower_text.length + 2);
}

export type Ranked = { index: number; score: number };

// Best first, ties in source order. A text that does not match is left out.
export function rank_items(texts: readonly string[], query: string): Ranked[] {
  const ranked = texts.map((text, index) => ({ index, score: score_text(query, text) })).filter((item) => item.score > 0);
  return ranked.sort((left, right) => right.score - left.score || left.index - right.index);
}
