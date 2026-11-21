// The item finder: reads a page once and answers where its list or grid of items is, or that it is not sure. The answer is a derived row, the shape of a site row without the selectors: the items and the link that takes the focus in each.
// It is pure over `PageReader`, so the live page (`dom_reader.ts`) and the saved pages of `test/fixtures/next_page/` run the same code. Unsure means `none`, and then the keys scroll as they do without it.

import { ancestors, descendants, once, signature, stacked_items } from "../next_page/detect.ts";
import type { Box, PageReader } from "../next_page/detect.ts";
import { find_aria_lists, holds } from "./aria_lists.ts";
import { in_chrome, list_groups, plain_block } from "./groups.ts";
import { find_menus } from "./menus.ts";
import type { Group, GroupRules } from "./groups.ts";

export type FinderKind = "list" | "grid" | "none";

// `links` holds the link of each item that takes the focus, or undefined for an item with no link. `sections` is the block of groups the items sit in, kept for a later key that jumps between sections (a front page sorts its cards into sections). `row_` marks the list of a site row's items, which the picker offers (`lists_with_row` in `main.ts`) and which is no finder list. `timed_out_` marks a `none` that only says the time budget ran out. The last three fields belong to the ARIA lists (`aria_lists.ts`): `home_` is the widget, which names the region again after the page replaced its rows, `box_selector_` is what the box follows a page script's focus by (their items are often classless), and `focus_none_` says the widget names its own active row, so a pick or a move leaves the focus where it is.
export type Region<N> = { kind: FinderKind; items: N[]; links: Map<N, N | undefined>; sections?: N[]; pick_only_?: true; row_?: true; home_?: N; box_selector_?: string; focus_none_?: true };
// The answer is its first region (the one with the most area) plus every top-level list of the page in `regions`, from the largest down, so the derived row can follow the one in view.
export type Found<N> = Region<N> & { regions: Region<N>[]; timed_out_?: true };

const none = <N>(): Found<N> => ({ kind: "none", items: [], links: new Map(), regions: [] });

export const FINDER_BUDGET_MS = 40;
// The first read at an address may take this long (see `derived.ts` for which reads get it): a long page runs past 40 ms in a content script, and its answer is then kept for the later presses.
export const LONG_BUDGET_MS = 400;
// A title link has at least this much text.
const TITLE_TEXT_MIN = 15;
// A link that no heading holds names its item only when it starts within this far (or this share of the item's height) from the item's top.
const TITLE_ZONE_PX = 100;
const TITLE_ZONE_SHARE = 0.4;
// The share of a group's items that must hold a title link.
const MIN_TITLED = 0.6;
// The group must span this share of the screen height to be the first list or to start item mode on load. A shorter list is kept as a `pick_only_` region, which only a pick can make active.
const MIN_SPAN = 0.6;
// The cards inside a group of sections must hold this share of the area of the sections.
const INNER_SHARE = 0.1;
// An item is at least this tall, or this tall when it holds a title link (a Hacker News row), and this wide, so icons and chips are not items.
const TALL_ITEM_PX = 24;
const SHORT_ITEM_PX = 12;
const MIN_ITEM_WIDTH_PX = 120;
// A shorter paragraph is a caption or a label, not prose.
const MIN_PROSE_PARAGRAPH = 40;
// Prose around a list of this many characters outweighs it (see `prose_around`).
const PROSE_AROUND_CHARS = 5000;

const HEADING = /^h[1-6]$/;
const DEEP_HEADING = /^h[3-6]$/;

export type FinderClock = { now_: () => number; budget_ms_: number };

