// Mode badge colors from the palette setting, which names a theme.
// The 16 oasis.nvim palettes below are not theme files yet, so a name falls through to them last.
// Their badges keep today's look, so the page badge matches the editor.
// Each palette keeps seven colors per variant, in the order of PaletteColors. They are the ones
// oasis.nvim's lualine theme uses: its normal, insert, visual and command section colors, the core
// and surface backgrounds, and the dim foreground. Every palette has all of them.

import type { Theme } from "./theme/roles.ts";
import { REPO_THEMES } from "./themes.ts";

export const PALETTE_NAMES = [
  "abyss", "cactus", "canyon", "desert", "dune", "lagoon", "luna", "midnight",
  "mirage", "moonlight", "night", "rose", "scorpion", "sol", "starlight", "twilight",
] as const;
export type PaletteName = (typeof PALETTE_NAMES)[number];

export const DEFAULT_PALETTE: PaletteName = "moonlight";

export const MODE_COLOR_MODES = ["normal", "insert", "ignore", "caret", "visual"] as const;
export type ModeColorMode = (typeof MODE_COLOR_MODES)[number];

// Background first, then text.
export type ColorPair = [bg: string, fg: string];
export type ModeColors = Record<ModeColorMode, { dark: ColorPair; light: ColorPair }>;

type PaletteColors = [normal: string, insert: string, core: string, surface: string, dim: string, visual: string, command: string];

const PALETTES: Record<PaletteName, { dark: PaletteColors; light: PaletteColors }> = {
  abyss: { dark: ["#d8cf7f", "#ffa0a0", "#000000", "#1c1c1c", "#7b786d", "#ffba75", "#7fcf78"], light: ["#5b541d", "#870f13", "#d8d8d8", "#b9b9b9", "#7c7a74", "#793f0d", "#315e2d"] },
  cactus: { dark: ["#7fbb82", "#ffa0a0", "#151e17", "#2f3d33", "#748477", "#ffba75", "#ffd05c"], light: ["#2a4e2c", "#9c1116", "#dcefe3", "#b2dcc1", "#818982", "#8a480f", "#7c5912"] },
  canyon: { dark: ["#f9af96", "#ffa0a0", "#261612", "#483228", "#897c75", "#ffba75", "#7fcf78"], light: ["#703c08", "#860f13", "#eed3bd", "#e1b38c", "#807975", "#793f0d", "#305e2d"] },
  desert: { dark: ["#f0e68c", "#ffa0a0", "#262626", "#404040", "#878478", "#ffba75", "#7fcf78"], light: ["#685f10", "#9e1116", "#f3edcf", "#e7db9e", "#8a8882", "#8c490f", "#386c33"] },
  dune: { dark: ["#d8cf7f", "#ffa0a0", "#27211b", "#463e34", "#8e837a", "#ffba75", "#7fcf78"], light: ["#5b541d", "#9c1116", "#f7e9d4", "#edcfa0", "#8c8682", "#8a480f", "#376b33"] },
  lagoon: { dark: ["#71b8ff", "#ffa0a0", "#101825", "#22385c", "#727f86", "#ffba75", "#7fcf78"], light: ["#023c75", "#9a1115", "#dceafa", "#a6caf2", "#80878a", "#88470f", "#366a32"] },
  luna: { dark: ["#8d8de7", "#ffa0a0", "#0d0d2b", "#211d4e", "#7c788c", "#ffba75", "#7fcf78"], light: ["#1e1e81", "#931014", "#e2e0f8", "#b3aeed", "#82808a", "#82440e", "#346530"] },
  midnight: { dark: ["#d8cf7f", "#ffa0a0", "#0c0e13", "#1e2a38", "#6f7a83", "#ffba75", "#7fcf78"], light: ["#5b541d", "#8e0f14", "#d9dee8", "#b3bdd1", "#797f84", "#7e420e", "#33622f"] },
  mirage: { dark: ["#69c3aa", "#ffa0a0", "#111c22", "#21333b", "#738281", "#ffba75", "#7fcf78"], light: ["#235547", "#9e1116", "#d8f2ef", "#aae3dc", "#828a89", "#8c490f", "#386c33"] },
  moonlight: { dark: ["#7fa3c9", "#ffa0a0", "#0c0e13", "#1e2a38", "#717a84", "#ffba75", "#7fcf78"], light: ["#253b53", "#951015", "#e8e5d8", "#d1cbb2", "#7f8489", "#85460e", "#356731"] },
  night: { dark: ["#7fa3c9", "#ffa0a0", "#08111c", "#182a46", "#727b85", "#ffba75", "#7fcf78"], light: ["#253b53", "#901014", "#d1e2f5", "#9ec2eb", "#7c8186", "#80430e", "#34642f"] },
  rose: { dark: ["#e6a4be", "#ffa0a0", "#2c1724", "#4e3747", "#8c7d86", "#ffba75", "#7fcf78"], light: ["#5d1b35", "#8e0f14", "#f3d6e8", "#e5a7cd", "#847c81", "#7f420e", "#33622f"] },
  scorpion: { dark: ["#f7997d", "#ffa0a0", "#1a0500", "#361d17", "#837570", "#ffba75", "#7fcf78"], light: ["#922b0c", "#860f13", "#f4cfc3", "#eba68f", "#807875", "#783f0d", "#305d2c"] },
  sol: { dark: ["#ff7979", "#d8cf7f", "#271311", "#432823", "#7e7e7e", "#ffba75", "#7fcf78"], light: ["#750202", "#423d1b", "#f2c4c4", "#e79292", "#747474", "#703b0c", "#2d582a"] },
  starlight: { dark: ["#5badff", "#ff9090", "#000000", "#1c2028", "#6e7d81", "#ffba75", "#7fcf78"], light: ["#023c75", "#a41217", "#f5f2ea", "#e1d8c1", "#868d90", "#914c10", "#3a7035"] },
  twilight: { dark: ["#f7997d", "#ffa0a0", "#1b1320", "#362343", "#7f7a8d", "#ffba75", "#7fcf78"], light: ["#6f2009", "#931014", "#eadff4", "#ccb1e4", "#83808a", "#83450e", "#346630"] },
};

