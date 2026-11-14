// Finds the theme a `theme` name stands for. Only the background imports this module: it holds every theme table.

import { DEFAULT_LIGHT_INTENSITY } from "../config.ts";
import { OASIS_THEMES, REPO_THEMES } from "../themes.ts";
import { BUILT_IN_THEME_NAMES } from "../theme_names.ts";
import { LIGHT_INTENSITIES, ROLES } from "./roles.ts";
import type { LightIntensity, OasisTheme, RoleColors, Theme } from "./roles.ts";
import { local_theme_problem, parse_color } from "./theme_file.ts";

export { local_theme_problem } from "./theme_file.ts";

const has_all_roles = (colors: unknown): colors is Theme => local_theme_problem(colors) === undefined;

const as_hex = (colors: RoleColors) => Object.fromEntries(ROLES.map((role) => [role, parse_color(colors[role])])) as RoleColors;

const unpack = (colors: readonly string[]) => Object.fromEntries(ROLES.map((role, at) => [role, colors[at]])) as RoleColors;

// The Oasis theme of a name, every set filled. Undefined when the name is not one.
export function oasis_theme(name: string): OasisTheme | undefined {
  if (!Object.hasOwn(OASIS_THEMES, name)) return undefined;
  const packed = OASIS_THEMES[name]!;
  return { dark: unpack(packed.dark), light: Object.fromEntries(LIGHT_INTENSITIES.map((intensity) => [intensity, unpack(packed.light[intensity])])) as OasisTheme["light"] };
}

// Every name `theme` accepts apart from the user's own theme files: the Oasis themes, then the contributed ones.
export function built_in_theme_names(): string[] {
  return [...BUILT_IN_THEME_NAMES];
}

// A local theme (a theme file or an import) wins over a built-in one of the same name. Only an Oasis theme has light intensities.
// Undefined when the name finds nothing.
export function load_theme(name: string, light_intensity: LightIntensity, local_themes?: Record<string, Theme>): Theme | undefined {
  const local = local_themes && Object.hasOwn(local_themes, name) ? local_themes[name] : undefined;
  if (has_all_roles(local)) return { dark: as_hex(local.dark), light: as_hex(local.light) };
  if (Object.hasOwn(REPO_THEMES, name)) return REPO_THEMES[name]!;
  const oasis = oasis_theme(name);
  // A light_intensity outside 1 to 5 can come from a hand-edited config, so it falls back to the middle set instead of throwing.
  return oasis && { dark: oasis.dark, light: oasis.light[light_intensity] ?? oasis.light[DEFAULT_LIGHT_INTENSITY] };
}
