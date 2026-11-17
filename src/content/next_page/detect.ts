// The `]]` detector: decides what the next page is and answers what to do, without doing it. It reads the page only through a `PageReader`, so the live page passes real elements and the snapshot suite (test/fixtures/next_page/) passes saved ones.

export type Box = { x: number; y: number; w: number; h: number };

// Layout facts about one node. `box_` is in page coordinates and undefined for a node with no box or one hidden by visibility or opacity.
export type PageReader<N> = {
  root_: N;
  parent_: (node: N) => N | null;
  children_: (node: N) => readonly N[];
  tag_: (node: N) => string;
  attr_: (node: N, name: string) => string | null;
  text_: (node: N) => string;
  box_: (node: N) => Box | undefined;
  scrolls_sideways_: (node: N) => boolean;
  pinned_: (node: N) => boolean;
  view_: () => { w: number; h: number; page_h: number };
};

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

export const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

const escape_pattern = (pattern: string): string => pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CJK = "\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}";
const has_cjk = new RegExp(`[${CJK}]`, "u");

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

export function* ancestors<N>(reader: PageReader<N>, node: N, limit = Infinity): Generator<N> {
  for (let at = reader.parent_(node); at !== null && limit-- > 0; at = reader.parent_(at)) yield at;
}

// In page order. A loop, not a recursive generator, whose cost grows with the depth of the tree.
export function descendants<N>(reader: PageReader<N>, node: N): N[] {
  const found: N[] = [];
  const stack = [...reader.children_(node)].reverse();
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    found.push(next);
    stack.push(...[...reader.children_(next)].reverse());
  }
  return found;
}

const CAROUSEL_CLASS = /carousel|swiper|slider|slick|glide|splide|scroller|flickity/i;

// A code block or a table scrolls sideways because its content is wide, not because it is a track of cards.
const is_wide_content = <N>(reader: PageReader<N>, node: N): boolean => [node, ...ancestors(reader, node)].some((at) => /^(pre|table)$/.test(reader.tag_(at)));

// A carousel by its role or class, a sideways scroller, or a box beside one (the arrows of a track sit next to it).
export const in_carousel = <N>(reader: PageReader<N>, node: N): boolean =>
  [...ancestors(reader, node, 3)].some(
    (box) =>
      normalize(reader.attr_(box, "aria-roledescription") ?? "").includes("carousel") ||
      CAROUSEL_CLASS.test(reader.attr_(box, "class") ?? "") ||
      reader.scrolls_sideways_(box) ||
      reader.children_(box).some((sibling) => reader.scrolls_sideways_(sibling) && !is_wide_content(reader, sibling)),
  );

// A player's own controls: a near box that holds the video and is no taller than the screen. YouTube's "Next" plays the next video. The page body is no player, however short the page.
const in_player = <N>(reader: PageReader<N>, node: N): boolean =>
  [...ancestors(reader, node, 6)].some((box) => reader.tag_(box) !== "body" && reader.tag_(box) !== "html" && (reader.box_(box)?.h ?? Infinity) <= reader.view_().h && descendants(reader, box).some((inner) => /^(video|audio)$/.test(reader.tag_(inner))));

// An item of a repeated block reads as its tag and first class, so siblings built from one template share it.
export const signature = <N>(reader: PageReader<N>, node: N): string => `${reader.tag_(node)}.${(reader.attr_(node, "class") ?? "").trim().split(/\s+/)[0]}`;

// The smallest repeated item: at least 24 by 120 px, so icons and chips are not items.
export const is_item_size = (box: Box | undefined): box is Box => box !== undefined && box.h >= 24 && box.w >= 120;

// Three or more items of one signature stacked in at least three rows: a list, not a toolbar or a carousel track.
export function stacked_items<N>(reader: PageReader<N>, items: readonly N[]): boolean {
  const rows = new Set<number>();
  for (const item of items) rows.add(Math.round(reader.box_(item)!.y / 8));
  return items.length >= 3 && rows.size >= 3;
}

const is_navigation = <N>(reader: PageReader<N>, node: N): boolean => reader.tag_(node) === "nav" || reader.attr_(node, "role") === "navigation";

// A control inside one item of a list (a post's gallery arrow, a comment's menu) acts on that item, not on the page.
// The climb stops at a navigation box, which pages put their pager in. An item taller than two screens is a page section (a shop's pager sits in one of a stack of sections).
function in_list_item<N>(reader: PageReader<N>, node: N): boolean {
  if ([...ancestors(reader, node)].some((at) => is_navigation(reader, at))) return false;
  for (const item of ancestors(reader, node)) {
    const list = reader.parent_(item);
    const box = reader.box_(item);
    if (list === null || !is_item_size(box) || box.h > 2 * reader.view_().h) continue;
    const kind = signature(reader, item);
    if (stacked_items(reader, reader.children_(list).filter((sibling) => is_item_size(reader.box_(sibling)) && signature(reader, sibling) === kind))) return true;
  }
  return false;
}

// The best control by text that acts on the page, or undefined.
export function pick_next_control<N>(reader: PageReader<N>, controls: readonly Control<N>[], patterns: readonly string[]): N | undefined {
  for (const index of rank_by_text(controls, patterns)) {
    const { node } = controls[index]!;
    if (!in_carousel(reader, node) && !in_player(reader, node) && !in_list_item(reader, node)) return node;
  }
  return undefined;
}

// A `rel` link wins, then the next words, then the load step when there is one.
export function detect_next_page<N>(reader: PageReader<N>, input: NextPageInput<N>, load_step?: LoadStep): NextPageAction<N> {
  const target = input.rel_links[0] ?? pick_next_control(reader, input.controls, input.patterns);
  if (target !== undefined) return { action: "follow", target };
  return load_step ? load_step(reader) : { action: "none" };
}
