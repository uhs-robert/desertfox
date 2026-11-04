import assert from "node:assert/strict";
import { test } from "node:test";
import { PALETTE_NAMES, palette_mode_colors, resolve_mode_colors } from "../src/shared/mode_colors.ts";
import { derive_roles } from "../src/shared/theme/derive.ts";

test("every palette gives caret and visual their own colors in both variants", () => {
  for (const name of PALETTE_NAMES) {
    const colors = resolve_mode_colors(name);
    for (const variant of ["dark", "light"] as const) {
      const pairs = ["normal", "insert", "ignore", "caret", "visual"].map((mode) => colors[mode as keyof typeof colors][variant]);
      for (const [bg, fg] of pairs) assert.match(`${bg}${fg}`, /^#[0-9a-f]{6}#[0-9a-f]{6}$/, `${name} ${variant}`);
      assert.equal(new Set([colors.caret[variant][0], colors.visual[variant][0], colors.normal[variant][0]]).size, 3, `${name} ${variant}: caret, visual and normal share a color`);
    }
  }
});

test("caret takes the lualine command color and visual the lualine visual color", () => {
  const moonlight = resolve_mode_colors("moonlight");
  assert.deepEqual(moonlight.caret.dark, ["#7fcf78", "#0c0e13"]);
  assert.deepEqual(moonlight.visual.dark, ["#ffba75", "#0c0e13"]);
  assert.deepEqual(moonlight.caret.light, ["#356731", "#e8e5d8"]);
  assert.deepEqual(moonlight.visual.light, ["#85460e", "#e8e5d8"]);
  // Cactus is the one palette whose command color is not green.
  assert.equal(resolve_mode_colors("cactus").caret.dark[0], "#ffd05c");
});

const local_colors = derive_roles({ bg: "#101010", fg: "#eeeeee", primary: "#88aaff", accent: "#ffcc66" }, "dark");

test("a theme badge is its mode role on the theme bg", () => {
  const colors = palette_mode_colors("mine", { name: "mine", colors: { dark: local_colors, light: local_colors } });
  assert.deepEqual(colors?.normal.dark, ["#88aaff", "#101010"]);
  assert.deepEqual(colors?.insert.light, [local_colors.error, "#101010"]);
  assert.deepEqual(colors?.ignore.dark, [local_colors.muted, "#101010"]);
});

test("a local theme wins over a built-in palette of the same name", () => {
  assert.deepEqual(palette_mode_colors("moonlight", { name: "moonlight", colors: { dark: local_colors, light: local_colors } })?.normal.dark, ["#88aaff", "#101010"]);
});

test("the built-in palettes keep their badges, and an unknown name finds nothing", () => {
  assert.deepEqual(palette_mode_colors("moonlight"), resolve_mode_colors("moonlight"));
  assert.deepEqual(palette_mode_colors("moonlight", { name: "other", colors: { dark: local_colors, light: local_colors } }), resolve_mode_colors("moonlight"));
  assert.equal(palette_mode_colors("neon"), undefined);
});
