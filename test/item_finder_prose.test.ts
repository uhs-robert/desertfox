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

const PARAGRAPH = "A paragraph of plain article text that is long enough to count as prose. ".repeat(8);

// A main holding one list of `count` link rows at (x, top) and paragraphs at the given tops (x 253 unless `side` puts them left of a rail).
function page_with(count: number, list_at: { x: number; top: number }, paragraph_tops: number[], paragraph_text = PARAGRAPH): SavedPage {
  const row = (index: number): SavedNode => ({
    t: "li",
    a: { class: "row" },
    r: [list_at.x, list_at.top + index * 56, 400, 56],
    c: [{ t: "a", a: { href: `/entry/${index}` }, r: [list_at.x, list_at.top + index * 56, 400, 56], s: `Entry number ${index} with a title` }],
  });
  const list: SavedNode = { t: "ul", a: { class: "rows" }, r: [list_at.x, list_at.top, 400, count * 56], c: Array.from({ length: count }, (_, index) => row(index)) };
  const paragraphs = paragraph_tops.map((top): SavedNode => ({ t: "p", r: [253, top, 700, 90], s: paragraph_text }));
  const before = paragraphs.filter((node) => node.r![1] < list_at.top);
  const after = paragraphs.filter((node) => node.r![1] >= list_at.top);
  const main: SavedNode = { t: "main", r: [0, 64, 1354, 3000], c: [...before, list, ...after] };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 3064], c: [{ t: "body", r: [0, 0, 1366, 3064], c: [main] }] };
  link_up(root, null);
  return { view: { w: 1366, h: 682, doc_h: 3064 }, root };
}

const tops = (from: number, count: number) => Array.from({ length: count }, (_, index) => from + index * 100);

// One long paragraph above or below ten link rows.
function list_with_prose(where: "above" | "below"): SavedPage {
  return where === "above" ? page_with(10, { x: 253, top: 400 }, [70], LONG_PROSE) : page_with(10, { x: 253, top: 100 }, [700], LONG_PROSE);
}

test("a list with long prose below it is found", () => {
  const found = find_items(saved_reader(list_with_prose("below")));
  assert.equal(found.kind, "list");
  assert.equal(found.items.length, 10);
});

test("the same list with the same prose above it is still rejected", () => {
  assert.equal(find_items(saved_reader(list_with_prose("above"))).kind, "none");
});

test("a side rail beside an article is rejected, though most of the article starts below the rail", () => {
  // The rail is 336 px tall at the right. Four paragraphs sit beside it and sixteen below.
  const found = find_items(saved_reader(page_with(6, { x: 900, top: 100 }, tops(100, 20))));
  assert.equal(found.kind, "none");
});

test("a table of contents after a short lead is rejected", () => {
  // Two paragraphs above the list are 1,100 characters of lead, then eighteen below.
  const found = find_items(saved_reader(page_with(8, { x: 253, top: 300 }, [70, 170, ...tops(800, 18)])));
  assert.equal(found.kind, "none");
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
