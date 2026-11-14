// Compiles the repo themes into src/shared/themes.ts, so the extension never parses TOML or CSS.
// Two sources: `themes/oasis/*.css`, byte copies of the oasis.nvim CSS files, and `themes/*.toml`, contributed theme files.
// Usage: node tools/build_themes.ts --write | --check [--out path]

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { read_theme_dir } from "./build-config/theme_dir.ts";
import { LIGHT_INTENSITIES, ROLES } from "../src/shared/theme/roles.ts";
import type { LightIntensity, OasisTheme, PackedOasisTheme, Role, RoleColors } from "../src/shared/theme/roles.ts";
import { parse_color } from "../src/shared/theme/theme_file.ts";

// The one table of which oasis.nvim variable fills each role. A variable name drops the `--oasis-` prefix.
// A list is tried in order, for the files that lack the first. Mode roles follow lualine's color pairs (lua/lualine/themes/_oasis.lua):
// luna and scorpion define `theme-status` for normal mode, the rest use `theme-primary`.
const ROLE_VARIABLES: Record<Role, string[]> = {
  bg_core: ["bg-core"],
  bg_mantle: ["bg-mantle"],
  bg_crust: ["bg-crust"],
  selection: ["ui-visual-bg"],
  fg_core: ["fg-core"],
  fg_comment: ["fg-comment"],
  fg_dim: ["fg-dim"],
  fg_muted: ["fg-muted"],
  primary: ["theme-primary"],
  secondary: ["theme-secondary"],
  accent: ["theme-accent"],
  border: ["ui-border"],
  error: ["ui-diag-error-fg"],
  warn: ["ui-diag-warn-fg"],
  ok: ["ui-diag-ok-fg"],
  info: ["ui-diag-info-fg"],
  mode_normal: ["theme-status", "theme-primary"],
  mode_insert: ["syntax-string"],
  mode_ignore: ["fg-dim"],
  mode_caret: ["theme-cursor"],
  mode_visual: ["syntax-special"],
  search_bg: ["ui-search-bg"],
  search_fg: ["ui-search-fg"],
  search_current_bg: ["ui-match-bg"],
  search_current_fg: ["ui-match-fg"],
};

const root = new URL("../", import.meta.url);
const out_flag = process.argv.indexOf("--out");
const module_path = out_flag >= 0 ? process.argv[out_flag + 1]! : fileURLToPath(new URL("src/shared/themes.ts", root));
const write = process.argv.includes("--write");
if (write === process.argv.includes("--check")) {
  console.error("usage: node tools/build_themes.ts --write | --check [--out path]");
  process.exit(2);
}

const problems: string[] = [];
const themes_dir = fileURLToPath(new URL("themes", root));

const FG_DIM_MIN_CONTRAST = 3;

function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(color.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light! + 0.05) / (dark! + 0.05);
}

function rgb_to_hsl(color: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const span = max - min;
  const saturation = span / (1 - Math.abs(2 * lightness - 1));
  const hue = max === r ? ((g - b) / span + 6) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return [hue * 60, saturation, lightness];
}

