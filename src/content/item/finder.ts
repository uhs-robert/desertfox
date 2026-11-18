// The item finder: reads a page once and answers where its list or grid of items is, or that it is not sure. The answer is a derived row, the shape of a site row without the selectors: the items and the link that takes the focus in each.
// It is pure over `PageReader`, so the live page (`dom_reader.ts`) and the saved pages of `test/fixtures/next_page/` run the same code. Unsure means `none`, and then the keys scroll as they do without it.

import { ancestors, descendants, once, signature, stacked_items } from "../next_page/detect.ts";
import type { Box, PageReader } from "../next_page/detect.ts";
import { in_chrome, list_groups, plain_block } from "./groups.ts";
import type { Group, GroupRules } from "./groups.ts";

export type FinderKind = "list" | "grid" | "none";

// `links` holds the link of each item that takes the focus, or undefined for an item with no link. `sections` is the block of groups the items sit in, kept for a later key that jumps between sections (a front page sorts its cards into sections). `timed_out_` marks a `none` that only says the time budget ran out.
export type Found<N> = { kind: FinderKind; items: N[]; links: Map<N, N | undefined>; sections?: N[]; timed_out_?: true };

const none = <N>(): Found<N> => ({ kind: "none", items: [], links: new Map() });

export const FINDER_BUDGET_MS = 40;
// A title link has at least this much text.
const TITLE_TEXT_MIN = 15;
// A link that no heading holds names its item only when it starts within this far (or this share of the item's height) from the item's top.
const TITLE_ZONE_PX = 100;
const TITLE_ZONE_SHARE = 0.4;
// The share of a group's items that must hold a title link.
const MIN_TITLED = 0.6;
// The group must span this share of the screen height, so a small module of links is no list.
const MIN_SPAN = 0.6;
// The cards inside a group of sections must hold this share of the area of the sections.
const INNER_SHARE = 0.1;
// A rival is a group this close to the best one in area.
const RIVAL_SHARE = 0.8;
// An item is at least this tall, or this tall when it holds a title link (a Hacker News row), and this wide, so icons and chips are not items.
const TALL_ITEM_PX = 24;
const SHORT_ITEM_PX = 12;
const MIN_ITEM_WIDTH_PX = 120;
// A shorter paragraph is a caption or a label, not prose.
const MIN_PROSE_PARAGRAPH = 40;
// Prose around a list of this many characters outweighs it (see `prose_around`).
const PROSE_AROUND_CHARS = 5000;

const HEADING = /^h[1-6]$/;

export type FinderClock = { now_: () => number; budget_ms_: number };

