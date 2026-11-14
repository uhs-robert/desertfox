import assert from "node:assert/strict";
import { test } from "node:test";
import { clamped_fg_dim } from "../../src/shared/theme/contrast.ts";
import { parse_base16, suggested_theme_name, theme_name_problem } from "../../src/shared/theme/base16.ts";
import { local_theme_problem } from "../../src/shared/theme/theme_file.ts";
import { ROLES } from "../../src/shared/theme/roles.ts";

const CLASSIC = `# Gruvbox dark, medium
scheme: "Gruvbox dark, medium"
author: "Dawid Kurek (dawikur@gmail.com), morhetz (https://github.com/morhetz/gruvbox)"
base00: "282828"
base01: "3c3836"
base02: "504945"
base03: "665c54"
base04: "bdae93"
base05: "d5c4a1"
base06: "ebdbb2"
base07: "fbf1c7"
base08: "fb4934"
base09: "fe8019"
base0A: "fabd2f"
base0B: "b8bb26"
base0C: "8ec07c"
base0D: "83a598"
base0E: "d3869b"
base0F: "d65d0e"
`;

const TINTED = `system: "base16"
name: "Catppuccin Latte"
author: "https://github.com/catppuccin/catppuccin"
variant: "light"
palette:
  base00: "#eff1f5" # base
  base01: "#e6e9ef"
  base02: "#ccd0da"
  base03: "#bcc0cc"
  base04: "#acb0be"
  base05: "#4c4f69"
  base06: "#dc8a78"
  base07: "#7287fd"
  base08: "#d20f39"
  base09: "#fe640b"
  base0A: "#df8e1d"
  base0B: "#40a02b"
  base0C: "#179299"
  base0D: "#1e66f5"
  base0E: "#8839ef"
  base0F: "#dd7878"
`;

const ok = (text: string) => {
  const result = parse_base16(text);
  assert.ok(result.ok, result.ok ? "" : result.problem);
  return result.scheme;
};
const problem = (text: string) => {
  const result = parse_base16(text);
  assert.equal(result.ok, false);
  return result.ok ? "" : result.problem;
};

