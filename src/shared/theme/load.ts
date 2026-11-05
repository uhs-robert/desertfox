// Finds the theme a `palette` name stands for. Only the background imports this module: it holds every theme table.

import { DEFAULT_LIGHT_INTENSITY } from "../config.ts";
import type { LocalTheme } from "../mode_colors.ts";
import { OASIS_THEMES, REPO_THEMES } from "../themes.ts";
import { LIGHT_INTENSITIES, ROLES } from "./roles.ts";
import type { LightIntensity, OasisTheme, RoleColors, Theme } from "./roles.ts";

// Managed storage can be edited by hand, so a local theme's shape is not taken on trust. Every role is needed, because the
// stored theme sets every token and a missing one would leave a surface on its fallback.
function has_all_roles(colors: unknown): colors is Theme {
  const variant_usable = (variant: unknown) => typeof variant === "object" && variant !== null && ROLES.every((role) => typeof (variant as Record<string, unknown>)[role] === "string");
  return typeof colors === "object" && colors !== null && variant_usable((colors as Theme).dark) && variant_usable((colors as Theme).light);
}

const unpack = (colors: readonly string[]) => Object.fromEntries(ROLES.map((role, at) => [role, colors[at]])) as RoleColors;

// The Oasis theme of a name, every set filled. Undefined when the name is not one.
export function oasis_theme(name: string): OasisTheme | undefined {
  if (!Object.hasOwn(OASIS_THEMES, name)) return undefined;
  const packed = OASIS_THEMES[name]!;
  return { dark: unpack(packed.dark), light: Object.fromEntries(LIGHT_INTENSITIES.map((intensity) => [intensity, unpack(packed.light[intensity])])) as OasisTheme["light"] };
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
