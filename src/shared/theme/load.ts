// Finds the theme a `palette` name stands for. Only the background imports this module: it holds every theme table.

import { DEFAULT_LIGHT_INTENSITY } from "../config.ts";
import { OASIS_THEMES, REPO_THEMES } from "../themes.ts";
import { BUILT_IN_THEME_NAMES } from "../theme_names.ts";
import { LIGHT_INTENSITIES, ROLES } from "./roles.ts";
import type { LightIntensity, LocalTheme, OasisTheme, RoleColors, Theme } from "./roles.ts";
import { COLOR_FORMATS, parse_color } from "./theme_file.ts";

// Managed storage can be edited by hand, so a local theme's shape is not taken on trust. Every role is needed, because the
// stored theme sets every token and a missing one would leave a surface on its fallback. A value that is not a color
// would be published as an invalid CSS declaration, so it fails the same check the theme files pass. Returns the first
// problem as text, or undefined when the theme is usable.
export function local_theme_problem(colors: unknown): string | undefined {
  for (const variant of ["dark", "light"] as const) {
    const table = (colors as Record<string, unknown> | null | undefined)?.[variant];
    if (typeof table !== "object" || table === null) return `[${variant}] is not a table`;
    for (const role of ROLES) {
      const value = (table as Record<string, unknown>)[role];
      if (value === undefined) return `[${variant}] is missing ${role}`;
      if (parse_color(value) === undefined) return `[${variant}] ${role} is ${JSON.stringify(value)}, not a color as ${COLOR_FORMATS}`;
    }
  }
  return undefined;
}

const has_all_roles = (colors: unknown): colors is Theme => local_theme_problem(colors) === undefined;

const unpack = (colors: readonly string[]) => Object.fromEntries(ROLES.map((role, at) => [role, colors[at]])) as RoleColors;

// The Oasis theme of a name, every set filled. Undefined when the name is not one.
export function oasis_theme(name: string): OasisTheme | undefined {
  if (!Object.hasOwn(OASIS_THEMES, name)) return undefined;
  const packed = OASIS_THEMES[name]!;
  return { dark: unpack(packed.dark), light: Object.fromEntries(LIGHT_INTENSITIES.map((intensity) => [intensity, unpack(packed.light[intensity])])) as OasisTheme["light"] };
}

// Every name `palette` accepts apart from the user's own theme files: the Oasis themes, then the contributed ones.
export function built_in_theme_names(): string[] {
  return [...BUILT_IN_THEME_NAMES];
}

// A local theme wins over a built-in one of the same name. Only an Oasis theme has light intensities.
// Undefined when the name finds nothing.
export function load_theme(name: string, light_intensity: LightIntensity, local_theme?: LocalTheme): Theme | undefined {
  if (local_theme?.name === name && has_all_roles(local_theme.colors)) return local_theme.colors;
  if (Object.hasOwn(REPO_THEMES, name)) return REPO_THEMES[name]!;
  const oasis = oasis_theme(name);
  // A light_intensity outside 1 to 5 can come from a hand-edited managed config, so it falls back to the middle set instead of throwing.
  return oasis && { dark: oasis.dark, light: oasis.light[light_intensity] ?? oasis.light[DEFAULT_LIGHT_INTENSITY] };
}
