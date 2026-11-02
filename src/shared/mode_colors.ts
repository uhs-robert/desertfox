// Mode badge colors from the oasis.nvim palettes, so the page badge matches the editor.
// Each palette keeps five colors per variant, in the order of PALETTE_COLOR_ORDER. They are the ones
// oasis.nvim's lualine theme uses: its normal and insert section colors, the core and surface
// backgrounds, and the dim foreground.

export const PALETTE_NAMES = [
  "abyss", "cactus", "canyon", "desert", "dune", "lagoon", "luna", "midnight",
  "mirage", "moonlight", "night", "rose", "scorpion", "sol", "starlight", "twilight",
] as const;
export type PaletteName = (typeof PALETTE_NAMES)[number];

export const DEFAULT_PALETTE: PaletteName = "moonlight";

export const MODE_COLOR_MODES = ["normal", "insert", "ignore"] as const;
export type ModeColorMode = (typeof MODE_COLOR_MODES)[number];

// Background first, then text.
export type ColorPair = [bg: string, fg: string];
export type ModeColors = Record<ModeColorMode, { dark: ColorPair; light: ColorPair }>;

type PaletteColors = [normal: string, insert: string, core: string, surface: string, dim: string];

const PALETTES: Record<PaletteName, { dark: PaletteColors; light: PaletteColors }> = {
  abyss: { dark: ["#d8cf7f", "#ffa0a0", "#000000", "#1c1c1c", "#7b786d"], light: ["#5b541d", "#870f13", "#d8d8d8", "#b9b9b9", "#7c7a74"] },
  cactus: { dark: ["#7fbb82", "#ffa0a0", "#151e17", "#2f3d33", "#748477"], light: ["#2a4e2c", "#9c1116", "#dcefe3", "#b2dcc1", "#818982"] },
  canyon: { dark: ["#f9af96", "#ffa0a0", "#261612", "#483228", "#897c75"], light: ["#703c08", "#860f13", "#eed3bd", "#e1b38c", "#807975"] },
  desert: { dark: ["#f0e68c", "#ffa0a0", "#262626", "#404040", "#878478"], light: ["#685f10", "#9e1116", "#f3edcf", "#e7db9e", "#8a8882"] },
  dune: { dark: ["#d8cf7f", "#ffa0a0", "#27211b", "#463e34", "#8e837a"], light: ["#5b541d", "#9c1116", "#f7e9d4", "#edcfa0", "#8c8682"] },
  lagoon: { dark: ["#71b8ff", "#ffa0a0", "#101825", "#22385c", "#727f86"], light: ["#023c75", "#9a1115", "#dceafa", "#a6caf2", "#80878a"] },
  luna: { dark: ["#8d8de7", "#ffa0a0", "#0d0d2b", "#211d4e", "#7c788c"], light: ["#1e1e81", "#931014", "#e2e0f8", "#b3aeed", "#82808a"] },
  midnight: { dark: ["#d8cf7f", "#ffa0a0", "#0c0e13", "#1e2a38", "#6f7a83"], light: ["#5b541d", "#8e0f14", "#d9dee8", "#b3bdd1", "#797f84"] },
  mirage: { dark: ["#69c3aa", "#ffa0a0", "#111c22", "#21333b", "#738281"], light: ["#235547", "#9e1116", "#d8f2ef", "#aae3dc", "#828a89"] },
  moonlight: { dark: ["#7fa3c9", "#ffa0a0", "#0c0e13", "#1e2a38", "#717a84"], light: ["#253b53", "#951015", "#e8e5d8", "#d1cbb2", "#7f8489"] },
  night: { dark: ["#7fa3c9", "#ffa0a0", "#08111c", "#182a46", "#727b85"], light: ["#253b53", "#901014", "#d1e2f5", "#9ec2eb", "#7c8186"] },
  rose: { dark: ["#e6a4be", "#ffa0a0", "#2c1724", "#4e3747", "#8c7d86"], light: ["#5d1b35", "#8e0f14", "#f3d6e8", "#e5a7cd", "#847c81"] },
  scorpion: { dark: ["#f7997d", "#ffa0a0", "#1a0500", "#361d17", "#837570"], light: ["#922b0c", "#860f13", "#f4cfc3", "#eba68f", "#807875"] },
  sol: { dark: ["#ff7979", "#d8cf7f", "#271311", "#432823", "#7e7e7e"], light: ["#750202", "#423d1b", "#f2c4c4", "#e79292", "#747474"] },
  starlight: { dark: ["#5badff", "#ff9090", "#000000", "#1c2028", "#6e7d81"], light: ["#023c75", "#a41217", "#f5f2ea", "#e1d8c1", "#868d90"] },
  twilight: { dark: ["#f7997d", "#ffa0a0", "#1b1320", "#362343", "#7f7a8d"], light: ["#6f2009", "#931014", "#eadff4", "#ccb1e4", "#83808a"] },
};

export function is_palette_name(value: unknown): value is PaletteName {
  return (PALETTE_NAMES as readonly unknown[]).includes(value);
}

// A name the config check did not catch still gets a working badge.
export function palette_or_default(value: unknown): PaletteName {
  return is_palette_name(value) ? value : DEFAULT_PALETTE;
}

// Ignore mode takes the lualine inactive colors: it has no editor twin, and a muted badge says the editor is not driving the page.
function pair_of(colors: PaletteColors, mode: ModeColorMode): ColorPair {
  const [normal, insert, core, surface, dim] = colors;
  if (mode === "normal") return [normal, core];
  if (mode === "insert") return [insert, core];
  return [surface, dim];
}

export function resolve_mode_colors(palette: PaletteName): ModeColors {
  const { dark, light } = PALETTES[palette];
  const colors_of = (mode: ModeColorMode) => ({ dark: pair_of(dark, mode), light: pair_of(light, mode) });
  return { normal: colors_of("normal"), insert: colors_of("insert"), ignore: colors_of("ignore") };
}
