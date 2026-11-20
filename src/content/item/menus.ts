// The menu pass of the item finder: the navigation and sidebar link stacks of a page, offered to the `I` picker as pick-only regions. They never start item mode and never win a hand-over, so a page of menus alone still scrolls on j and k until the user picks one.

import { ancestors, descendants, stacked_items } from "../next_page/detect.ts";
import type { PageReader } from "../next_page/detect.ts";
import type { Region } from "./finder.ts";
import { list_groups } from "./groups.ts";

// A menu is a stack of at least this many sibling links. Fewer is a navbox or a pager, not worth a label.
const MIN_MENU_ITEMS = 4;
const MIN_ITEM_HEIGHT_PX = 12;
const MIN_ITEM_WIDTH_PX = 40;

const MENU_CANDIDATES = "nav,[role=navigation],aside";
const PAGE_FRAME = /^(header|footer|banner|contentinfo)$/;

// The menus of the header and footer are site chrome that every page repeats, so they get no label. The test starts at the parent: the candidate's own tag and role do not count.
const in_page_frame = <N>(reader: PageReader<N>, node: N): boolean => [...ancestors(reader, node)].some((at) => PAGE_FRAME.test(reader.tag_(at)) || PAGE_FRAME.test(reader.attr_(at, "role") ?? ""));

// The menus are read over the whole page and not the `main` scope, because they sit beside `main`. A header bar, breadcrumb row or pager is horizontal, and the three-row stack test drops it with no text rule. A pinned (sticky or fixed) sidebar stays: it is the menu people want. Each candidate offers its biggest stack, so a menu with a submenu offers its larger level.
export function find_menus<N>(reader: PageReader<N>, out_of_time: () => boolean): Region<N>[] {
  // A tile that is itself a link holds no other.
  const is_link = (node: N) => reader.tag_(node) === "a" && reader.attr_(node, "href") !== null && reader.box_(node) !== undefined;
  const link_of = (item: N): N | undefined => [item, ...descendants(reader, item)].find(is_link);
  const rules = {
    box_of: (child: N) => reader.box_(child),
    is_item: (child: N, box: { w: number; h: number }) => box.h >= MIN_ITEM_HEIGHT_PX && box.w >= MIN_ITEM_WIDTH_PX && link_of(child) !== undefined,
    stop: out_of_time,
  };
  // One region per first item: a nav in an aside finds the same stack twice, and the inner candidate, which comes later in page order, keeps it.
  const by_first_item = new Map<N, Region<N>>();
  for (const candidate of reader.query_all_(MENU_CANDIDATES)) {
    const box = reader.box_(candidate);
    if (out_of_time() || !box || box.x + box.w <= 0 || box.y + box.h <= 0 || in_page_frame(reader, candidate)) continue;
    const stacks = list_groups(reader, [candidate, ...descendants(reader, candidate)], rules).filter(({ items }) => items.length >= MIN_MENU_ITEMS && stacked_items(reader, items));
    const { items } = stacks.sort((a, b) => b.items.length - a.items.length)[0] ?? {};
    if (items) by_first_item.set(items[0]!, { kind: "list", items, links: new Map(items.map((item) => [item, link_of(item)])), pick_only_: true });
  }
  return [...by_first_item.values()];
}
