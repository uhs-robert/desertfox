import assert from "node:assert/strict";
import { test } from "node:test";
import { find_aria_lists } from "../src/content/item/aria_lists.ts";
import { find_items } from "../src/content/item/finder.ts";
import { saved_reader } from "./support/snapshot_page.ts";
import type { SavedNode, SavedPage } from "./support/snapshot_page.ts";

const page_of = (...body: SavedNode[]): SavedPage => {
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 3000], c: [{ t: "body", r: [0, 0, 1366, 3000], c: body }] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  return { view: { w: 1366, h: 682, doc_h: 3000 }, root };
};

// `count` rows of `height` px stacked from `top`, each `width` wide, with the role and tag given and no link in them.
const rows = (count: number, role: string, { tag = "div", top = 100, height = 40, width = 1000, attrs = {} as Record<string, string>, kids = (_index: number): SavedNode[] => [] } = {}): SavedNode[] =>
  Array.from({ length: count }, (_, index) => ({ t: tag, a: { role, ...attrs }, r: [20, top + index * height, width, height], c: kids(index), s: `row ${index}` }));

const widget = (role: string, items: SavedNode[], attrs: Record<string, string> = {}, tag = "div"): SavedNode => ({ t: tag, a: { role, ...attrs }, r: [20, 100, 1000, Math.max(40, items.length * 40)], c: items });

const regions_of = (page: SavedPage, taken = []) => find_aria_lists(saved_reader(page), () => false, taken);

test("a grid of link-less rows is one pick-only list whose link is the row itself", () => {
  const items = rows(25, "row", { tag: "tr", attrs: { tabindex: "-1" } });
  const found = find_items(saved_reader(page_of(widget("grid", items, {}, "table"))));
  assert.equal(found.kind, "none", "the start and the first answer never see it");
  assert.equal(found.regions.length, 1);
  const [region] = found.regions;
  assert.equal(region!.pick_only_, true);
  assert.equal(region!.items.length, 25);
  assert.ok(region!.items.every((item) => region!.links.get(item) === item));
  assert.equal(region!.box_selector_, "[role=row]");
  assert.equal(region!.focus_none_, undefined);
});

test("a listbox that names its active option keeps the focus, and the widget names the region", () => {
  const box = widget("listbox", rows(10, "option"), { tabindex: "0", "aria-activedescendant": "o3" });
  const [region] = regions_of(page_of(box));
  assert.equal(region!.focus_none_, true);
  assert.equal(region!.home_, box);
  assert.equal(region!.box_selector_, "[role=option]");
  assert.equal(regions_of(page_of(widget("listbox", rows(10, "option"))))[0]!.focus_none_, undefined);
  const owner: SavedNode = { t: "div", a: { "aria-activedescendant": "o3" }, r: [0, 0, 1000, 400], c: [widget("listbox", rows(10, "option"))] };
  assert.equal(regions_of(page_of(owner))[0]!.focus_none_, true, "a focus owner around the widget counts");
});

test("a feed of articles with no link is a list", () => {
  const [region] = regions_of(page_of(widget("feed", rows(8, "article", { tag: "article", height: 120 }))));
  assert.equal(region!.items.length, 8);
});

test("a tree is flat: the leaves, with a collapsed branch as one item and the hidden ones left out", () => {
  const leaf = (top: number, hidden = false): SavedNode => ({ t: "li", a: { role: "treeitem" }, r: [20, top, 300, 30], ...(hidden && { h: 1 as const }) });
  const open_branch: SavedNode = { t: "li", a: { role: "treeitem", "aria-expanded": "true" }, r: [20, 100, 300, 90], c: [{ t: "ul", a: { role: "group" }, r: [20, 130, 300, 60], c: [leaf(130), leaf(160)] }] };
  const [region] = regions_of(page_of(widget("tree", [open_branch, leaf(190), leaf(220), leaf(250, true)])));
  assert.equal(region!.items.length, 4);
  assert.ok(!region!.items.includes(open_branch));
  assert.ok(region!.items.every((item) => item.h !== 1));
});

test("replies inside a post are no items of the feed", () => {
  const reply: SavedNode = { t: "article", a: { role: "article" }, r: [60, 180, 600, 40] };
  const posts = rows(5, "article", { tag: "article", height: 120, kids: (index) => (index === 0 ? [reply] : []) });
  const [region] = regions_of(page_of(widget("feed", posts)));
  assert.equal(region!.items.length, 5);
  assert.ok(!region!.items.includes(reply));
});