// With no clock the run has no time budget (the saved pages of the tests).
export function find_items<N>(reader: PageReader<N>, clock?: FinderClock): Found<N> {
  const started = clock?.now_();
  const out_of_time = () => !!clock && clock.now_() - started! > clock.budget_ms_;
  const view = reader.view_();
  const nodes = [reader.root_, ...descendants(reader, reader.root_)];
  const region = main_region(reader, nodes);
  const scope = region === reader.root_ ? nodes : [region, ...descendants(reader, region)];

  const is_link = (node: N) => reader.tag_(node) === "a" && reader.attr_(node, "href") !== null;
  // A tile that is itself a link holds no other.
  const links_of = (item: N): N[] => (is_link(item) ? [item] : descendants(reader, item, is_link));
  const link_text = once((link: N): number => reader.text_(link).trim().length);
  const in_heading = (link: N, item: N): boolean => {
    for (const at of ancestors(reader, link)) {
      if (at === item) break;
      if (HEADING.test(reader.tag_(at))) return true;
    }
    return HEADING.test(reader.tag_(link)) || descendants(reader, link).some((inner) => HEADING.test(reader.tag_(inner)));
  };
  // A link that no heading holds names its item only from the top part of the item, so the cross references in the body of a long entry do not.
  const near_top = (link: N, item: N): boolean => {
    const [at, from] = [reader.box_(link), reader.box_(item)];
    return !at || !from || at.y - from.y <= Math.max(TITLE_ZONE_PX, TITLE_ZONE_SHARE * from.h);
  };
  // The link that names the item: the first link in a heading, else the first link with a title's worth of text, else the lone link of a tile (a picture that links). Past the time budget it answers none, and the run gives up anyway.
  const title_of = once((item: N): N | undefined => {
    if (out_of_time()) return undefined;
    const links = links_of(item);
    const headed = links.filter((link) => in_heading(link, item));
    const long_enough = (link: N) => link_text(link) >= TITLE_TEXT_MIN;
    // A short heading that links is the name of a section (a manual's "Syntax"), so its item is no card.
    if (headed.length > 0 && !headed.some(long_enough)) return undefined;
    const strong = headed.some(long_enough) ? headed.filter(long_enough) : links.filter((link) => long_enough(link) && near_top(link, item));
    return strong[0] ?? (links.length === 1 ? links[0] : undefined);
  });
  const titled_share = (group: Group<N>): number => group.items.filter((item) => title_of(item) !== undefined).length / group.items.length;

  // A paragraph is prose, never an item, so the paragraphs of an issue comment are no list.
  const rules: GroupRules<N> = {
    box_of: (child, siblings, at) => record_box(reader, child, siblings, at),
    is_item: (child, box) => reader.tag_(child) !== "p" && box.w >= MIN_ITEM_WIDTH_PX && (box.h >= TALL_ITEM_PX || (box.h >= SHORT_ITEM_PX && title_of(child) !== undefined)),
    stop: out_of_time,
  };
  const chrome = once((node: N) => in_chrome(reader, node));
  // Only groups that stack in three rows and whose items mostly hold a title link can be lists. A group of sections holds title links too, which the nesting step below sorts out. The style reads of `plain_block` come after the stacking test, which only reads the boxes already read.
  const groups = list_groups(reader, scope, rules).filter((group) => !chrome(group.parent));
  const lists = merge_batches(reader, groups).filter((group) => stacked_items(reader, group.items) && plain_block(reader, group) && titled_share(group) >= MIN_TITLED);
  if (out_of_time()) return { ...none<N>(), timed_out_: true };
  const spans_enough = (group: Group<N>) => Math.max(...group.boxes.map((box) => box.y + box.h)) - Math.min(...group.boxes.map((box) => box.y)) >= MIN_SPAN * view.h;
  const gated = lists.filter(spans_enough);
  const top = main_by_area(gated);
  if (!top) return none();
  const is_rival = (group: Group<N>) => group !== top && group.area >= RIVAL_SHARE * top.area && !nests(reader, group, top) && !nests(reader, top, group);
  if (gated.some(is_rival)) return none();

  // The deepest group inside the best one that still carries a good part of its area: the cards in the sections of a front page.
  let best = top;
  let sections: N[] | undefined;
  for (;;) {
    const inner = main_by_area(lists.filter((group) => group !== best && nests(reader, group, best) && group.area >= INNER_SHARE * best.area));
    if (!inner) break;
    sections = best.items;
    best = inner;
  }
  if (prose_around(reader, scope, best, chrome)) return none();
  // An item with no title link of its own (a story with a short title) takes its longest link, so the focus never lands on a vote arrow.
  const longest_link = (item: N): N | undefined => links_of(item).reduce<N | undefined>((long, link) => (!long || link_text(link) > link_text(long) ? link : long), undefined);
  const links = new Map(best.items.map((item) => [item, title_of(item) ?? longest_link(item)]));
  return { kind: kind_of(best.boxes), items: best.items, links, ...(sections && { sections }) };
}

const main_by_area = <N>(groups: readonly Group<N>[]): Group<N> | undefined => groups.reduce<Group<N> | undefined>((top, group) => (!top || group.area > top.area ? group : top), undefined);

