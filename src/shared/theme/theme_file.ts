// Checks one parsed theme file and fills it into a full theme. `just themes` reads the repo `themes/`
// with it and `tools/build-config` reads the user's, so both report the same errors.

import { derive_roles } from "./derive.ts";
import type { GivenColors } from "./derive.ts";
import { is_role, REQUIRED_ROLES, ROLES, VARIANTS } from "./roles.ts";
import type { RoleColors, Theme, Variant } from "./roles.ts";

// Hex only, because derivation does color math on the value.
export function parse_color(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
}

const is_table = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function check_table(file: string, variant: Variant, table: unknown, problems: string[]): RoleColors | undefined {
  if (!is_table(table)) {
    problems.push(`${file}: [${variant}]: expected a table of role = color`);
    return undefined;
  }
  const problems_before = problems.length;
  const given: Partial<RoleColors> = {};
  for (const [key, value] of Object.entries(table)) {
    const color = parse_color(value);
    if (!is_role(key)) problems.push(`${file}: [${variant}] ${key}: unknown role (valid: ${ROLES.join(", ")})`);
    else if (color === undefined) problems.push(`${file}: [${variant}] ${key}: expected a color as #rgb or #rrggbb, got ${JSON.stringify(value)}`);
    else given[key] = color;
  }
  for (const role of REQUIRED_ROLES) {
    if (!Object.hasOwn(table, role)) problems.push(`${file}: [${variant}]: missing required role ${role}`);
  }
  return problems.length === problems_before ? derive_roles(given as GivenColors, variant) : undefined;
}

// A file with one table serves both system settings. That table still derives with its own variant's status colors.
export function check_theme_file(file: string, data: Record<string, unknown>, problems: string[]): Theme | undefined {
  const problems_before = problems.length;
  for (const key of Object.keys(data)) {
    if (!(VARIANTS as readonly string[]).includes(key)) problems.push(`${file}: [${key}]: unknown table (known: ${VARIANTS.join(", ")})`);
  }
  const present = VARIANTS.filter((variant) => Object.hasOwn(data, variant));
  if (present.length === 0) {
    problems.push(`${file}: needs a [dark] table, a [light] table or both`);
    return undefined;
  }
  const colors: Partial<Theme> = {};
  for (const variant of present) {
    const table_colors = check_table(file, variant, data[variant], problems);
    if (table_colors) colors[variant] = table_colors;
  }
  if (problems.length > problems_before) return undefined;
  const only = colors[present[0]!]!;
  return { dark: colors.dark ?? only, light: colors.light ?? only };
}
