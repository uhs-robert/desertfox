import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { oasis_theme } from "../../src/shared/theme/load.ts";
import { OASIS_ROLE_ORDER, OASIS_THEMES } from "../../src/shared/themes.ts";
import { LIGHT_INTENSITIES, ROLES } from "../../src/shared/theme/roles.ts";

const css_files = readdirSync(new URL("../../themes/oasis/", import.meta.url)).filter((name) => name.endsWith(".css"));

test("themes/oasis holds one dark and five light CSS files per theme, and each yields all 21 roles", () => {
  assert.equal(ROLES.length, 21);
  const names = Object.keys(OASIS_THEMES);
  assert.equal(names.length, 16);
  assert.equal(css_files.length, 16 * (1 + LIGHT_INTENSITIES.length));
  for (const name of names) {
    const theme = oasis_theme(name)!;
    const sets = [theme.dark, ...LIGHT_INTENSITIES.map((intensity) => theme.light[intensity])];
    for (const colors of sets) {
      assert.deepEqual(Object.keys(colors), [...ROLES], name);
      for (const color of Object.values(colors)) assert.match(color, /^#[0-9a-f]{6}$/, name);
    }
  }
});

test("every theme name has the oasis_ prefix, so a bare name is not a theme", () => {
  for (const name of Object.keys(OASIS_THEMES)) assert.match(name, /^oasis_[a-z]+$/);
  assert.ok(oasis_theme("oasis_moonlight"));
  assert.equal(oasis_theme("moonlight"), undefined);
});

test("moonlight reads the roles from its CSS variables without mixing", () => {
  const { dark, light } = oasis_theme("oasis_moonlight")!;
  assert.deepEqual(
    [dark.bg_core, dark.bg_mantle, dark.bg_crust, dark.selection, dark.fg_core, dark.fg_comment, dark.fg_dim, dark.fg_muted],
    ["#0c0e13", "#141c24", "#070a0e", "#24364d", "#f5f5dc", "#69809d", "#717a84", "#4e6578"],
  );
  assert.deepEqual([dark.primary, dark.secondary, dark.accent, dark.border, dark.error, dark.warn, dark.ok, dark.info], ["#7fa3c9", "#f0e68c", "#ffa0a0", "#5d8bbb", "#ffa0a0", "#f0e68c", "#a3e39a", "#81c0ff"]);
  assert.deepEqual(
    [light[3].bg_core, light[3].selection, light[3].fg_core, light[3].error, light[3].ok],
    ["#e8e5d8", "#d1cbb2", "#181811", "#701818", "#1d5c14"],
  );
});

test("normal mode takes theme-status where the file has it, else theme-primary", () => {
  const { dark } = oasis_theme("oasis_luna")!;
  assert.notEqual(dark.mode_normal, dark.primary);
  const moonlight = oasis_theme("oasis_moonlight")!;
  assert.equal(moonlight.dark.mode_normal, moonlight.dark.primary);
});

test("the packed sets list their colors in ROLES order, and every set has one color per role", () => {
  assert.deepEqual(OASIS_ROLE_ORDER, [...ROLES]);
  for (const [name, theme] of Object.entries(OASIS_THEMES)) {
    for (const set of [theme.dark, ...LIGHT_INTENSITIES.map((intensity) => theme.light[intensity])]) assert.equal(set.length, ROLES.length, name);
  }
  assert.equal(OASIS_THEMES.oasis_moonlight!.dark[ROLES.indexOf("bg_core")], "#0c0e13");
});
