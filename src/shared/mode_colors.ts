// Mode badge colors from the palette setting, which names a theme.
// A badge is the theme's `mode_*` role with `bg_core` as the text, so the page badge matches the editor.

import { DEFAULT_LIGHT_INTENSITY } from "./config.ts";
import { LIGHT_INTENSITIES, ROLES } from "./theme/roles.ts";
import type { LightIntensity, OasisTheme, RoleColors, Theme } from "./theme/roles.ts";
import { OASIS_THEMES, REPO_THEMES } from "./themes.ts";
import { BUILT_IN_THEME_NAMES } from "./theme_names.ts";

export const MODE_COLOR_MODES = ["normal", "insert", "ignore", "caret", "visual"] as const;
export type ModeColorMode = (typeof MODE_COLOR_MODES)[number];

// Background first, then text.
export type ColorPair = [bg: string, fg: string];
export type ModeColors = Record<ModeColorMode, { dark: ColorPair; light: ColorPair }>;

// The theme a user's config directory holds under the palette's name, filled by tools/build-config.
export type LocalTheme = { name: string; colors: Theme };

// A theme badge is its mode role with `bg_core` as the text.
export function mode_colors_of_theme(theme: Theme): ModeColors {
  const colors_of = (mode: ModeColorMode) => ({
    dark: [theme.dark[`mode_${mode}`], theme.dark.bg_core] as ColorPair,
    light: [theme.light[`mode_${mode}`], theme.light.bg_core] as ColorPair,
  });
  return Object.fromEntries(MODE_COLOR_MODES.map((mode) => [mode, colors_of(mode)])) as ModeColors;
}

// Managed storage can be edited by hand, so a local theme's shape is not taken on trust.
function has_badge_roles(colors: unknown): colors is Theme {
  const badge_roles = ["bg_core", ...MODE_COLOR_MODES.map((mode) => `mode_${mode}`)];
  const variant_usable = (variant: unknown) =>
    typeof variant === "object" && variant !== null && badge_roles.every((role) => typeof (variant as Record<string, unknown>)[role] === "string");
  return typeof colors === "object" && colors !== null && variant_usable((colors as Theme).dark) && variant_usable((colors as Theme).light);
}

const unpack = (colors: readonly string[]) => Object.fromEntries(ROLES.map((role, at) => [role, colors[at]])) as RoleColors;

// The Oasis theme of a name, every set filled. Undefined when the name is not one.
export function oasis_theme(name: string): OasisTheme | undefined {
  if (!Object.hasOwn(OASIS_THEMES, name)) return undefined;
  const packed = OASIS_THEMES[name]!;
  return { dark: unpack(packed.dark), light: Object.fromEntries(LIGHT_INTENSITIES.map((intensity) => [intensity, unpack(packed.light[intensity])])) as OasisTheme["light"] };
}

// Every name `palette` accepts apart from the user's own theme files: the Oasis themes, then the contributed ones.
// A function, not a constant: a constant made of the tables cannot be tree-shaken, and the content script imports this module through the barrel.
export function built_in_theme_names(): string[] {
  return [...BUILT_IN_THEME_NAMES];
}

// A local theme wins over a built-in one of the same name. Only an Oasis theme has light intensities.
// Undefined when the name finds nothing.
export function palette_mode_colors(name: string, light_intensity: LightIntensity, local_theme?: LocalTheme): ModeColors | undefined {
  if (local_theme?.name === name && has_badge_roles(local_theme.colors)) return mode_colors_of_theme(local_theme.colors);
  if (Object.hasOwn(REPO_THEMES, name)) return mode_colors_of_theme(REPO_THEMES[name]!);
  const oasis = oasis_theme(name);
  // A light_intensity outside 1 to 5 can come from a hand-edited managed config, so it falls back to the middle set instead of throwing.
  return oasis && mode_colors_of_theme({ dark: oasis.dark, light: oasis.light[light_intensity] ?? oasis.light[DEFAULT_LIGHT_INTENSITY] });
}
