import assert from "node:assert/strict";
import { test } from "node:test";
import { read_find_colors } from "../../../src/content/caret/find_session.ts";
import { apply_selection_colors, clear_selection_colors, find_colors_of, keep_selection_colors } from "../../../src/content/caret/selection_colors.ts";
import type { TextTree } from "../../../src/content/caret/text_model.ts";
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

class FakeSheet {
  css = "";
  replaceSync(css: string) {
    this.css = css;
  }
}
const fake_tree = () => ({ nodeType: 9, defaultView: { CSSStyleSheet: FakeSheet }, adoptedStyleSheets: [] as FakeSheet[] }) as unknown as TextTree & { adoptedStyleSheets: FakeSheet[] };

// R8: the session reads the page again while the theme read is in flight, and paints the new trees before the read settles.
test("a theme read that settles after a rebuild colors the trees of the last paint", async () => {
  let settle_read = () => {};
  const gate = new Promise<void>((resume) => (settle_read = resume));
  Object.assign(globalThis, { browser: { storage: { local: { get: async (key: string) => (await gate, { [key]: moonlight }) } } } });
  const old_tree = fake_tree();
  const new_tree = fake_tree();
  keep_selection_colors([old_tree]);
  const reading = apply_selection_colors("visual");
  keep_selection_colors([new_tree]);
  settle_read();
  await reading;
  assert.equal(new_tree.adoptedStyleSheets.length, 1);
  assert.match(new_tree.adoptedStyleSheets[0]!.css, /::selection/);
  assert.equal(old_tree.adoptedStyleSheets.length, 0, "the tree that left the model got the sheet");
  clear_selection_colors();
  assert.equal(new_tree.adoptedStyleSheets.length, 0);
});

// R8 for the cell: `v` right after caret mode starts, before the caret mode read settles.
test("caret mode colors its cell highlight, and a read that settles after a mode switch is dropped", async () => {
  const gates: (() => void)[] = [];
  Object.assign(globalThis, { browser: { storage: { local: { get: async (key: string) => (await new Promise<void>((resume) => gates.push(resume)), { [key]: moonlight }) } } } });
  const tree = fake_tree();
  keep_selection_colors([tree]);
  const caret_read = apply_selection_colors("caret");
  const visual_read = apply_selection_colors("visual");
  gates[1]!();
  await visual_read;
  gates[0]!();
  await caret_read;
  assert.doesNotMatch(tree.adoptedStyleSheets[0]!.css, /highlight/, "the older caret read colored visual mode");
  const back = apply_selection_colors("caret");
  gates[2]!();
  await back;
  assert.match(tree.adoptedStyleSheets[0]!.css, /^::highlight\(oasis-caret\)\{background:#[0-9a-f]+;color:#[0-9a-f]+\}/);
  assert.doesNotMatch(tree.adoptedStyleSheets[0]!.css, /::selection/);
  clear_selection_colors();
});
