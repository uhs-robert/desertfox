import assert from "node:assert/strict";
import { test } from "node:test";
import { built_in_theme_names, MODE_COLOR_MODES, palette_mode_colors } from "../src/shared/mode_colors.ts";
import { derive_roles } from "../src/shared/theme/derive.ts";

test("every Oasis theme gives caret, visual and normal their own colors in both variants", () => {
  for (const name of built_in_theme_names()) {
    const colors = palette_mode_colors(name, 3)!;
    for (const variant of ["dark", "light"] as const) {
      for (const mode of MODE_COLOR_MODES) assert.match(colors[mode][variant].join(""), /^#[0-9a-f]{6}#[0-9a-f]{6}$/, `${name} ${variant} ${mode}`);
      assert.equal(new Set([colors.caret[variant][0], colors.visual[variant][0], colors.normal[variant][0]]).size, 3, `${name} ${variant}: caret, visual and normal share a color`);
    }
  }
});

// The seven moonlight values the badge had before the themes came from the Oasis CSS files, kept as the fixture. Ignore mode is the one deliberate change: its badge is the dim foreground, with bg_core text.
test("moonlight keeps its lualine badge colors", () => {
  const moonlight = palette_mode_colors("oasis_moonlight", 3)!;
  assert.deepEqual(moonlight.normal.dark, ["#7fa3c9", "#0c0e13"]);
  assert.deepEqual(moonlight.insert.dark, ["#ffa0a0", "#0c0e13"]);
  assert.deepEqual(moonlight.caret.dark, ["#7fcf78", "#0c0e13"]);
  assert.deepEqual(moonlight.visual.dark, ["#ffba75", "#0c0e13"]);
  assert.deepEqual(moonlight.caret.light, ["#356731", "#e8e5d8"]);
  assert.deepEqual(moonlight.visual.light, ["#85460e", "#e8e5d8"]);
  assert.deepEqual(moonlight.ignore.dark, ["#717a84", "#0c0e13"]);
  // Cactus is the one palette whose command color is not green.
  assert.equal(palette_mode_colors("oasis_cactus", 3)!.caret.dark[0], "#ffd05c");
});

test("light_intensity picks the light set, and leaves dark alone", () => {
  const light_of = (intensity: 1 | 2 | 3 | 4 | 5) => palette_mode_colors("oasis_moonlight", intensity)!;
  assert.equal(light_of(1).normal.light[1], "#f3f2eb");
  assert.equal(light_of(3).normal.light[1], "#e8e5d8");
  assert.notEqual(light_of(5).normal.light[1], light_of(1).normal.light[1]);
  assert.deepEqual(light_of(5).normal.dark, light_of(1).normal.dark);
});

const local_colors = derive_roles({ bg_core: "#101010", fg_core: "#eeeeee", primary: "#88aaff", accent: "#ffcc66" }, "dark");

test("a theme badge is its mode role on the theme bg_core", () => {
  const colors = palette_mode_colors("mine", 3, { name: "mine", colors: { dark: local_colors, light: local_colors } });
  assert.deepEqual(colors?.normal.dark, ["#88aaff", "#101010"]);
  assert.deepEqual(colors?.insert.light, [local_colors.error, "#101010"]);
  assert.deepEqual(colors?.ignore.dark, [local_colors.fg_dim, "#101010"]);
});

test("a local theme wins over an Oasis theme of the same name, whatever the light intensity", () => {
  const local = { name: "oasis_moonlight", colors: { dark: local_colors, light: local_colors } };
  assert.deepEqual(palette_mode_colors("oasis_moonlight", 5, local)?.normal.light, ["#88aaff", "#101010"]);
});

test("a name no theme answers to finds nothing, the bare Oasis names included", () => {
  assert.equal(palette_mode_colors("neon", 3), undefined);
  assert.equal(palette_mode_colors("moonlight", 3), undefined);
  assert.deepEqual(palette_mode_colors("oasis_moonlight", 3, { name: "other", colors: { dark: local_colors, light: local_colors } }), palette_mode_colors("oasis_moonlight", 3));
});

test("a hand-edited local theme with a missing variant or role falls back instead of crashing", () => {
  const broken = [{ dark: null, light: local_colors }, { dark: local_colors, light: { ...local_colors, bg_core: 3 } }, { dark: { bg_core: "#000000" }, light: local_colors }];
  for (const colors of broken) {
    assert.deepEqual(palette_mode_colors("oasis_moonlight", 3, { name: "oasis_moonlight", colors } as never), palette_mode_colors("oasis_moonlight", 3));
  }
});
