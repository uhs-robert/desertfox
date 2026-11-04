import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { OASIS_THEMES } from "../../src/shared/themes.ts";
import { LIGHT_INTENSITIES, ROLES } from "../../src/shared/theme/roles.ts";

const css_files = readdirSync(new URL("../../themes/oasis/", import.meta.url)).filter((name) => name.endsWith(".css"));

test("themes/oasis holds one dark and five light CSS files per theme, and each yields all 20 roles", () => {
  assert.equal(ROLES.length, 20);
  const names = Object.keys(OASIS_THEMES);
  assert.equal(names.length, 16);
  assert.equal(css_files.length, 16 * (1 + LIGHT_INTENSITIES.length));
  for (const name of names) {
    const theme = OASIS_THEMES[name]!;
    const sets = [theme.dark, ...LIGHT_INTENSITIES.map((intensity) => theme.light[intensity])];
    for (const colors of sets) {
      assert.deepEqual(Object.keys(colors), [...ROLES], name);
      for (const color of Object.values(colors)) assert.match(color, /^#[0-9a-f]{6}$/, name);
    }
  }
});

test("every theme name has the oasis_ prefix, so a bare name is not a theme", () => {
  for (const name of Object.keys(OASIS_THEMES)) assert.match(name, /^oasis_[a-z]+$/);
  assert.ok(OASIS_THEMES.oasis_moonlight);
  assert.equal(OASIS_THEMES.moonlight, undefined);
});

test("moonlight reads the roles from its CSS variables without mixing", () => {
  const { dark, light } = OASIS_THEMES.oasis_moonlight!;
  assert.deepEqual(
    [dark.bg_core, dark.bg_mantle, dark.bg_crust, dark.selection, dark.fg_core, dark.fg_comment, dark.fg_dim, dark.fg_muted],
    ["#0c0e13", "#141c24", "#070a0e", "#24364d", "#f5f5dc", "#69809d", "#717a84", "#4e6578"],
  );
  assert.deepEqual([dark.primary, dark.secondary, dark.accent, dark.border, dark.error, dark.warn, dark.ok], ["#7fa3c9", "#f0e68c", "#ffa0a0", "#5d8bbb", "#ffa0a0", "#f0e68c", "#a3e39a"]);
  assert.deepEqual(
    [light[3].bg_core, light[3].selection, light[3].fg_core, light[3].error, light[3].ok],
    ["#e8e5d8", "#d1cbb2", "#181811", "#701818", "#1d5c14"],
  );
});

test("normal mode takes theme-status where the file has it, else theme-primary", () => {
  const { dark } = OASIS_THEMES.oasis_luna!;
  assert.notEqual(dark.mode_normal, dark.primary);
  assert.equal(OASIS_THEMES.oasis_moonlight!.dark.mode_normal, OASIS_THEMES.oasis_moonlight!.dark.primary);
});