// The page's own main block, when it has one: the largest `main`, so a list walk skips the page chrome around it.
function main_region<N>(reader: PageReader<N>, nodes: readonly N[]): N {
  const mains = nodes.filter((node) => reader.tag_(node) === "main" || reader.attr_(node, "role") === "main");
  const area = (node: N) => (reader.box_(node)?.w ?? 0) * (reader.box_(node)?.h ?? 0);
  return mains.reduce<N>((best, node) => (area(node) > area(best) ? node : best), mains[0] ?? reader.root_);
}

// A `tr` that opens a record (Hacker News puts a story over two or three `tr` of other kinds) counts with the rows after it, up to the next `tr` of its own kind.
function record_box<N>(reader: PageReader<N>, child: N, siblings: readonly N[], at: number): Box | undefined {
  const box = reader.box_(child);
  if (!box || reader.tag_(child) !== "tr") return box;
  const kind = signature(reader, child);
  let bottom = box.y + box.h;
  for (let after = at + 1; after < siblings.length; after++) {
    const next = siblings[after]!;
    if (reader.tag_(next) !== "tr" || signature(reader, next) === kind) break;
    const next_box = reader.box_(next);
    if (next_box) bottom = Math.max(bottom, next_box.y + next_box.h);
  }
  return { ...box, h: bottom - box.y };
}

// Blocks of one kind under sibling parents (a feed that loads in batches, a front page of sections) read as one group. Parents that share a grandparent merge first, then those that share a great-grandparent.
function merge_batches<N>(reader: PageReader<N>, groups: Group<N>[]): Group<N>[] {
  let pool = groups;
  for (const level of [2, 3]) {
    const by_key = new Map<N, Map<string, Group<N>>>();
    const next: Group<N>[] = [];
    for (const group of pool) {
      const shared = [...ancestors(reader, group.parent, level)][level - 1];
      if (shared === undefined) {
        next.push(group);
        continue;
      }
      const key = signature(reader, group.items[0]!);
      const peers = by_key.get(shared) ?? by_key.set(shared, new Map()).get(shared)!;
      const first = peers.get(key);
      if (first) {
        first.items.push(...group.items);
        first.boxes.push(...group.boxes);
        first.area += group.area;
      } else {
        const copy = { ...group, items: [...group.items], boxes: [...group.boxes] };
        peers.set(key, copy);
        next.push(copy);
      }
    }
    pool = next;
  }
  return pool;
}

// Whether `inner` sits inside an item of `outer`.
function nests<N>(reader: PageReader<N>, inner: Group<N>, outer: Group<N>): boolean {
  const holders = new Set(outer.items);
  return inner.items.some((item) => [...ancestors(reader, item)].some((at) => holders.has(at)));
}

// A grid has two or more items in a row on most of its rows. Boxes whose middles are within 8 px share a row.
function kind_of(boxes: readonly Box[]): FinderKind {
  const rows = new Map<number, number>();
  for (const box of boxes) {
    const row = Math.round((box.y + box.h / 2) / 8);
    rows.set(row, (rows.get(row) ?? 0) + 1);
  }
  const wide = [...rows.values()].filter((count) => count >= 2).length;
  return wide * 2 > rows.size ? "grid" : "list";
}

// Paragraph text outside the links and outside the items of the list. A page whose prose lies around the list (a reference list or a table of contents inside an article) is a text page that holds link lists, so the finder gives no list. A text page whose entries are the items (a manual's) is left to the title link test.
function prose_around<N>(reader: PageReader<N>, scope: readonly N[], best: Group<N>, chrome: (node: N) => boolean): boolean {
  const holders = new Set(best.items);
  let around = 0;
  for (const node of scope) {
    const tag = reader.tag_(node);
    if ((tag !== "p" && tag !== "pre") || reader.text_length_(node) < MIN_PROSE_PARAGRAPH || chrome(node) || [...ancestors(reader, node)].some((at) => holders.has(at))) continue;
    const links = descendants(reader, node).filter((inner) => reader.tag_(inner) === "a").reduce((sum, link) => sum + reader.text_length_(link), 0);
    around += reader.text_length_(node) - links;
  }
  return around >= PROSE_AROUND_CHARS;
}
