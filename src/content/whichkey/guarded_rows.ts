// The background cannot test a guard, so a guarded row carries its leaf chain and the page decides when the panel opens: no leaf runs, so the row goes. Otherwise the row names the leaf that runs, which may be a fallback.

import type { WhichKeyRow } from "../../shared/messages/content.ts";
import { leaf_for_page } from "../leaf_for_page.ts";

export const rows_for_page = (rows: WhichKeyRow[], focused: Element | null, body: Element | null, root: ParentNode): WhichKeyRow[] =>
  rows.flatMap((row) => {
    if (!row.chain) return [row];
    const leaf = leaf_for_page(row.chain, focused, body, root);
    return leaf ? [leaf === row.chain ? row : { ...row, command: leaf.label ?? row.command, description: leaf.intent ?? "" }] : [];
  });
