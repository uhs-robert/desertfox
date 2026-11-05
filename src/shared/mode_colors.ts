// Mode badge colors from the palette setting, which names a theme.
// A badge is the theme's `mode_*` role with `bg_core` as the text, so the page badge matches the editor.

import { load_theme } from "./theme/load.ts";
import type { LightIntensity, Theme } from "./theme/roles.ts";
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

// Every name `palette` accepts apart from the user's own theme files: the Oasis themes, then the contributed ones.
// A function, not a constant: a constant made of the tables cannot be tree-shaken, and the content script imports this module through the barrel.
export function built_in_theme_names(): string[] {
  return [...BUILT_IN_THEME_NAMES];
}

// Undefined when the name finds nothing.
export function palette_mode_colors(name: string, light_intensity: LightIntensity, local_theme?: LocalTheme): ModeColors | undefined {
  const theme = load_theme(name, light_intensity, local_theme);
  return theme && mode_colors_of_theme(theme);
}
