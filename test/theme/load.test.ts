import assert from "node:assert/strict";
import { test } from "node:test";
import { derive_roles } from "../../src/shared/theme/derive.ts";
import { load_theme } from "../../src/shared/theme/load.ts";

const colors = derive_roles({ bg_core: "#101010", fg_core: "#eeeeee", primary: "#88aaff", accent: "#ffcc66" }, "dark");

test("a local theme with every role wins over a built-in theme of the same name", () => {
  assert.equal(load_theme("oasis_moonlight", 3, { name: "oasis_moonlight", colors: { dark: colors, light: colors } })?.dark.primary, "#88aaff");
});

test("a local theme missing a role is not used, and the name falls back to the built-in lookup", () => {
  const { accent: _accent, ...partial } = colors;
  assert.equal(load_theme("mine", 3, { name: "mine", colors: { dark: partial, light: colors } } as never), undefined);
  assert.notEqual(load_theme("oasis_moonlight", 3, { name: "oasis_moonlight", colors: { dark: partial, light: colors } } as never)?.dark.primary, "#88aaff");
});
