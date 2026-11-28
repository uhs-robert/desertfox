import assert from "node:assert/strict";
import { test } from "node:test";
import { derive_roles } from "../../src/shared/theme/derive.ts";
import { load_theme } from "../../src/shared/theme/load.ts";
import { OASIS_THEMES, REPO_THEMES } from "../../src/shared/themes.ts";

const colors = derive_roles({ bg_core: "#101010", fg_core: "#eeeeee", primary: "#88aaff", accent: "#ffcc66" }, "dark");

test("a local theme with every role wins over a built-in theme of the same name", () => {
  assert.equal(load_theme("oasis_moonlight", 3, { oasis_moonlight: { dark: colors, light: colors } })?.dark.primary, "#88aaff");
});

test("a local theme missing a role is not used, and the name falls back to the built-in lookup", () => {
  const { accent: _accent, ...partial } = colors;
  assert.equal(load_theme("mine", 3, { mine: { dark: partial, light: colors } } as never), undefined);
  assert.notEqual(load_theme("oasis_moonlight", 3, { oasis_moonlight: { dark: partial, light: colors } } as never)?.dark.primary, "#88aaff");
});

test("a local theme with an empty or non-hex role value is not used", () => {
  for (const bad of ["", "not-a-color"]) {
    const broken = { ...colors, primary: bad };
    assert.equal(load_theme("mine", 3, { mine: { dark: broken, light: colors } }), undefined);
    assert.equal(load_theme("mine", 3, { mine: { dark: colors, light: broken } }), undefined);
  }
});

test("a stored local table from before mode_command loads, with the role derived", () => {
  const { mode_command: _dark, ...old_dark } = colors;
  const { mode_command: _light, ...old_light } = colors;
  const loaded = load_theme("mine", 3, { mine: { dark: old_dark as typeof colors, light: old_light as typeof colors } });
  assert.ok(loaded, "the table is kept, not replaced by the default theme");
  assert.equal(loaded.dark.mode_command, loaded.dark.warn);
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
  assert.deepEqual(load_theme("oasis_moonlight", 3, { other: { dark: colors, light: colors } }), load_theme("oasis_moonlight", 3));
});

test("a hand-edited local theme with a missing variant falls back instead of crashing", () => {
  for (const broken of [{ dark: null, light: colors }, { dark: { bg_core: "#000000" }, light: colors }]) {
    assert.deepEqual(load_theme("oasis_moonlight", 3, { oasis_moonlight: broken } as never), load_theme("oasis_moonlight", 3));
  }
});

// Oasis themes only: a contributed built-in theme need not follow this rule.
test("every built-in theme gives visual mode its own color in both variants", () => {
  for (const name of Object.keys(OASIS_THEMES)) {
    const theme = load_theme(name, 3)!;
    for (const variant of ["dark", "light"] as const) {
      const colors_of = theme[variant];
      assert.notEqual(colors_of.mode_visual, colors_of.mode_caret, `${name} ${variant} caret`);
      assert.notEqual(colors_of.mode_visual, colors_of.mode_normal, `${name} ${variant} normal`);
      assert.notEqual(colors_of.mode_item, colors_of.mode_visual, `${name} ${variant} item vs visual`);
      assert.notEqual(colors_of.mode_item, colors_of.mode_caret, `${name} ${variant} item vs caret`);
    }
  }
});

test("moonlight keeps its mode colors, the gold dark caret, and its Search and CurSearch colors", () => {
  const { dark, light } = load_theme("oasis_moonlight", 3)!;
  assert.deepEqual([dark.mode_normal, dark.mode_insert, dark.mode_caret, dark.mode_visual, dark.mode_ignore], ["#7fa3c9", "#ffa0a0", "#f7d46c", "#ffba75", "#717a84"]);
  assert.deepEqual([light.mode_caret, light.mode_visual], ["#817613", "#85460e"]);
  assert.equal(dark.mode_item, "#c695ff");
  assert.deepEqual([dark.search_bg, dark.search_fg, dark.search_current_bg, dark.search_current_fg], ["#666666", "#f5f5dc", "#cdc673", "#0c0e13"]);
  assert.deepEqual([light.search_bg, light.search_fg, light.search_current_bg, light.search_current_fg], ["#e1b69d", "#4e260e", "#dd6f6f", "#350808"]);
});

function lab_of(hex: string): [number, number, number] {
  const linear = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const [r, g, b] = linear;
  const white = [0.95047, 1, 1.08883];
  const xyz = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / white[0]!, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / white[2]!];
  const [fx, fy, fz] = xyz.map((value) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116)) as [number, number, number];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const BADGE_ROLES = ["mode_normal", "mode_insert", "mode_ignore", "mode_caret", "mode_visual", "mode_item", "mode_media", "mode_command"] as const;
const MIN_BADGE_DISTANCE = 12;

test("every built-in theme keeps every pair of badge colors a CIE76 distance of 12 apart, at every light level", () => {
  const themes = [
    ...Object.keys(OASIS_THEMES).flatMap((name) => [1, 2, 3, 4, 5].map((level) => [`${name} light ${level}`, load_theme(name, level as 1 | 2 | 3 | 4 | 5)!] as const)),
    ...Object.entries(REPO_THEMES).map(([name, theme]) => [name, theme] as const),
  ];
  for (const [name, theme] of themes) {
    for (const variant of ["dark", "light"] as const) {
      for (const [at, first] of BADGE_ROLES.entries()) {
        for (const second of BADGE_ROLES.slice(at + 1)) {
          const [l1, a1, b1] = lab_of(theme[variant][first]);
          const [l2, a2, b2] = lab_of(theme[variant][second]);
          const distance = Math.hypot(l1 - l2, a1 - a2, b1 - b2);
          assert.ok(distance >= MIN_BADGE_DISTANCE, `${name} ${variant} ${first} vs ${second}: ${distance.toFixed(1)}`);
        }
      }
    }
  }
});
