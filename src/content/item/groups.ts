// The repeated blocks of a page, for the load-more step of `]]` (`../next_page/load_more.ts`) and the item finder (`finder.ts`). Both read the same groups, so `]]` and j agree on where the main list is.

import { ancestors, in_carousel, is_item_size, signature, stacked_items } from "../next_page/detect.ts";
import type { Box, PageReader } from "../next_page/detect.ts";

const CHROME_TAGS = new Set(["nav", "header", "footer", "aside", "dialog"]);
const CHROME_ROLES = new Set(["navigation", "banner", "contentinfo", "menu", "menubar", "tablist", "dialog"]);
const ACTION_ROLES = new Set(["button", "link"]);
const ACTION_INPUTS = new Set(["button", "submit"]);
// A link list (menu, tags) is items that are only short links.
const SHORT_LINK_TEXT = 30;

const self_and_up = <N>(reader: PageReader<N>, node: N): N[] => [node, ...ancestors(reader, node)];

export const in_chrome = <N>(reader: PageReader<N>, node: N): boolean =>
  self_and_up(reader, node).some((at) => CHROME_TAGS.has(reader.tag_(at)) || CHROME_ROLES.has(reader.attr_(at, "role") ?? "") || reader.attr_(at, "aria-modal") === "true");

export const in_pinned = <N>(reader: PageReader<N>, node: N): boolean => self_and_up(reader, node).some(reader.pinned_);

export function is_actionable<N>(reader: PageReader<N>, node: N): boolean {
  const tag = reader.tag_(node);
  if (tag === "a" || tag === "area") return reader.attr_(node, "href") !== null;
  if (tag === "input") return ACTION_INPUTS.has(reader.attr_(node, "type") ?? "");
  return tag === "button" || tag === "summary" || ACTION_ROLES.has(reader.attr_(node, "role") ?? "");
}

// One repeated block: the items of one signature under one parent, and the box of each (an item may count more than its own element, see `GroupRules.box_of`).
export type Group<N> = { parent: N; items: N[]; boxes: Box[]; area: number };

export type GroupRules<N> = {
  // The box an item counts with, or undefined for a child that is no item.
  box_of: (child: N, siblings: readonly N[], at: number) => Box | undefined;
  // Whether a child of that box can be an item.
  is_item: (child: N, box: Box) => boolean;
  // True once the caller has run out of time. The groups found so far are returned.
  stop: () => boolean;
};

export const PLAIN_RULES = <N>(reader: PageReader<N>): GroupRules<N> => ({ box_of: (child) => reader.box_(child), is_item: (_child, box) => is_item_size(box), stop: () => false });

// Every repeated block of two or more items under `nodes`, outside page chrome, carousels, sideways scrollers and fixed boxes. Area per item is capped at the screen width and three screens high, so one huge item does not win alone.
export function list_groups<N>(reader: PageReader<N>, nodes: readonly N[], rules: GroupRules<N> = PLAIN_RULES(reader)): Group<N>[] {
  const view = reader.view_();
  const found: Group<N>[] = [];
  for (const parent of nodes) {
    if (rules.stop()) break;
    const by_signature = new Map<string, { items: N[]; boxes: Box[] }>();
    const children = reader.children_(parent);
    children.forEach((child, at) => {
      const box = rules.box_of(child, children, at);
      if (!box || !rules.is_item(child, box)) return;
      const kind = signature(reader, child);
      const group = by_signature.get(kind) ?? by_signature.set(kind, { items: [], boxes: [] }).get(kind)!;
      group.items.push(child);
      group.boxes.push(box);
    });
    for (const { items, boxes } of by_signature.values()) {
      if (items.length < 2) continue;
      if (in_chrome(reader, parent) || in_carousel(reader, parent) || reader.scrolls_sideways_(parent) || in_pinned(reader, parent)) continue;
      if (items.every((item) => is_actionable(reader, item) && reader.text_(item).trim().length < SHORT_LINK_TEXT)) continue;
      const area = boxes.reduce((sum, box) => sum + Math.min(box.w, view.w) * Math.min(box.h, 3 * view.h), 0);
      found.push({ parent, items, boxes, area });
    }
  }
  return found;
}

// The group with the most area among those that stack in three rows: the main list of the page. A smaller block (the tiles of one row of a justified grid) is no list on its own, so the callers do not ask for it here.
export const main_list = <N>(reader: PageReader<N>, groups: readonly Group<N>[]): Group<N> | undefined =>
  groups.filter((group) => stacked_items(reader, group.items)).reduce<Group<N> | undefined>((best, group) => (!best || group.area > best.area ? group : best), undefined);
