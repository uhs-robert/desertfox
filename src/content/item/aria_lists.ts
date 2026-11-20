// The lists that a page declares with an ARIA role (a web app's inbox grid, a chat's channel tree, a feed of posts). The finder's title-link rule fits none of them, so they are offered only to the `I` picker, as `pick_only_` regions.
// Pure over `PageReader`, like `finder.ts`.

import { ancestors, descendants, is_item_size, stacked_items } from "../next_page/detect.ts";
import type { PageReader } from "../next_page/detect.ts";
import type { Region } from "./finder.ts";

const ITEM_ROLE: Record<string, string> = { listbox: "option", grid: "row", feed: "article", tree: "treeitem" };
const WIDGETS = Object.keys(ITEM_ROLE)
  .map((role) => `[role=${role}]`)
  .join(",");
// A date or colour picker is a grid of narrow rows. A listbox or tree may be as narrow as a sidebar, so only a grid needs the width.
const MIN_GRID_ROW_PX = 300;

// A tree is flat: its items are the leaves, because the box of an open branch would cover its children. The other widgets take their outermost items, so a reply inside a post is no item of the feed.
function items_of<N>(reader: PageReader<N>, widget: N, role: string): N[] {
  const shown = descendants(reader, widget, (node) => reader.attr_(node, "role") === ITEM_ROLE[role] && is_item_size(reader.box_(node)));
  const all = new Set(shown);
  const nested = new Set<N>();
  const holders = new Set<N>();
  for (const item of shown) {
    const outer = [...ancestors(reader, item)].find((at) => all.has(at));
    if (outer !== undefined) (nested.add(item), holders.add(outer));
  }
  const left = shown.filter((item) => !(role === "tree" ? holders : nested).has(item));
  const is_header_row = (item: N) => reader.children_(item).length > 0 && reader.children_(item).every((cell) => reader.attr_(cell, "role") === "columnheader");
  return left.filter((item) => !is_header_row(item));
}

// The regions, after those of `taken`. A widget that shares an item with a region, or sits in one of its items, is that region's list already.
export function find_aria_lists<N>(reader: PageReader<N>, out_of_time: () => boolean, taken: readonly Region<N>[]): Region<N>[] {
  // The list a combobox opens is its own popup, which the field's keys drive.
  const popups = new Set(reader.query_all_("[role=combobox]").flatMap((field) => (reader.attr_(field, "aria-controls") ?? "").split(/\s+/)));
  const holds = (outer: readonly N[], inner: readonly N[]) => {
    const set = new Set(outer);
    return inner.some((item) => set.has(item) || [...ancestors(reader, item)].some((at) => set.has(at)));
  };
  const regions: Region<N>[] = [];
  for (const widget of reader.query_all_(WIDGETS)) {
    if (out_of_time()) break;
    const role = reader.attr_(widget, "role")!;
    const id = reader.attr_(widget, "id");
    const above = [widget, ...ancestors(reader, widget)];
    if ((id && popups.has(id)) || above.some((at) => reader.tag_(at) === "dialog" || reader.attr_(at, "aria-modal") === "true" || reader.attr_(at, "role") === "menu")) continue;
    const items = items_of(reader, widget, role);
    const wide_enough = role !== "grid" || items.every((item) => reader.box_(item)!.w >= MIN_GRID_ROW_PX);
    if (!wide_enough || !stacked_items(reader, items) || [...taken, ...regions].some((other) => holds(other.items, items) || holds(items, other.items))) continue;
    regions.push({
      kind: "list",
      items,
      links: new Map(items.map((item) => [item, item])),
      pick_only_: true,
      home_: widget,
      box_selector_: `[role=${ITEM_ROLE[role]}]`,
      // The keys of a widget that names its active row stay with the widget, which a focus on a row would take away.
      ...(above.some((at) => reader.attr_(at, "aria-activedescendant") !== null) && { focus_none_: true as const }),
    });
  }
  return regions;
}
