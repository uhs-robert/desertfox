// The site row of the `item_finder` setting: j and k (and h and l, which move only on a grid) on every address, through `page.item` with no selector, so the finder (`src/content/item/finder.ts`) walks the list or grid it finds and the keys scroll when it finds none. `compile_config` appends it after every other row when the setting is on, so a user row or a shipped row that binds j and k decides them first. Those rows get a hold-back row before it (below), so the finder's other keys do not run on their pages. It has no name in `default_site_rows_off`: the setting is its switch.

import { site_row_columns, type SiteRuleRow } from "../shared/match_pattern.ts";
import type { BoundInvocation, KeyBinding } from "../shared/invocation.ts";

// `hover` is the `item_hover` setting. The bundle hovers only the items that hold a thumbnail.
const step = (direction: "down" | "up" | "left" | "right", label: string, hover: boolean): BoundInvocation => ({ id: "page.item", args: { direction, ...(hover ? { hover } : {}) }, label });

export const item_finder_row = (hover: boolean): { name: string; row: SiteRuleRow; finder: true } => ({
  name: "item_finder",
  finder: true,
  row: { site: "<all_urls>", bind: { j: step("down", "Next item, or scroll down", hover), k: step("up", "Previous item, or scroll up", hover), h: step("left", "Item to the left, or scroll left", hover), l: step("right", "Item to the right, or scroll right", hover) } },
});

// The keys the finder row binds. A row page keeps the plain binding of each one the row does not decide itself.
export const HELD_KEYS = ["j", "k", "h", "l"] as const;

const pass_keys = (row: SiteRuleRow): string[] => {
  const { keys } = site_row_columns(row);
  return keys !== undefined && "pass" in keys ? keys.pass.split(/\s+/) : [];
};
const decided_keys = (row: SiteRuleRow): string[] => [...Object.keys(site_row_columns(row).bind ?? {}), ...pass_keys(row)];

// A row that binds or passes j or k has its own say on the item keys, so the finder must not run on its page.
const claims_item_keys = (row: SiteRuleRow): boolean => ["j", "k"].some((key) => decided_keys(row).includes(key));

// A row at `site` that binds each of `keys` to its plain binding in `normal`. The finder row comes after it, so the keys stay plain there. A key with no plain binding stays out, and the finder keeps it. `holds` says which bindings a site row can take.
export const hold_back_row = (site: string, keys: readonly string[], normal: Readonly<Record<string, KeyBinding | null>> | undefined, holds: (binding: KeyBinding) => boolean): { name: string; row: SiteRuleRow } | undefined => {
  const bind = Object.fromEntries(keys.flatMap((key) => (normal?.[key] && holds(normal[key]) ? [[key, normal[key]]] : [])));
  return Object.keys(bind).length === 0 ? undefined : { name: "item_finder", row: { site, bind: bind as NonNullable<SiteRuleRow["bind"]> } };
};

// One hold-back row per site pattern that a row of `rows` claims j or k for. `normal` is the merged keymap's normal mode, so a user remap holds.
export const hold_back_rows = (rows: readonly SiteRuleRow[], normal: Readonly<Record<string, KeyBinding | null>> | undefined, holds: (binding: KeyBinding) => boolean): { name: string; row: SiteRuleRow }[] => {
  const claimed = [...new Set(rows.filter(claims_item_keys).map((row) => row.site))];
  return claimed.flatMap((site) => {
    const decided = new Set(rows.filter((row) => row.site === site).flatMap(decided_keys));
    return hold_back_row(site, HELD_KEYS.filter((key) => !decided.has(key)), normal, holds) ?? [];
  });
};
