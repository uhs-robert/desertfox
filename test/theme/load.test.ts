import assert from "node:assert/strict";
import { test } from "node:test";
import { derive_roles } from "../../src/shared/theme/derive.ts";
import { built_in_theme_names, load_theme } from "../../src/shared/theme/load.ts";

const colors = derive_roles({ bg_core: "#101010", fg_core: "#eeeeee", primary: "#88aaff", accent: "#ffcc66" }, "dark");

test("a local theme with every role wins over a built-in theme of the same name", () => {
  assert.equal(load_theme("oasis_moonlight", 3, { name: "oasis_moonlight", colors: { dark: colors, light: colors } })?.dark.primary, "#88aaff");
});

test("a local theme missing a role is not used, and the name falls back to the built-in lookup", () => {
  const { accent: _accent, ...partial } = colors;
  assert.equal(load_theme("mine", 3, { name: "mine", colors: { dark: partial, light: colors } } as never), undefined);
  assert.notEqual(load_theme("oasis_moonlight", 3, { name: "oasis_moonlight", colors: { dark: partial, light: colors } } as never)?.dark.primary, "#88aaff");
});

test("a local theme with an empty or non-hex role value is not used", () => {
  for (const bad of ["", "not-a-color"]) {
    const broken = { ...colors, primary: bad };
    assert.equal(load_theme("mine", 3, { name: "mine", colors: { dark: broken, light: colors } }), undefined);
    assert.equal(load_theme("mine", 3, { name: "mine", colors: { dark: colors, light: broken } }), undefined);
  }
});

test("light_intensity picks the light set and leaves dark alone", () => {
  const light_bg = (intensity: 1 | 2 | 3 | 4 | 5) => load_theme("oasis_moonlight", intensity)!.light.bg_core;
  assert.equal(light_bg(1), "#f3f2eb");
  assert.equal(light_bg(3), "#e8e5d8");
  assert.notEqual(light_bg(5), light_bg(1));
  assert.deepEqual(load_theme("oasis_moonlight", 5)!.dark, load_theme("oasis_moonlight", 1)!.dark);
});

test("a name no theme answers to finds nothing, the bare Oasis names included", () => {
  assert.equal(load_theme("neon", 3), undefined);
  assert.equal(load_theme("moonlight", 3), undefined);
  assert.deepEqual(load_theme("oasis_moonlight", 3, { name: "other", colors: { dark: colors, light: colors } }), load_theme("oasis_moonlight", 3));
});

test("a hand-edited local theme with a missing variant falls back instead of crashing", () => {
  for (const broken of [{ dark: null, light: colors }, { dark: { bg_core: "#000000" }, light: colors }]) {
    assert.deepEqual(load_theme("oasis_moonlight", 3, { name: "oasis_moonlight", colors: broken } as never), load_theme("oasis_moonlight", 3));
  }
});

// Statement is also the normal color in five dark themes (abyss, canyon, desert, lagoon, midnight), so only visual has to stand apart.
test("every built-in theme gives visual mode its own color in both variants", () => {
  for (const name of built_in_theme_names()) {
    const theme = load_theme(name, 3)!;
    for (const variant of ["dark", "light"] as const) {
      const colors_of = theme[variant];
      assert.notEqual(colors_of.mode_visual, colors_of.mode_caret, `${name} ${variant} caret`);
      assert.notEqual(colors_of.mode_visual, colors_of.mode_normal, `${name} ${variant} normal`);
    }
  }
});

test("moonlight keeps its mode colors, caret from the Statement group, and its Search and CurSearch colors", () => {
  const { dark, light } = load_theme("oasis_moonlight", 3)!;
  assert.deepEqual([dark.mode_normal, dark.mode_insert, dark.mode_caret, dark.mode_visual, dark.mode_ignore], ["#7fa3c9", "#ffa0a0", "#d8cf7f", "#ffba75", "#717a84"]);
  assert.deepEqual([light.mode_caret, light.mode_visual], ["#6b632b", "#85460e"]);
  assert.deepEqual([dark.search_bg, dark.search_fg, dark.search_current_bg, dark.search_current_fg], ["#666666", "#f5f5dc", "#cdc673", "#0c0e13"]);
  assert.deepEqual([light.search_bg, light.search_fg, light.search_current_bg, light.search_current_fg], ["#e1b69d", "#4e260e", "#dd6f6f", "#350808"]);
});
