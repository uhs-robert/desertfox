// The keys a site row with an item selector gets without writing them: `I` (pick a list, the row's items among the candidates) and `zt`, `zz` and `zb` in item mode (back to the current item, then scroll it). They land on the row's own items, which the keys of the item section cannot find where the row names them. A key the row or the user binds themselves stays theirs.

import type { BoundInvocation } from "../shared/invocation.ts";
import type { SiteRuleRow } from "../shared/match_pattern.ts";

type RowItem = { selector: string; link?: unknown; hover?: unknown };

// The `page.item` steps that name a selector, at any depth of a bind: a plain step, a step list, a choice list of step lists, or a `{ run, when_present }` choice.
const item_steps = (binding: unknown): BoundInvocation[] => {
  if (Array.isArray(binding)) return binding.flatMap(item_steps);
  if (typeof binding !== "object" || binding === null) return [];
  const step = binding as BoundInvocation & { run?: unknown };
  return step.run !== undefined ? item_steps(step.run) : step.id === "page.item" && typeof step.args?.["selector"] === "string" ? [step] : [];
};

// The row's items are what its `j` moves through, else what any key of its item column does. A `j` that chooses between selectors (Drive's grid and list view) gives them all, joined into one selector, so the picker finds whichever view shows.
const row_item_of = (table: Record<string, unknown>): RowItem | undefined => {
  const steps = item_steps(table["j"]);
  const [first] = steps.length > 0 ? steps : Object.values(table).flatMap(item_steps);
  const same = steps.length > 0 ? steps : first ? [first] : [];
  return first && { selector: [...new Set(same.map((step) => step.args!["selector"] as string))].join(", "), link: first.args!["link"], hover: first.args!["hover"] };
};

const ALIGNS = { zt: "top", zz: "center", zb: "bottom" } as const;

export function with_item_landings(row: SiteRuleRow): SiteRuleRow {
  const item_table = row.keymap?.item as Record<string, unknown> | undefined;
  const item = item_table && row_item_of(item_table);
  if (!item) return row;
  const { selector, link, hover } = item;
  const landing: BoundInvocation = { id: "page.item", args: { selector, ...(link ? { link } : {}), ...(hover ? { hover } : {}), direction: "current" } };
  const guarded = (step: BoundInvocation): BoundInvocation => ({ ...step, when_present: selector });
  const pick = [guarded({ id: "hint.run", args: { filter: "lists", items: selector } }), landing];
  const aligns = Object.fromEntries(Object.entries(ALIGNS).map(([key, position]) => [key, [guarded(landing), { id: "scroll.align", args: { position } }]]));
  const own_normal_pick = row.bind?.["I"] !== undefined || row.keymap?.["normal"]?.["I"] !== undefined;
  return {
    ...row,
    ...(own_normal_pick ? {} : { bind: { I: pick, ...row.bind } }),
    keymap: { ...row.keymap, item: { I: pick, ...aligns, ...row.keymap?.item } },
  } as SiteRuleRow;
}
