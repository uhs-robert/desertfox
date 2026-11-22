// The Site Rules page: the rows of the site table that fit one address.

import type { RuleColumn, KeyChange, SiteRuleRowView } from "../shared/site/site_rules_view.ts";
import type { HelpModel } from "./model.ts";
import { el, table_of } from "./dom.ts";

// Columns are name and value pairs, so a per-site setting added later shows with no code here.
const columns_table = (columns: RuleColumn[]): HTMLElement => table_of("desertfox-help-columns", ["option", "value", ""], columns.map(({ name, value, shadowed }) => [name, value, shadowed ? "an earlier rule decides this" : ""]), columns.map(({ shadowed }) => shadowed));
const changes_table = (changes: KeyChange[]): HTMLElement =>
  table_of("desertfox-help-changes", ["key", "mode", "does", "was", ""], changes.map(({ keys, mode, keymap_mode, action, replaces, dead }) => [el("kbd", undefined, keys), mode ?? (keymap_mode === undefined ? "" : `keymap ${keymap_mode}`), action, replaces ?? "", dead ?? ""]), changes.map(({ dead }) => dead !== undefined));

function site_rule_row(row: SiteRuleRowView): HTMLElement {
  const source = row.origin === "default" ? `Built-in rule ${row.name}` : "Your rule";
  return el("section", "desertfox-help-command", el("h3", undefined, source, " ", el("code", "desertfox-help-muted", row.site)), row.columns.length > 0 ? columns_table(row.columns) : el("p", "desertfox-help-muted", "This rule sets no option."), row.changes.length > 0 ? changes_table(row.changes) : "");
}

// The list is for the tab's own address. A frame of another site resolves its rows against its own address, so it can differ.
export function site_rules_page(model: HelpModel, address: string | undefined): HTMLElement[] {
  if (address === undefined) return [el("p", undefined, "Site rules change how DesertFox works on certain sites, for example by turning keys off. Open a web page, then run ", el("code", undefined, ":help site_rules"), " to see the rules that apply to it.")];
  const { rows } = model.site_rules_for(address);
  return [
    el("p", undefined, "These rules apply to ", el("code", undefined, address), ". If two rules set the same option, the first one wins. A key rule wins key by key. Frames from other sites follow the rules for their own address, so this list is for the tab's address only."),
    ...(rows.length === 0 ? [el("p", undefined, "No rule applies to this address.")] : rows.map(site_rule_row)),
  ];
}
