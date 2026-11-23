// The lists that a page declares with an ARIA role (a web app's inbox grid, a chat's channel tree, a feed of posts). The finder's title-link rule fits none of them, so they are offered only to the `I` picker, as `pick_only_` regions.
// Pure over `PageReader`, like `finder.ts`.

import { ancestors, descendants, is_item_size, stacked_items } from "../lib/page_reader.ts";
import type { PageReader } from "../lib/page_reader.ts";
import type { Region } from "../lib/item_types.ts";

const ITEM_ROLE: Record<string, string> = { listbox: "option", grid: "row", feed: "article", tree: "treeitem" };
const WIDGETS = Object.keys(ITEM_ROLE)
  .map((role) => `[role=${role}]`)
  .join(",");
// A date picker is a grid whose rows hold a week of short day numbers (seven two-digit days make 14 characters). A list row holds more text than that.
const DATE_ROW_CHARS = 16;
const TIMED_OUT = Symbol();

// The shown items of one widget. A tree is flat: a branch is an item too, and the box of its own label (its first child that holds no item) stands for it, since the branch's own box covers its children. The other widgets take their outermost items, so a reply inside a post is no item of the feed. A grid built of a native `table` has `tr` rows with no role.
function items_of<N>(reader: PageReader<N>, widget: N, role: string, check: () => void): N[] {
  const is_row = (node: N) => {
    const own = reader.attr_(node, "role");
    return own === ITEM_ROLE[role] || (role === "grid" && own === null && reader.tag_(node) === "tr");
  };
  const shown = descendants(reader, widget, (node) => (check(), is_row(node) && is_item_size(reader.box_(node))));
  const all = new Set(shown);
  const inside = (item: N): N[] => {
    const found: N[] = [];
    for (const at of ancestors(reader, item)) {
      if (at === widget) break;
      found.push(at);
    }
    return found;
  };
  if (role === "tree") {
    const held = new Set(shown.flatMap(inside));
    return shown.map((item) => (held.has(item) ? (reader.children_(item).find((child) => !held.has(child) && reader.box_(child)) ?? item) : item));
  }
  const is_header_row = (item: N) => reader.children_(item).length > 0 && reader.children_(item).every((cell) => reader.attr_(cell, "role") === "columnheader" || reader.tag_(cell) === "th");
  return shown.filter((item) => (check(), !inside(item).some((at) => all.has(at)) && !is_header_row(item)));
}

// Whether an item of `inner` is one of `outer` or sits inside one. Each node is climbed once, so the cost grows with the page and not with items times depth.
export function holds<N>(reader: PageReader<N>, outer: readonly N[], inner: readonly N[]): boolean {
  const set = new Set(outer);
  const seen = new Set<N>();
  return inner.some((item) => {
    for (let at: N | null = item; at !== null && !seen.has(at); at = reader.parent_(at)) {
      if (set.has(at)) return true;
      seen.add(at);
    }
    return false;
  });
}

// The regions, after those of `taken`, or undefined when the time ran out (a cut-short pass is no answer). A widget that shares an item with a region, or sits in one of its items, is that region's list already.
export function find_aria_lists<N>(reader: PageReader<N>, out_of_time: () => boolean, taken: readonly Region<N>[]): Region<N>[] | undefined {
  const check = () => {
    if (out_of_time()) throw TIMED_OUT;
  };
  // The list a combobox opens is its own popup, which the field's keys drive.
  const popups = new Set(reader.query_all_("[role=combobox]").flatMap((field) => (reader.attr_(field, "aria-controls") ?? "").split(/\s+/)));
  const regions: Region<N>[] = [];
  try {
    for (const widget of reader.query_all_(WIDGETS)) {
      check();
      const role = reader.attr_(widget, "role")!;
      const id = reader.attr_(widget, "id");
      const above = [widget, ...ancestors(reader, widget)];
      const in_popup = above.some((at) => reader.tag_(at) === "dialog" || reader.attr_(at, "aria-modal") === "true" || /^(dialog|alertdialog|menu)$/.test(reader.attr_(at, "role") ?? ""));
      if ((id && popups.has(id)) || in_popup) continue;
      // A widget that holds, or sits in, an item of an earlier region is that region's list: a climb, not a walk of the widget.
      if ([...taken, ...regions].some((other) => holds(reader, other.items, [widget]) || holds(reader, [widget], other.items))) continue;
      const items = items_of(reader, widget, role, check);
      // A calendar row holds a week of day numbers, whatever whitespace the markup leaves between its cells.
      const is_calendar = role === "grid" && items.every((item) => reader.text_(item).replace(/\s/g, "").length < DATE_ROW_CHARS);
      if (is_calendar || !stacked_items(reader, items)) continue;
      // A folder that opens adds rows to the tree, and a closed folder is an item of its own (the `li`) where an open one is its label. Only a fresh read tells them apart, so a changed count of treeitems says the kept items are old.
      const tree_rows = () => reader.query_all_("[role=treeitem]").filter((row) => holds(reader, [widget], [row])).length;
      const rows_read = role === "tree" ? tree_rows() : 0;
      regions.push({
        kind: "list",
        items,
        links: new Map(items.map((item) => [item, item])),
        pick_only_: true,
        home_: widget,
        // A branch's own box covers its children, so the box follows the focus onto leaves only.
        box_selector_: role === "tree" ? "[role=treeitem]:not(:has([role=treeitem]))" : role === "grid" ? "[role=row],tr:not([role])" : `[role=${ITEM_ROLE[role]}]`,
        // The keys of a widget that names its active row stay with the widget, which a focus on a row would take away.
        ...(role === "tree" && { stale_: () => tree_rows() !== rows_read }),
        ...(above.some((at) => reader.attr_(at, "aria-activedescendant") !== null) && { focus_none_: true as const }),
      });
    }
  } catch (thrown) {
    if (thrown === TIMED_OUT) return undefined;
    throw thrown;
  }
  return regions;
}
