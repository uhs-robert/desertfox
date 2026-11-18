// The site row of the `item_finder` setting: j and k (and h and l, which move only on a grid) on every address, through `page.item` with no selector, so the finder (`src/content/item/finder.ts`) walks the list or grid it finds and the keys scroll when it finds none. `compile_config` appends it after every other row when the setting is on, so a user row or a shipped row that binds j and k decides them first. It has no name in `default_site_rows_off`: the setting is its switch.

import type { SiteRuleRow } from "../shared/match_pattern.ts";
import type { BoundInvocation } from "../shared/invocation.ts";

// `hover` is the `item_hover` setting. The bundle hovers only the items that hold a thumbnail.
const step = (direction: "down" | "up" | "left" | "right", label: string, hover: boolean): BoundInvocation => ({ id: "page.item", args: { direction, ...(hover ? { hover } : {}) }, label });

export const item_finder_row = (hover: boolean): { name: string; row: SiteRuleRow } => ({
  name: "item_finder",
  row: { site: "<all_urls>", bind: { j: step("down", "Next item, or scroll down", hover), k: step("up", "Previous item, or scroll up", hover), h: step("left", "Item to the left, or scroll left", hover), l: step("right", "Item to the right, or scroll right", hover) } },
});
