import assert from "node:assert/strict";
import { test } from "node:test";
import { find_items } from "../src/content/item/finder.ts";
import { read_saved_page, saved_reader } from "./support/snapshot_page.ts";
import type { SavedNode, SavedPage } from "./support/snapshot_page.ts";

const LONG_PROSE = "A long paragraph of plain text that the page keeps next to a list of links. ".repeat(80);

function link_up(node: SavedNode, up: SavedNode | null) {
  node.up = up;
  for (const child of node.c ?? []) link_up(child, node);
}

// Ten link rows in a main, with one long paragraph above or below them.
function list_with_prose(where: "above" | "below"): SavedPage {
  const rows = (top: number): SavedNode[] =>
    Array.from({ length: 10 }, (_, index): SavedNode => ({
      t: "li",
      a: { class: "row" },
      r: [253, top + index * 56, 1084, 56],
      c: [{ t: "a", a: { href: `/entry/${index}` }, r: [253, top + index * 56, 700, 56], s: `Entry number ${index} with a title` }],
    }));
  const prose = (top: number): SavedNode => ({ t: "p", r: [253, top, 1084, 300], s: LONG_PROSE });
  const list_top = where === "above" ? 400 : 100;
  const list: SavedNode = { t: "ul", a: { class: "rows" }, r: [253, list_top, 1084, 560], c: rows(list_top) };
  const parts = where === "above" ? [prose(70), list] : [list, prose(700)];
  const main: SavedNode = { t: "main", r: [0, 64, 1354, 1200], c: parts };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 1264], c: [{ t: "body", r: [0, 0, 1366, 1264], c: [main] }] };
  link_up(root, null);
  return { view: { w: 1366, h: 682, doc_h: 1264 }, root };
}

test("a list with long prose below it is found", () => {
  const found = find_items(saved_reader(list_with_prose("below")));
  assert.equal(found.kind, "list");
  assert.equal(found.items.length, 10);
});

test("the same list with the same prose above it is still rejected", () => {
  assert.equal(find_items(saved_reader(list_with_prose("above"))).kind, "none");
});

test("the repository file table is found with a long README below it", () => {
  const page = read_saved_page("gh_repo");
  const main = [...saved_reader(page).query_all_("main")][0]!;
  const bottom = Math.max(...(main.c ?? []).map((child) => (child.r?.[1] ?? 0) + (child.r?.[3] ?? 0)));
  const readme: SavedNode = { t: "p", r: [253, bottom + 10, 1000, 300], s: LONG_PROSE, up: main };
  main.c = [...(main.c ?? []), readme];
  const found = find_items(saved_reader(page));
  assert.equal(found.kind, "list");
  assert.ok(found.items.length >= 30);
});