test("a classic base16 file maps its slots onto the roles", () => {
  const scheme = ok(CLASSIC);
  assert.equal(scheme.name, "Gruvbox dark, medium");
  assert.equal(scheme.system, "base16");
  assert.equal(scheme.variant, "dark");
  assert.equal(scheme.variant_known, false);
  const { dark } = scheme.theme;
  assert.deepEqual(
    [dark.bg_core, dark.bg_mantle, dark.selection, dark.fg_comment, dark.fg_core, dark.primary, dark.accent, dark.error, dark.warn, dark.ok, dark.info, dark.mode_normal, dark.mode_insert, dark.mode_caret, dark.mode_visual, dark.search_bg, dark.search_fg, dark.search_current_bg],
    ["#282828", "#3c3836", "#504945", "#665c54", "#d5c4a1", "#83a598", "#d3869b", "#fb4934", "#fe8019", "#b8bb26", "#8ec07c", "#83a598", "#b8bb26", "#fabd2f", "#d3869b", "#fabd2f", "#282828", "#fe8019"],
  );
  assert.equal(dark.fg_dim, "#bdae93");
  assert.notEqual(dark.bg_crust, dark.bg_core, "no base24 slot, so the crust derives");
  assert.equal(local_theme_problem(scheme.theme), undefined);
  for (const role of ROLES) assert.match(dark[role], /^#[0-9a-f]{6}$/);
});

test("a one-variant scheme fills both the dark and the light table", () => {
  const scheme = ok(CLASSIC);
  assert.deepEqual(scheme.theme.light, scheme.theme.dark);
  assert.notEqual(scheme.theme.light, scheme.theme.dark, "two tables, not one shared object");
});

test("a tinted-theming file reads its name, variant and nested palette with trailing comments", () => {
  const scheme = ok(TINTED);
  assert.equal(scheme.name, "Catppuccin Latte");
  assert.equal(scheme.variant, "light");
  assert.equal(scheme.variant_known, true);
  assert.equal(scheme.theme.dark.bg_core, "#eff1f5");
  assert.equal(scheme.theme.light.primary, "#1e66f5");
});

test("a light scheme derives its crust darker than the background, a dark one lighter", () => {
  const light = ok(TINTED).theme.dark;
  const dark = ok(CLASSIC).theme.dark;
  assert.ok(light.bg_crust < light.bg_core);
  assert.ok(dark.bg_crust > dark.bg_core);
});

test("a base24 scheme takes mantle and crust from base10 and base11", () => {
  const base24 = `${CLASSIC}base10: "1d2021"\nbase11: "141617"\nbase12: "ff0000"\nbase17: "00ff00"\n`;
  const scheme = ok(base24);
  assert.equal(scheme.system, "base24");
  assert.equal(scheme.theme.dark.bg_mantle, "#1d2021");
  assert.equal(scheme.theme.dark.bg_crust, "#141617");
});

test("the variant is read from the colors when the file names none", () => {
  const swapped = TINTED.replace(/variant: "light"\n/, "");
  assert.equal(ok(swapped).variant, "light");
  assert.equal(ok(CLASSIC).variant, "dark");
});

test("fg_dim is raised to 3:1 by the shared clamp, and mode_ignore follows it", () => {
  const faint = CLASSIC.replace('base04: "bdae93"', 'base04: "3d3a37"');
  const dark = ok(faint).theme.dark;
  assert.notEqual(dark.fg_dim, "#3d3a37");
  assert.equal(dark.mode_ignore, dark.fg_dim);
  assert.equal(clamped_fg_dim({ bg_core: dark.bg_core, bg_mantle: dark.bg_mantle, fg_dim: dark.fg_dim }), dark.fg_dim, "a clamped value is a fixed point");
});

test("quoting, case, bare hex, a leading # and CRLF line ends are all read", () => {
  const messy = CLASSIC.replace('base00: "282828"', "BASE00: '#282828'").replace('base01: "3c3836"', "base01:   3C3836  # bg").replaceAll("\n", "\r\n");
  const scheme = ok(`﻿---\n${messy}`);
  assert.equal(scheme.theme.dark.bg_core, "#282828");
  assert.equal(scheme.theme.dark.bg_mantle, "#3c3836");
});

test("a partial scheme is refused and names the missing slots", () => {
  assert.match(problem(CLASSIC.replace(/base0[ef]:.*\n/gi, "")), /lacks base0E, base0F/);
  assert.match(problem("scheme: x\nbase00: \"000000\"\n"), /lacks base01/);
});

test("malformed input is refused with a reason, never half read", () => {
  assert.match(problem(""), /No base16 color/);
  assert.match(problem("just some words"), /No base16 color/);
  assert.match(problem(CLASSIC.replace('"d5c4a1"', '"d5c4"')), /base05 is "d5c4", not a six-digit hex color/);
  assert.match(problem(CLASSIC.replace('"d5c4a1"', '"zzzzzz"')), /base05/);
  assert.match(problem(`${CLASSIC}base05: "ffffff"\n`), /base05 appears twice/);
  assert.match(problem(`${CLASSIC}---\n${CLASSIC}`), /more than one YAML document/);
  assert.match(problem(`palette: { base00: "000000" }`), /flow style/);
  assert.match(problem(CLASSIC.replace(/^scheme:.*$/m, 'variant: "twilight"')), /variant is "twilight"/);
  assert.match(problem(`system: "tinted8"\n${CLASSIC}`), /tinted8/);
  assert.match(problem("a".repeat(70_000)), /longer than 64 KB/);
});

test("names: a scheme name becomes a theme name, and built-in, desktop and odd names are refused", () => {
  assert.equal(suggested_theme_name("Gruvbox dark, medium"), "gruvbox_dark_medium");
  assert.equal(suggested_theme_name("  !!  "), "imported");
  assert.equal(theme_name_problem("gruvbox_dark_medium"), undefined);
  assert.match(theme_name_problem("oasis_cactus") ?? "", /built-in/);
  assert.match(theme_name_problem("desktop") ?? "", /built-in/);
  for (const bad of ["", "Has Space", "__proto__", "-x", "a".repeat(49), "a/b"]) assert.notEqual(theme_name_problem(bad), undefined, bad);
});
