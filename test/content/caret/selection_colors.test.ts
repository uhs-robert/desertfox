import assert from "node:assert/strict";
import { test } from "node:test";
import { read_find_colors } from "../../../src/content/caret/find_session.ts";
import { find_colors_of } from "../../../src/content/caret/selection_colors.ts";
import { THEME_STORAGE_KEY } from "../../../src/shared/theme/apply.ts";
import { load_theme } from "../../../src/shared/theme/load.ts";

const moonlight = load_theme("oasis_moonlight", 3)!;

test("all matches take the search pair and the current match takes the current pair, in both variants", () => {
  const colors = find_colors_of(moonlight);
  assert.deepEqual(colors.all, { dark: ["#666666", "#f5f5dc"], light: ["#e1b69d", "#4e260e"] });
  assert.deepEqual(colors.current, { dark: ["#cdc673", "#0c0e13"], light: ["#dd6f6f", "#350808"] });
});

test("the find colors come from the stored theme, and fall back to moonlight when none is stored", async () => {
  const stored: Record<string, unknown> = {};
  Object.assign(globalThis, { browser: { storage: { local: { get: async (key: string) => (key in stored ? { [key]: stored[key] } : {}) } } } });
  const fallback = await read_find_colors();
  assert.deepEqual(fallback, find_colors_of(moonlight));
  const other = load_theme("oasis_cactus", 3)!;
  stored[THEME_STORAGE_KEY] = other;
  assert.deepEqual(await read_find_colors(), find_colors_of(other));
});
