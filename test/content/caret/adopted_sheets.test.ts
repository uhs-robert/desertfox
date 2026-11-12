import assert from "node:assert/strict";
import { test } from "node:test";
import { create_sheet_set } from "../../../src/content/caret/adopted_sheets.ts";
import type { TextTree } from "../../../src/content/caret/text_model.ts";

class FakeSheet {
  css = "";
  replaced = 0;
  replaceSync(css: string) {
    this.css = css;
    this.replaced++;
  }
}

const fake_tree = (): TextTree & { adoptedStyleSheets: FakeSheet[] } => {
  const view = { CSSStyleSheet: FakeSheet };
  return { nodeType: 9, defaultView: view, adoptedStyleSheets: [] } as unknown as TextTree & { adoptedStyleSheets: FakeSheet[] };
};

test("a tree gets one sheet, and a new text replaces its rules in place", () => {
  const sheets = create_sheet_set();
  const tree = fake_tree();
  sheets.set(tree, "a");
  const [sheet] = tree.adoptedStyleSheets;
  sheets.set(tree, "a");
  assert.equal(sheet!.replaced, 1);
  sheets.set(tree, "b");
  assert.deepEqual(tree.adoptedStyleSheets, [sheet]);
  assert.equal(sheet!.css, "b");
});

test("a sheet the page dropped is adopted again", () => {
  const sheets = create_sheet_set();
  const tree = fake_tree();
  sheets.set(tree, "a");
  tree.adoptedStyleSheets = [];
  sheets.set(tree, "a");
  assert.equal(tree.adoptedStyleSheets.length, 1);
});

test("clear removes only its own sheets and skips a dead tree", () => {
  const sheets = create_sheet_set();
  const dead = fake_tree();
  const live = fake_tree();
  const pages_own = new FakeSheet();
  live.adoptedStyleSheets.push(pages_own);
  sheets.set(dead, "a");
  sheets.set(live, "a");
  Object.defineProperty(dead, "adoptedStyleSheets", {
    get() {
      throw new Error("dead object");
    },
  });
  sheets.clear();
  assert.deepEqual(live.adoptedStyleSheets, [pages_own]);
  sheets.set(live, "a");
  assert.equal(live.adoptedStyleSheets.length, 2);
});
