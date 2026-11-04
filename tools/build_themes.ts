// Compiles the repo themes into src/shared/themes.ts, so the extension never parses TOML or CSS.
// Two sources: `themes/oasis/*.css`, byte copies of the oasis.nvim CSS files, and `themes/*.toml`, contributed theme files.
// Usage: node tools/build_themes.ts --write | --check [--out path]

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
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
  mode_caret: ["syntax-parameter"],
  mode_visual: ["syntax-special"],
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
const repo_themes = read_theme_dir(themes_dir, problems, ["README.md", "oasis"]);
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

// A missing module is stale, the same as an outdated one.
const current = existsSync(module_path) ? readFileSync(module_path, "utf8") : undefined;
if (current === next) process.exit(0);
if (write) {
  writeFileSync(module_path, next);
} else {
  console.error(`${module_path} is stale against themes/; run \`just themes\``);
  process.exit(1);
}
