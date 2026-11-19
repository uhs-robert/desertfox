// The keys a site row with an item selector gets without writing them: `I` (pick a list, the row's items among the candidates) and `zt`, `zz` and `zb` in item mode (back to the current item, then scroll it). They land on the row's own items, which the keys of the item section cannot find where the row names them. A key the row or the user binds themselves stays theirs.

import type { BoundInvocation } from "../shared/invocation.ts";
import type { SiteRuleRow } from "../shared/match_pattern.ts";

type RowItem = { selector: string; link?: unknown; hover?: unknown };

// The item the row's keys move through, read from `j` first and else from any key of its item column.
const row_item_of = (table: Record<string, unknown>): RowItem | undefined => {
  const steps = (binding: unknown) => ([binding] as unknown[]).flat(Infinity).filter((step): step is BoundInvocation => typeof step === "object" && step !== null && (step as BoundInvocation).id === "page.item" && typeof (step as BoundInvocation).args?.["selector"] === "string");
  const [step] = [...steps(table["j"]), ...Object.values(table).flatMap(steps)];
  return step && { selector: step.args!["selector"] as string, link: step.args!["link"], hover: step.args!["hover"] };
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