// With no clock the run has no time budget (the saved pages of the tests).
export function find_items<N>(reader: PageReader<N>, clock?: FinderClock): Found<N> {
  const started = clock?.now_();
  const out_of_time = () => !!clock && clock.now_() - started! > clock.budget_ms_;
  const view = reader.view_();
  const nodes = [reader.root_, ...descendants(reader, reader.root_)];
  const region = main_region(reader);
  const scope = region === reader.root_ ? nodes : [region, ...descendants(reader, region)];

  // A hidden link (a copy of the title for small screens) cannot take the focus, so it names no item.
  const is_link = (node: N) => reader.tag_(node) === "a" && reader.attr_(node, "href") !== null && reader.box_(node) !== undefined;
  // A tile that is itself a link holds no other.
  const links_of = (item: N): N[] => (is_link(item) ? [item] : descendants(reader, item, is_link));
  const link_text = once((link: N): number => reader.text_(link).trim().length);
  const in_heading = (link: N, item: N, kind = HEADING): boolean => {
    for (const at of ancestors(reader, link)) {
      if (at === item) break;
      if (kind.test(reader.tag_(at))) return true;
    }
    return kind.test(reader.tag_(link)) || descendants(reader, link).some((inner) => kind.test(reader.tag_(inner)));
  };
  // A link that no heading holds names its item only from the top part of the item, so the cross references in the body of a long entry do not.
  // Both have a box: a link that names an item is shown, and so is an item.
  const near_top = (link: N, item: N): boolean => {
    const from = reader.box_(item)!;
    return reader.box_(link)!.y - from.y <= Math.max(TITLE_ZONE_PX, TITLE_ZONE_SHARE * from.h);
  };
  // The link that names the item: the first link in a heading, else the first link with a title's worth of text, else the lone link of a tile (a picture that links). Past the time budget it answers none, and the run gives up anyway.
  const title_of = once((item: N): N | undefined => {
    if (out_of_time()) return undefined;
    const links = links_of(item);
    const headed = links.filter((link) => in_heading(link, item));
    // A short link in an h3 to h6 that goes to another web page (a comment's author handle) names its item too. A section name's heading links to a fragment of this page (a manual's "Syntax"), and so does an empty address.
    const leaves_web = (link: N) => /^\s*(?!https?:)[a-z][a-z\d+.-]*:/i.test(reader.attr_(link, "href")!);
    const long_enough = (link: N) => link_text(link) >= TITLE_TEXT_MIN || (!leaves_web(link) && !reader.same_page_!(link) && in_heading(link, item, DEEP_HEADING));
    // A short heading that links is the name of a section, so its item is no card.
    if (headed.length > 0 && !headed.some(long_enough)) return undefined;
    // A title under a picture (a video thumbnail) starts low in its tile, and links where the picture links.
    // An empty, "#" or script address goes nowhere, so two links that share it share no target.
    const address = (link: N) => reader.attr_(link, "href")?.trim() ?? "";
    const shares_target = (link: N) => address(link) === address(links[0]!) && !/^(#?$|javascript:)/i.test(address(link));
    const names_item = (link: N) => near_top(link, item) || link === links[0] || shares_target(link);
    const strong = headed.some(long_enough) ? headed.filter(long_enough) : links.filter((link) => long_enough(link) && names_item(link));
    return strong[0] ?? (links.length === 1 ? links[0] : undefined);
  });
  const has_text_title = (item: N): boolean => {
    const title = title_of(item);
    return !!title && link_text(title) > 0;
  };
  const titled_share = (group: Group<N>): number => group.items.filter(title_of).length / group.items.length;

  // A paragraph is prose, never an item, so the paragraphs of an issue comment are no list.
  const rules: GroupRules<N> = {
    box_of: (child, siblings, at) => record_box(reader, child, siblings, at),
    is_item: (child, box) => reader.tag_(child) !== "p" && box.w >= MIN_ITEM_WIDTH_PX && (box.h >= TALL_ITEM_PX || (box.h >= SHORT_ITEM_PX && !!title_of(child))),
    stop: out_of_time,
  };
  const chrome = once((node: N) => in_chrome(reader, node));
  // Only groups that stack in three rows and whose items mostly hold a title link can be lists. A group of sections holds title links too, which the nesting step below sorts out. The style reads of `plain_block` come after the stacking test, which only reads the boxes already read.
  const groups = list_groups(reader, scope, rules).filter((group) => !chrome(group.parent));
  const lists = merge_batches(reader, nest_batches(reader, groups)).filter((group) => stacked_items(reader, group.items) && plain_block(reader, group) && titled_share(group) >= MIN_TITLED);
  if (out_of_time()) return { ...none<N>(), timed_out_: true };
  const spans_enough = (group: Group<N>) => Math.max(...group.boxes.map((box) => box.y + box.h)) - Math.min(...group.boxes.map((box) => box.y)) >= MIN_SPAN * view.h;
  const gated = lists.filter(spans_enough);
  // A list that sits inside an item of another is no top-level list. Several lists side by side (a feed and its rails) are all kept.
  const top_of = (pool: Group<N>[]) => pool.filter((group) => !pool.some((outer) => outer !== group && nests(reader, group, outer))).sort((a, b) => b.area - a.area);
  const tops = top_of(gated);
  // A short list that sits in no list at all (gated or short) is a top-level list too, placed after the gated ones.
  const short_tops = lists.filter((group) => !gated.includes(group) && !lists.some((outer) => outer !== group && nests(reader, group, outer))).sort((a, b) => b.area - a.area);
  // An item with no title link of its own (a story with a short title) takes its longest link, so the focus never lands on a vote arrow.
  const longest_link = (item: N): N | undefined => links_of(item).reduce<N | undefined>((long, link) => (!long || link_text(link) > link_text(long) ? link : long), undefined);
  const region_of = (top: Group<N>): Region<N> | undefined => {
    // The deepest group inside the top one that still carries a good part of its area: the cards in the sections of a front page.
    let best = top;
    let sections: N[] | undefined;
    for (;;) {
      const inner = main_by_area(lists.filter((group) => group !== best && nests(reader, group, best) && group.area >= INNER_SHARE * best.area && !parts_of_cards(reader, group, best, has_text_title)));
      if (!inner) break;
      sections = best.items;
      best = inner;
    }
    if (prose_around(reader, scope, best, chrome)) return undefined;
    const links = new Map(best.items.map((item) => [item, title_of(item) ?? longest_link(item)]));
    return { kind: kind_of(best.boxes), items: best.items, links, ...(sections && { sections }) };
  };
  const regions = tops.map(region_of).filter((region) => region !== undefined);
  // Each region reads the prose around it, so a page of many short lists stops adding them once the budget is spent. The long lists are already in.
  const short_regions: Region<N>[] = [];
  for (const group of short_tops) {
    if (out_of_time()) break;
    const region = region_of(group);
    if (region) short_regions.push({ ...region, pick_only_: true });
  }
  // The ARIA lists come before the menus, so a spent budget loses the menus first. A pass that ran out of time adds nothing, and the lists found before it stay.
  const every = [...regions, ...short_regions];
  const aria = find_aria_lists(reader, out_of_time, every);
  if (!aria && !every[0]) return { ...none<N>(), timed_out_: true };
  // A menu that holds, or sits in, an item of an ARIA list is that list again, and the page's own role names it better.
  const aria_items = (aria ?? []).flatMap((region) => region.items);
  const menus = find_menus(reader, out_of_time).filter((menu) => !holds(reader, menu.items, aria_items) && !holds(reader, aria_items, menu.items));
  every.push(...(aria ?? []), ...menus);
  return every[0] ? { ...(regions[0] ?? none<N>()), regions: every } : none();
}

const main_by_area = <N>(groups: readonly Group<N>[]): Group<N> | undefined => groups.reduce<Group<N> | undefined>((top, group) => (!top || group.area > top.area ? group : top), undefined);

// The page's own main block, when it has one: the largest `main`, so a list walk skips the page chrome around it.
// The walk of the whole page comes first, so the query also sees a `main` inside a shadow root.
function main_region<N>(reader: PageReader<N>): N {
  const mains = reader.query_all_("main,[role=main]");
  const area = (node: N) => (reader.box_(node)?.w ?? 0) * (reader.box_(node)?.h ?? 0);
  return mains.sort((a, b) => area(b) - area(a))[0] ?? reader.root_;
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

// A load that puts its batch in a container inside the first one's (a frame that replaces the load-more form) adds that batch to the first group, and so does each later load nested one level deeper. The container must come after the group's last item, as a load-more frame does, so a block in the middle of a list or a section of cards joins nothing. The batch can use another tag for the same template (a feed whose first page is divs and whose later pages are articles), so only the first class is compared, and a classless item has none.
function nest_batches<N>(reader: PageReader<N>, groups: Group<N>[]): Group<N>[] {
  const homes = new Map<N, Group<N>[]>();
  const kind_of_group = (group: Group<N>) => signature(reader, group.items[0]!).replace(/^[^.]*\./, "");
  return groups.filter((group) => {
    const kind = kind_of_group(group);
    const outer = reader.parent_(group.parent)!;
    const siblings = reader.children_(outer);
    const host = homes.get(outer)?.find((peer) => kind && kind_of_group(peer) === kind && siblings.indexOf(group.parent) > siblings.indexOf(peer.items.at(-1)!));
    if (host) {
      host.items.push(...group.items);
      host.boxes.push(...group.boxes);
      host.area += group.area;
    }
    homes.set(group.parent, [...(homes.get(group.parent) ?? []), host ?? group]);
    return !host;
  });
}

// Blocks of one kind under sibling parents of one kind, the same tag and first class (a feed that loads in batches, a front page of sections) read as one group. Parents that share a grandparent merge first, then those that share a great-grandparent.
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
      const key = `${signature(reader, group.items[0]!)} ${signature(reader, group.parent)}`;
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

// Whether `inner` is the pieces of the cards in `outer` rather than cards inside sections. Two shapes count. It sits in nearly every outer item yet fills only a small part of them (the title, channel and chapter blocks beside a video thumbnail). Or it has no more items with a text title than the outer items that hold it: one title per record, so its items are halves of a record (the title block and the date-and-avatar block of an inbox row), not a card each.
const CARD_PARTS_HELD = 0.8;
const CARD_PARTS_COVER = 0.3;
function parts_of_cards<N>(reader: PageReader<N>, inner: Group<N>, outer: Group<N>, has_text_title: (item: N) => boolean): boolean {
  const holders = new Set(outer.items);
  const held = new Set(inner.items.map((item) => [...ancestors(reader, item)].find((at) => holders.has(at))));
  held.delete(undefined);
  const held_area = outer.items.reduce((sum, item, at) => (held.has(item) ? sum + outer.boxes[at]!.w * outer.boxes[at]!.h : sum), 0);
  const small_pieces = held.size >= CARD_PARTS_HELD * outer.items.length && inner.area < CARD_PARTS_COVER * held_area;
  return small_pieces || inner.items.filter(has_text_title).length <= held.size;
}

// Whether `inner` sits inside an item of `outer`.
function nests<N>(reader: PageReader<N>, inner: Group<N>, outer: Group<N>): boolean {
  const holders = new Set(outer.items);
  return inner.items.some((item) => [...ancestors(reader, item)].some((at) => holders.has(at)));
}

// A grid has two or more items in a row on most of its rows. Boxes whose tops are within 8 px share a row.
function kind_of(boxes: readonly Box[]): FinderKind {
  const rows = new Map<number, number>();
  for (const box of boxes) {
    const row = Math.round(box.y / 8);
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
    const links = descendants(reader, node, (inner) => reader.tag_(inner) === "a").reduce((sum, link) => sum + reader.text_length_(link), 0);
    around += reader.text_length_(node) - links;
  }
  return around >= PROSE_AROUND_CHARS;
}
