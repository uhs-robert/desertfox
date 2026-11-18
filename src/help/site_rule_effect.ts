// What a stored site rule does, in plain words, for the site rules table on the Settings page. No DOM, so a test reads it.

import { site_row_columns } from "../shared/match_pattern.ts";
import type { SiteRuleRow } from "../shared/match_pattern.ts";

const SHOWN_KEYS = 6;

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

// Keys are written as typed, so the list a user wrote shows as written. A long list is cut, because the table is for scanning.
function key_list(keys: string): { count: number; shown: string } {
  const all = keys.split(/\s+/).filter((key) => key !== "");
  return { count: all.length, shown: all.length > SHOWN_KEYS ? `${all.slice(0, SHOWN_KEYS).join(" ")} ...` : all.join(" ") };
}

const setting_text = (value: unknown): string => (Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value));

// One short phrase per thing the rule sets, in a fixed order: keys on or off, which keys pass or stay, then binds, modes and settings.
export function site_rule_effects(row: SiteRuleRow): string[] {
  const columns = site_row_columns(row);
  const effects: string[] = [];
  if (columns.off !== undefined) effects.push(columns.off ? "Off" : "Keys stay on");
  if (columns.keys !== undefined) {
    if ("pass" in columns.keys) {
      const { count, shown } = key_list(columns.keys.pass);
      effects.push(`Pass ${plural(count, "key")}: ${shown}`);
    } else effects.push(`Only ${plural(key_list(columns.keys.only).count, "key")}`);
  }
  const bind_count = Object.keys(columns.bind ?? {}).length + Object.values(columns.keymap ?? {}).reduce((total, table) => total + Object.keys(table).length, 0);
  if (bind_count > 0) effects.push(plural(bind_count, "bind"));
  const mode_count = Object.keys(columns.modes ?? {}).length;
  if (mode_count > 0) effects.push(plural(mode_count, "site mode"));
  for (const [name, value] of Object.entries(columns.values ?? {})) effects.push(`Sets ${name.replaceAll("_", " ")} to ${setting_text(value)}`);
  return effects;
}

export const site_rule_effect = (row: SiteRuleRow): string => site_rule_effects(row).join("; ");