test("the header row of a grid is no item", () => {
  const header: SavedNode = { t: "div", a: { role: "row" }, r: [20, 60, 1000, 40], c: [{ t: "div", a: { role: "columnheader" }, r: [20, 60, 500, 40] }] };
  const [region] = regions_of(page_of(widget("grid", [header, ...rows(5, "row")])));
  assert.equal(region!.items.length, 5);
});

test("a calendar grid, a combobox popup and a widget in a dialog or a menu give no list", () => {
  const calendar = widget("grid", rows(6, "row", { height: 40, width: 280 }));
  assert.deepEqual(regions_of(page_of(calendar)), []);
  const field: SavedNode = { t: "input", a: { role: "combobox", "aria-controls": "popup" }, r: [20, 50, 300, 30] };
  assert.deepEqual(regions_of(page_of(field, widget("listbox", rows(8, "option"), { id: "popup" }))), []);
  assert.deepEqual(regions_of(page_of({ t: "dialog", r: [0, 0, 1000, 600], c: [widget("listbox", rows(8, "option"))] })), []);
  assert.deepEqual(regions_of(page_of({ t: "div", a: { "aria-modal": "true" }, r: [0, 0, 1000, 600], c: [widget("listbox", rows(8, "option"))] })), []);
  assert.deepEqual(regions_of(page_of({ t: "div", a: { role: "menu" }, r: [0, 0, 1000, 600], c: [widget("listbox", rows(8, "option"))] })), []);
});

test("a widget in a navigation landmark stays", () => {
  assert.equal(regions_of(page_of({ t: "nav", r: [0, 0, 300, 600], c: [widget("tree", rows(8, "treeitem", { tag: "li", width: 260 }))] })).length, 1);
});

test("a widget with fewer than three stacked rows, or rows too small, gives no list", () => {
  assert.deepEqual(regions_of(page_of(widget("listbox", rows(2, "option")))), []);
  assert.deepEqual(regions_of(page_of(widget("listbox", rows(8, "option", { height: 16 })))), []);
});

// A finder list of cards, each a role=article of a feed, with a title link in a heading.
const cards = (count: number, top: number, role?: string): SavedNode[] =>
  Array.from({ length: count }, (_, index) => ({
    t: "div",
    a: { class: "card", ...(role && { role }) },
    r: [20, top + index * 120, 600, 100],
    c: [{ t: "h3", r: [20, top + index * 120, 500, 24], c: [{ t: "a", a: { href: `/p/${index}` }, r: [20, top + index * 120, 500, 24], s: `A card title that is long enough ${index}` }] }],
  }));

test("a finder list that is also an ARIA feed is one region, the finder's", () => {
  const found = find_items(saved_reader(page_of(widget("feed", cards(10, 100, "article")))));
  assert.equal(found.regions.length, 1);
  assert.equal(found.regions[0]!.pick_only_, undefined);
  assert.equal(found.items.length, 10);
});

test("a short ARIA list lies after the finder's long and short lists, pick-only, and the start ignores it", () => {
  const short_rows: SavedNode[] = Array.from({ length: 5 }, (_, index) => ({ t: "div", a: { class: "note" }, r: [20, 1500 + index * 44, 500, 40], c: [{ t: "h3", r: [20, 1500 + index * 44, 400, 24], c: [{ t: "a", a: { href: `/n/${index}` }, r: [20, 1500 + index * 44, 400, 24], s: `A notification title text ${index}` }] }] }));
  const sidebar = widget("tree", rows(6, "treeitem", { tag: "li", top: 2000, width: 260 }));
  const found = find_items(saved_reader(page_of({ t: "div", r: [20, 100, 600, 1200], c: cards(10, 100) }, { t: "div", r: [20, 1500, 500, 220], c: short_rows }, sidebar)));
  assert.deepEqual(
    found.regions.map((region) => region.pick_only_ ?? false),
    [false, true, true],
  );
  assert.equal(found.regions[2]!.home_, sidebar);
  assert.equal(found.items.length, 10);
});

test("a widget inside an item of an earlier ARIA list is dropped", () => {
  const inner = widget("listbox", rows(5, "option", { top: 100, width: 400 }));
  const outer = widget("feed", rows(5, "article", { tag: "article", height: 200, kids: (index) => (index === 0 ? [inner] : []) }));
  assert.equal(regions_of(page_of(outer)).length, 1);
});

test("the pass stops when the time is out", () => {
  assert.deepEqual(find_aria_lists(saved_reader(page_of(widget("listbox", rows(8, "option")))), () => true, []), []);
});
