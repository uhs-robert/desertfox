// Checks one parsed theme file and fills it into a full theme. `just themes` reads the repo `themes/`
// with it and `tools/build-config` reads the user's, so both report the same errors.

import { derive_roles } from "./derive.ts";
import type { GivenColors } from "./derive.ts";
import { is_role, REQUIRED_ROLES, ROLES, VARIANTS } from "./roles.ts";
import type { RoleColors, Theme, Variant } from "./roles.ts";

export const COLOR_FORMATS = "#rgb, #rrggbb, rgb(), rgba() with alpha 1, or hsl()";

const hex_pair = (channel: number) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0");
const NUMBER = "(-?\\d*\\.?\\d+)";
const FUNCTION_COLOR = new RegExp(`^(rgba?|hsla?)\\(\\s*${NUMBER}(%?)(?:deg)?\\s*[,\\s]\\s*${NUMBER}(%?)\\s*[,\\s]\\s*${NUMBER}(%?)\\s*(?:[,/]\\s*${NUMBER}(%?)\\s*)?\\)$`, "i");

// A color as #rrggbb. Hex, rgb(), rgba() and hsl() are accepted, because derivation does color math on the value. An alpha other than 1 is refused,
// since the roles are opaque. Named colors are not accepted.
export function parse_color(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const match = FUNCTION_COLOR.exec(value.trim());
  if (!match) return undefined;
  const [, name, first, , second, second_percent, third, third_percent, alpha, alpha_percent] = match;
  if (alpha !== undefined && Number(alpha) / (alpha_percent ? 100 : 1) !== 1) return undefined;
  const [one, two, three] = [Number(first), Number(second), Number(third)];
  if (name!.toLowerCase().startsWith("rgb")) {
    if (match[3] !== match[5] || match[5] !== match[7]) return undefined;
    const scale = match[3] ? 2.55 : 1;
    return `#${hex_pair(one * scale)}${hex_pair(two * scale)}${hex_pair(three * scale)}`;
  }
  if (!second_percent || !third_percent || match[3]) return undefined;
  const saturation = Math.min(100, Math.max(0, two)) / 100;
  const lightness = Math.min(100, Math.max(0, three)) / 100;
  const chroma = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const position = (offset + (((one % 360) + 360) % 360) / 30) % 12;
    return (lightness - chroma * Math.max(-1, Math.min(position - 3, 9 - position, 1))) * 255;
  };
  return `#${hex_pair(channel(0))}${hex_pair(channel(8))}${hex_pair(channel(4))}`;
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
    else if (color === undefined) problems.push(`${file}: [${variant}] ${key}: expected a color as ${COLOR_FORMATS}, got ${JSON.stringify(value)}`);
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
