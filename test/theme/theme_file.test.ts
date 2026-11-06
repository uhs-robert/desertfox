import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { derive_roles, mix } from "../../src/shared/theme/derive.ts";
import { ROLES } from "../../src/shared/theme/roles.ts";
import { check_theme_file, parse_color } from "../../src/shared/theme/theme_file.ts";
import { role_tokens, token_name } from "../../src/shared/theme/tokens.ts";

const REQUIRED = { bg_core: "#202020", fg_core: "#e0e0e0", primary: "#7fa3c9", accent: "#f0e68c" };

function checked(data: Record<string, unknown>) {
  const problems: string[] = [];
  const theme = check_theme_file("t.toml", data, problems);
  return { theme, problems };
}

test("the role list is the public contract, in this order", () => {
  assert.deepEqual(ROLES, [
    "bg_core", "bg_mantle", "bg_crust", "selection", "fg_core", "fg_comment", "fg_dim", "fg_muted", "primary", "secondary", "accent",
    "border", "error", "warn", "ok", "info", "mode_normal", "mode_insert", "mode_ignore", "mode_caret", "mode_visual",
    "search_bg", "search_fg", "search_current_bg", "search_current_fg",
  ]);
});

test("colors parse as #rgb or #rrggbb and come out lowercase #rrggbb", () => {
  assert.equal(parse_color("#ABC"), "#aabbcc");
  assert.equal(parse_color("#A0b1C2"), "#a0b1c2");
  for (const bad of ["red", "#abcd", "abc", "#ggg", 12, "rgb(0,0,0)"]) assert.equal(parse_color(bad), undefined, String(bad));
});

test("mix moves each channel toward the target and rounds", () => {
  assert.equal(mix("#ffffff", "#000000", 0.5), "#808080");
  assert.equal(mix("#102030", "#102030", 0.3), "#102030");
  assert.equal(mix("#000000", "#ffffff", 0), "#000000");
});

test("each missing role derives by the table", () => {
  const dark = derive_roles(REQUIRED, "dark");
  assert.equal(dark.bg_mantle, mix("#202020", "#e0e0e0", 0.08));
  assert.equal(dark.bg_crust, mix("#202020", "#e0e0e0", 0.16));
  assert.equal(dark.selection, mix("#202020", "#e0e0e0", 0.15));
  assert.equal(dark.fg_comment, mix("#e0e0e0", "#202020", 0.45));
  assert.equal(dark.fg_dim, mix("#e0e0e0", "#202020", 0.55));
  assert.equal(dark.fg_muted, mix("#e0e0e0", "#202020", 0.65));
  assert.equal(dark.secondary, "#f0e68c");
  assert.equal(dark.border, dark.fg_muted);
  assert.deepEqual([dark.error, dark.warn, dark.ok, dark.info], ["#ffa0a0", "#ffba75", "#7fcf78", "#81c0ff"]);
  assert.deepEqual([dark.mode_normal, dark.mode_insert, dark.mode_ignore, dark.mode_caret, dark.mode_visual], [dark.primary, dark.error, dark.fg_dim, "#f0e68c", dark.warn]);
  assert.deepEqual([dark.search_bg, dark.search_fg, dark.search_current_bg, dark.search_current_fg], [mix("#202020", "#e0e0e0", 0.3), "#e0e0e0", dark.warn, "#202020"]);
  const light = derive_roles(REQUIRED, "light");
  assert.deepEqual([light.error, light.warn, light.ok, light.info], ["#8e0f14", "#793f0d", "#315e2d", "#184571"]);
  assert.equal(light.mode_caret, "#817613");
  assert.equal(light.bg_mantle, mix("#202020", "#000000", 0.15));
  assert.equal(light.bg_crust, mix("#202020", "#000000", 0.3));
  assert.deepEqual(Object.keys(dark), [...ROLES]);
});