export function is_palette_name(value: unknown): value is PaletteName {
  return (PALETTE_NAMES as readonly unknown[]).includes(value);
}

// The theme a user's config directory holds under the palette's name, filled by tools/build-config.
export type LocalTheme = { name: string; colors: Theme };

// Caret mode takes the lualine command colors and visual mode the visual ones.
// Ignore mode takes the lualine inactive colors: it has no editor twin, and a muted badge says the editor is not driving the page.
function pair_of(colors: PaletteColors, mode: ModeColorMode): ColorPair {
  const [normal, insert, core, surface, dim, visual, command] = colors;
  if (mode === "normal") return [normal, core];
  if (mode === "insert") return [insert, core];
  if (mode === "visual") return [visual, core];
  if (mode === "caret") return [command, core];
  return [surface, dim];
}

export function resolve_mode_colors(palette: PaletteName): ModeColors {
  const { dark, light } = PALETTES[palette];
  const colors_of = (mode: ModeColorMode) => ({ dark: pair_of(dark, mode), light: pair_of(light, mode) });
  return Object.fromEntries(MODE_COLOR_MODES.map((mode) => [mode, colors_of(mode)])) as ModeColors;
}

// A theme badge is its mode role with `bg` as the text.
export function mode_colors_of_theme(theme: Theme): ModeColors {
  const colors_of = (mode: ModeColorMode) => ({
    dark: [theme.dark[`mode_${mode}`], theme.dark.bg] as ColorPair,
    light: [theme.light[`mode_${mode}`], theme.light.bg] as ColorPair,
  });
  return Object.fromEntries(MODE_COLOR_MODES.map((mode) => [mode, colors_of(mode)])) as ModeColors;
}

// A local theme wins over a repo theme of the same name. Undefined when the name finds nothing.
export function palette_mode_colors(name: string, local_theme?: LocalTheme): ModeColors | undefined {
  // Managed storage can be edited by hand, so the local theme's shape is not taken on trust.
  const local_usable = local_theme?.name === name && typeof local_theme.colors?.dark === "object" && typeof local_theme.colors?.light === "object";
  if (local_usable) return mode_colors_of_theme(local_theme.colors);
  if (Object.hasOwn(REPO_THEMES, name)) return mode_colors_of_theme(REPO_THEMES[name]!);
  return is_palette_name(name) ? resolve_mode_colors(name) : undefined;
}