function hsl_to_rgb(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    return lightness - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${[0, 8, 4].map((offset) => Math.round(channel(offset) * 255).toString(16).padStart(2, "0")).join("")}`;
}

// The oasis.nvim files carry some fg-dim values under 3:1 (luna light 5 is 2.52) and the files stay byte copies, so the build raises them.
// Only lightness moves, away from the backgrounds, so the hue and saturation stay.
function clamp_fg_dim(colors: RoleColors): string {
  const backgrounds = [colors.bg_core, colors.bg_mantle];
  const enough = (color: string) => backgrounds.every((background) => contrast(color, background) >= FG_DIM_MIN_CONTRAST);
  if (enough(colors.fg_dim)) return colors.fg_dim;
  const [hue, saturation, lightness] = rgb_to_hsl(colors.fg_dim);
  const lighter_first = !backgrounds.every((background) => luminance(background) > luminance(colors.fg_dim));
  // Backgrounds on opposite sides of fg_dim leave no safe direction, so the second direction is the fallback.
  for (const step of lighter_first ? [0.002, -0.002] : [-0.002, 0.002]) {
    for (let next = lightness; next >= 0 && next <= 1; next += step) {
      const candidate = hsl_to_rgb(hue, saturation, next);
      if (enough(candidate)) return candidate;
    }
  }
  problems.push(`${colors.fg_dim}: fg_dim cannot reach ${FG_DIM_MIN_CONTRAST}:1 on ${backgrounds.join(" and ")}`);
  return colors.fg_dim;
}

function colors_of_css(path: string): RoleColors | undefined {
  const text = readFileSync(path, "utf8");
  const problems_before = problems.length;
  const colors = {} as RoleColors;
  for (const role of ROLES) {
    const names = ROLE_VARIABLES[role];
    const found = names.map((name) => new RegExp(`^\\s*--oasis-${name}:\\s*([^;]+);`, "m").exec(text)?.[1]).find((value) => value !== undefined);
    const color = parse_color(found);
    if (color === undefined) problems.push(`${path}: ${role}: expected a hex color in --oasis-${names.join(" or --oasis-")}, got ${JSON.stringify(found)}`);
    else colors[role] = color;
  }
  if (problems.length > problems_before) return undefined;
  // mode_ignore reads the same variable as fg_dim and follows the clamp.
  const clamped = clamp_fg_dim(colors);
  if (colors.mode_ignore === colors.fg_dim) colors.mode_ignore = clamped;
  colors.fg_dim = clamped;
  return problems.length === problems_before ? colors : undefined;
}

// File names are `oasis_<name>_dark.css` and `oasis_<name>_light_<intensity>.css`. The theme name keeps the `oasis_` prefix.
function read_oasis_css(dir: string): Record<string, OasisTheme> {
  const found: Record<string, { dark: RoleColors | undefined; light: Partial<Record<LightIntensity, RoleColors>> }> = {};
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".css")).sort() : [];
  for (const file of files) {
    const match = /^(oasis_[a-z]+)_(?:dark|light_([1-5]))\.css$/.exec(file);
    if (!match) {
      problems.push(`${join(dir, file)}: unexpected file name, expected oasis_<name>_dark.css or oasis_<name>_light_<1-5>.css`);
      continue;
    }
    const colors = colors_of_css(join(dir, file));
    if (!colors) continue;
    const entry = (found[match[1]!] ??= { dark: undefined, light: {} });
    if (match[2]) entry.light[Number(match[2]) as LightIntensity] = colors;
    else entry.dark = colors;
  }
  const themes: Record<string, OasisTheme> = {};
  for (const [name, entry] of Object.entries(found)) {
    const missing = [...(entry.dark ? [] : ["dark"]), ...LIGHT_INTENSITIES.filter((intensity) => !entry.light[intensity]).map((intensity) => `light_${intensity}`)];
    if (missing.length > 0) problems.push(`${dir}: ${name} lacks ${missing.join(", ")}`);
    else themes[name] = entry as OasisTheme;
  }
  return themes;
}

const oasis_themes = read_oasis_css(join(themes_dir, "oasis"));
const repo_themes = read_theme_dir(themes_dir, problems, ["README.md", "NOTICE.md", "LICENSE-Apache-2.0.txt", "oasis"]);
for (const name of Object.keys(repo_themes)) {
  if (Object.hasOwn(oasis_themes, name)) problems.push(`themes/${name}.toml: the name belongs to a built-in Oasis theme`);
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}

// One line per set: the colors in ROLES order, which OASIS_ROLE_ORDER repeats so a reorder of ROLES fails a test instead of silently shifting colors.
const packed_line = (colors: RoleColors) => JSON.stringify(ROLES.map((role) => colors[role]));
const packed_themes = Object.entries(oasis_themes)
  .map(([name, theme]) => {
    const light = LIGHT_INTENSITIES.map((intensity) => `      ${intensity}: ${packed_line(theme.light[intensity])},`).join("\n");
    return `  ${JSON.stringify(name)}: {\n    dark: ${packed_line(theme.dark)},\n    light: {\n${light}\n    },\n  },`;
  })
  .join("\n");

const next = `// Generated by tools/build_themes.ts from themes/oasis/*.css and themes/*.toml. Run \`just themes\` after a change there.

import type { PackedOasisTheme, Theme } from "./theme/roles.ts";

// The role names, in the order every packed set below lists its colors.
export const OASIS_ROLE_ORDER: string[] = ${JSON.stringify([...ROLES])};

// The Oasis themes: one dark set and five light sets each. The \`light_intensity\` setting picks the light set.
export const OASIS_THEMES: Record<string, PackedOasisTheme> = {
${packed_themes}
};

// Contributed theme files, one dark and one light set each, every role filled.
export const REPO_THEMES: Record<string, Theme> = ${JSON.stringify(repo_themes, null, 2)};
`;

// The names alone, for code that offers them without the color tables (the command line page).
const names_source = `// Generated by tools/build_themes.ts from themes/oasis/*.css and themes/*.toml. Run \`just themes\` after a change there.

// Every built-in theme name, Oasis themes first. No colors: the tables in themes.ts are 25 KB.
export const BUILT_IN_THEME_NAMES: readonly string[] = ${JSON.stringify([...Object.keys(oasis_themes), ...Object.keys(repo_themes)])};
`;

// A missing module is stale, the same as an outdated one.
let stale = false;
for (const [path, text] of [
  [module_path, next],
  [join(dirname(module_path), "theme_names.ts"), names_source],
] as const) {
  if ((existsSync(path) ? readFileSync(path, "utf8") : undefined) === text) continue;
  if (write) writeFileSync(path, text);
  else {
    console.error(`${path} is stale against themes/; run \`just themes\``);
    stale = true;
  }
}
if (stale) process.exit(1);
