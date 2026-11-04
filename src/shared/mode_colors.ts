// Mode badge colors from the palette setting, which names a theme.
// A badge is the theme's `mode_*` role with `bg_core` as the text, so the page badge matches the editor.

import type { LightIntensity, OasisTheme, Theme } from "./theme/roles.ts";
import { OASIS_THEMES, REPO_THEMES } from "./themes.ts";

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

function oasis_theme_at(theme: OasisTheme, light_intensity: LightIntensity): Theme {
  return { dark: theme.dark, light: theme.light[light_intensity] };
}

// Every name `palette` accepts apart from the user's own theme files: the Oasis themes, then the contributed ones.
// A function, not a constant: a constant made of the tables cannot be tree-shaken, and the content script imports this module through the barrel.
export function built_in_theme_names(): string[] {
  return [...Object.keys(OASIS_THEMES), ...Object.keys(REPO_THEMES)];
}

// A local theme wins over a built-in one of the same name. Only an Oasis theme has light intensities.
// Undefined when the name finds nothing.
export function palette_mode_colors(name: string, light_intensity: LightIntensity, local_theme?: LocalTheme): ModeColors | undefined {
  if (local_theme?.name === name && has_badge_roles(local_theme.colors)) return mode_colors_of_theme(local_theme.colors);
  if (Object.hasOwn(REPO_THEMES, name)) return mode_colors_of_theme(REPO_THEMES[name]!);
  if (Object.hasOwn(OASIS_THEMES, name)) return mode_colors_of_theme(oasis_theme_at(OASIS_THEMES[name]!, light_intensity));
  return undefined;
}
