// The `]]` detector: decides what the next page is and answers what to do, without doing it. It reads the page only through a `PageReader`, so the live page passes real elements and the snapshot suite (test/fixtures/next_page/) passes saved ones.

import { ancestors, descendants, in_carousel, is_item_size, normalize, signature, stacked_items } from "../lib/page_reader.ts";
import type { PageReader } from "../lib/page_reader.ts";

export type Control<N> = { node: N; texts: readonly string[]; is_link: boolean };

export type NextPageInput<N> = { rel_links: readonly N[]; controls: readonly Control<N>[]; patterns: readonly string[] };

// `follow` goes to another page (a `rel` link or a next word), `click` loads more into this one, `scroll` brings an infinite list to its end.
export type NextPageAction<N> = { action: "follow" | "click" | "scroll"; target: N } | { action: "none" };

// The step after the next pass (`load_more.ts`). A caller passes it only where loading into this page makes sense: `]]` in place.
export type LoadStep = <N>(reader: PageReader<N>) => NextPageAction<N>;

// A longer text is a sentence that happens to hold the word ("Read more about the next release"). Five, not four, for "Go to next search page".
const MAX_WORDS = 5;

// A pattern this short is an arrow or a bracket (two kana or kanji are a word, though). As a word it would hit every sentence, so it must be the whole text.
const MAX_WHOLE_TEXT_PATTERN = 2;

const escape_pattern = (pattern: string): string => pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CJK = "\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}";
// A literal and not `new RegExp(CJK)`, so a bundle that never tests text (the item bundle) drops it.
const has_cjk = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]/u;

// Kana and kanji have no spaces, so a text with them is capped by characters, not words. "次のページへ" is 6, a sentence that holds the word is longer.
const MAX_CJK_CHARS = 12;

// A whole-word match, so 'next' does not hit the '#nextjs' tag. Letters of any script count as word letters, so 次へ does not hit 目次へ. Only a CJK pattern may run straight into kana after it ("次へ進む"), as there is no space to end the word.
function matches_pattern(text: string, pattern: string): boolean {
  const cjk_pattern = has_cjk.test(pattern);
  if (pattern.length <= MAX_WHOLE_TEXT_PATTERN && !cjk_pattern) return text === pattern;
  const length_ok = has_cjk.test(text) ? text.length <= MAX_CJK_CHARS : text.split(" ").length <= MAX_WORDS;
  const after = cjk_pattern ? `(?:(?![\\p{L}\\p{N}])|(?=[${CJK}]))` : "(?![\\p{L}\\p{N}])";
  return length_ok && new RegExp(`(?<![\\p{L}\\p{N}])${escape_pattern(pattern)}${after}`, "u").test(text);
}

export type TextItem = { texts: readonly string[]; is_link: boolean };

// The indexes of the matching items, best first: an earlier pattern, then a link over a button, then the shorter text, then the earlier item.
export function rank_by_text(items: readonly TextItem[], patterns: readonly string[]): number[] {
  const lower_patterns = patterns.map(normalize).filter((pattern) => pattern !== "");
  const ranked: { index: number; rank: number[] }[] = [];
  items.forEach((item, index) => {
    let best: number[] | undefined;
    for (const text of item.texts.map(normalize)) {
      const pattern_index = lower_patterns.findIndex((pattern) => matches_pattern(text, pattern));
      const rank = [pattern_index, item.is_link ? 0 : 1, text.length, index];
      if (pattern_index !== -1 && (!best || compare(rank, best) < 0)) best = rank;
    }
    if (best) ranked.push({ index, rank: best });
  });
  return ranked.sort((a, b) => compare(a.rank, b.rank)).map((entry) => entry.index);
}

function compare(rank: readonly number[], than: readonly number[]): number {
  for (let place = 0; place < rank.length; place++) if (rank[place] !== than[place]) return rank[place]! - than[place]!;
  return 0;
}

// A player's own controls: a near box that holds the video and is no taller than the screen. YouTube's "Next" plays the next video. The page body is no player, however short the page.
const in_player = <N>(reader: PageReader<N>, node: N): boolean =>
  [...ancestors(reader, node, 6)].some((box) => reader.tag_(box) !== "body" && reader.tag_(box) !== "html" && (reader.box_(box)?.h ?? Infinity) <= reader.view_().h && descendants(reader, box).some((inner) => /^(video|audio)$/.test(reader.tag_(inner))));

const is_navigation = <N>(reader: PageReader<N>, node: N): boolean => reader.tag_(node) === "nav" || reader.attr_(node, "role") === "navigation";

const PAGINATION = /pagination/i;

const is_pager_block = <N>(reader: PageReader<N>, item: N): boolean => PAGINATION.test(`${reader.attr_(item, "id") ?? ""} ${reader.attr_(item, "class") ?? ""}`);

// A control inside one item of a list (a post's gallery arrow, a comment's menu) acts on that item, not on the page.
// The climb stops at a navigation box, which pages put their pager in. An item taller than two screens is a page section (a shop's pager sits in one of a stack of sections). A pager that is itself one more block of the results (it carries the results' class) is no item: its id or class says pagination. The last block of the stack is not enough, as the last post of a feed holds its own gallery arrows.
function in_list_item<N>(reader: PageReader<N>, node: N): boolean {
  if ([...ancestors(reader, node)].some((at) => is_navigation(reader, at))) return false;
  for (const item of ancestors(reader, node)) {
    const list = reader.parent_(item);
    const box = reader.box_(item);
    if (list === null || !is_item_size(box) || box.h > 2 * reader.view_().h) continue;
    const kind = signature(reader, item);
    const stack = reader.children_(list).filter((sibling) => is_item_size(reader.box_(sibling)) && signature(reader, sibling) === kind);
    if (stacked_items(reader, stack) && !is_pager_block(reader, item)) return true;
  }
  return false;
}

// A paid post, by the tag or class a feed gives it. Matched on the whole tag or class word only, so a pager whose class merely holds "ad" is never skipped.
const AD_TAG = /(^|-)ad-post$/;
const AD_CLASS = /(^|\s)promotedlink(\s|$)/;

// The arrows of an ad's gallery act on that ad. The list-item skip misses an ad when the feed has fewer than three of them stacked in one batch.
const in_ad = <N>(reader: PageReader<N>, node: N): boolean => [...ancestors(reader, node)].some((at) => AD_TAG.test(reader.tag_(at)) || AD_CLASS.test(reader.attr_(at, "class") ?? ""));

// The best control by text that acts on the page, or undefined.
export function pick_next_control<N>(reader: PageReader<N>, controls: readonly Control<N>[], patterns: readonly string[]): N | undefined {
  for (const index of rank_by_text(controls, patterns)) {
    const { node } = controls[index]!;
    if (!in_carousel(reader, node) && !in_player(reader, node) && !in_ad(reader, node) && !in_list_item(reader, node)) return node;
  }
  return undefined;
}

// A `rel` link wins, then the next words, then the load step when there is one.
export function detect_next_page<N>(reader: PageReader<N>, input: NextPageInput<N>, load_step?: LoadStep): NextPageAction<N> {
  const target = input.rel_links[0] ?? pick_next_control(reader, input.controls, input.patterns);
  if (target !== undefined) return { action: "follow", target };
  return load_step ? load_step(reader) : { action: "none" };
}