// WCAG relative luminance contrast ratio of two #rrggbb colors.
function contrast(first: string, second: string): number {
  const luminance = (color: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => {
      const channel = Number.parseInt(color.slice(at, at + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light! + 0.05) / (dark! + 0.05);
}

test("a dark theme's derived layers are lighter than bg_core and visibly apart from it", () => {
  // Moonlight dark, as the command line page declares it.
  const moonlight = derive_roles({ bg_core: "#0c0e13", fg_core: "#f5f5dc", primary: "#7fa3c9", accent: "#f0e68c" }, "dark");
  assert.ok(contrast(moonlight.bg_mantle, moonlight.bg_core) >= 1.15, `mantle ${moonlight.bg_mantle}`);
  assert.ok(contrast(moonlight.bg_crust, moonlight.bg_core) > contrast(moonlight.bg_mantle, moonlight.bg_core), `crust ${moonlight.bg_crust}`);
});

test("a given role wins over its derivation, and roles derived from it follow", () => {
  const colors = derive_roles({ ...REQUIRED, fg_muted: "#555555", error: "#ff0000" }, "dark");
  assert.equal(colors.border, "#555555");
  assert.equal(colors.mode_ignore, colors.fg_dim);
  assert.equal(colors.mode_insert, "#ff0000");
});

test("a file with one table serves both system settings, derived as its own variant", () => {
  const { theme, problems } = checked({ dark: { ...REQUIRED, bg_core: "#222" } });
  assert.deepEqual(problems, []);
  assert.equal(theme?.dark.bg_core, "#222222");
  assert.deepEqual(theme?.light, theme?.dark);
  assert.equal(checked({ light: REQUIRED }).theme?.dark.error, "#8e0f14");
});

test("both tables derive separately", () => {
  const { theme } = checked({ dark: REQUIRED, light: { ...REQUIRED, bg_core: "#ffffff" } });
  assert.equal(theme?.dark.error, "#ffa0a0");
  assert.equal(theme?.light.error, "#8e0f14");
  assert.equal(theme?.light.bg_core, "#ffffff");
});

test("an unknown role is an error that names the file, table and key and lists the valid roles", () => {
  const { theme, problems } = checked({ dark: { ...REQUIRED, bg_mantel: "#000" } });
  assert.equal(theme, undefined);
  assert.deepEqual(problems, [`t.toml: [dark] bg_mantel: unknown role (valid: ${ROLES.join(", ")})`]);
});

test("a missing required role is an error", () => {
  const { primary: _, ...without_primary } = REQUIRED;
  assert.deepEqual(checked({ light: without_primary }).problems, ["t.toml: [light]: missing required role primary"]);
});

test("a bad color is one error, even on a required role", () => {
  assert.deepEqual(checked({ dark: { ...REQUIRED, fg_core: "white" } }).problems, ['t.toml: [dark] fg_core: expected a color as #rgb or #rrggbb, got "white"']);
});

test("a file needs a [dark] or [light] table and nothing else at the top", () => {
  assert.deepEqual(checked({}).problems, ["t.toml: needs a [dark] table, a [light] table or both"]);
  assert.deepEqual(checked({ bg_core: "#000" }).problems, ["t.toml: [bg_core]: unknown table (known: dark, light)", "t.toml: needs a [dark] table, a [light] table or both"]);
  assert.deepEqual(checked({ dark: REQUIRED, dim: {} }).problems, ["t.toml: [dim]: unknown table (known: dark, light)"]);
  assert.deepEqual(checked({ dark: "#000" }).problems, ["t.toml: [dark]: expected a table of role = color"]);
});

test("a role's token is --desertfox- plus the role with hyphens", () => {
  assert.equal(token_name("bg_mantle"), "--desertfox-bg-mantle");
  assert.equal(token_name("mode_normal"), "--desertfox-mode-normal");
  const tokens = role_tokens(derive_roles(REQUIRED, "dark"));
  assert.equal(Object.keys(tokens).length, ROLES.length);
  assert.equal(tokens["--desertfox-secondary"], "#f0e68c");
});

test("the command line page declares its colors as role tokens, bg_mantle and secondary included", () => {
  const html = readFileSync(new URL("../../src/cmdline/cmdline.html", import.meta.url), "utf8");
  const block = /\.desertfox-cmdline \{([^}]*)\}/.exec(html)![1]!;
  const declared = [...block.matchAll(/(--desertfox-[a-z-]+):\s*#[0-9a-f]{3,6};/g)].map((match) => match[1]);
  const role_token_names = ROLES.map(token_name);
  for (const name of declared) assert.ok(role_token_names.includes(name!), `${name} is not a role token`);
  assert.ok(declared.includes(token_name("bg_mantle")));
  assert.ok(declared.includes(token_name("secondary")));
});

test("a theme file with only the required roles still gets the four search roles", () => {
  const { theme, problems } = checked({ dark: REQUIRED, light: REQUIRED });
  assert.deepEqual(problems, []);
  for (const variant of [theme!.dark, theme!.light]) {
    for (const role of ["search_bg", "search_fg", "search_current_bg", "search_current_fg"] as const) assert.match(variant[role], /^#[0-9a-f]{6}$/, role);
  }
});
