// Fills the roles a stored theme table from an older version lacks, so the table stays whole after a role is added.

import { derive_roles } from "./derive.ts";
import type { GivenColors } from "./derive.ts";
import { REQUIRED_ROLES } from "./roles.ts";
import { parse_color } from "./theme_file.ts";

const is_record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// A stored table from before `mode_item`, `mode_media` and `mode_command` lacks those, so they derive from the rest. Any other missing role leaves the table for the check to refuse.
const ROLES_ADDED_LATER = ["mode_item", "mode_media", "mode_command"] as const;

export function with_derived_roles(theme: unknown): unknown {
  if (!is_record(theme)) return theme;
  const filled: Record<string, unknown> = { ...theme };
  for (const variant of ["dark", "light"] as const) {
    const table = theme[variant];
    if (!is_record(table) || !REQUIRED_ROLES.every((role) => parse_color(table[role]) !== undefined)) continue;
    const derived = derive_roles(Object.fromEntries(Object.entries(table).filter(([, value]) => parse_color(value) !== undefined)) as GivenColors, variant);
    filled[variant] = { ...table, ...Object.fromEntries(ROLES_ADDED_LATER.filter((role) => table[role] === undefined).map((role) => [role, derived[role]])) };
  }
  return filled;
}
