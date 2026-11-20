import assert from "node:assert/strict";
import { test } from "node:test";
import { find_aria_lists } from "../src/content/item/aria_lists.ts";
import { create_derived_row } from "../src/content/item/derived.ts";
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
const rows = (count: number, role: string | null, { tag = "div", top = 100, height = 40, width = 1000, attrs = {} as Record<string, string>, kids = (_index: number): SavedNode[] => [], text = (index: number) => `row ${index} with a subject line` } = {}): SavedNode[] =>
  Array.from({ length: count }, (_, index) => ({ t: tag, a: { ...(role && { role }), ...attrs }, r: [20, top + index * height, width, height], c: kids(index), s: text(index) }));

const widget = (role: string, items: SavedNode[], attrs: Record<string, string> = {}, tag = "div"): SavedNode => ({ t: tag, a: { role, ...attrs }, r: [20, 100, 1000, Math.max(40, items.length * 40)], c: items });

const regions_of = (page: SavedPage, taken = []) => find_aria_lists(saved_reader(page), () => false, taken) ?? [];

test("a grid of link-less rows is one pick-only list whose link is the row itself", () => {
  const items = rows(25, "row", { tag: "tr", attrs: { tabindex: "-1" } });
  const found = find_items(saved_reader(page_of(widget("grid", items, {}, "table"))));
  assert.equal(found.kind, "none", "the start and the first answer never see it");
  assert.equal(found.regions.length, 1);
  const [region] = found.regions;
  assert.equal(region!.pick_only_, true);
  assert.equal(region!.items.length, 25);
  assert.ok(region!.items.every((item) => region!.links.get(item) === item));
  assert.equal(region!.box_selector_, "[role=row],tr:not([role])");
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

test("a tree is flat: every shown treeitem is an item, a branch by its own label, the hidden ones left out", () => {
  const leaf = (top: number, hidden = false): SavedNode => ({ t: "li", a: { role: "treeitem" }, r: [20, top, 300, 30], ...(hidden && { h: 1 as const }) });
  const label: SavedNode = { t: "span", r: [20, 100, 300, 30] };
  const open_branch: SavedNode = { t: "li", a: { role: "treeitem", "aria-expanded": "true" }, r: [20, 100, 300, 90], c: [label, { t: "ul", a: { role: "group" }, r: [20, 130, 300, 60], c: [leaf(130), leaf(160)] }] };
  const bare_branch: SavedNode = { t: "li", a: { role: "treeitem" }, r: [20, 250, 300, 90], c: [{ t: "ul", r: [20, 250, 300, 90], c: [leaf(250)] }] };
  const collapsed: SavedNode = { t: "li", a: { role: "treeitem", "aria-expanded": "false" }, r: [20, 190, 300, 30], c: [{ t: "ul", a: { role: "group" }, h: 1, c: [leaf(0, true)] }] };
  const tree = widget("tree", [open_branch, leaf(190 + 1), collapsed, leaf(220), leaf(280, true), bare_branch]);
  const [region] = regions_of(page_of(tree));
  assert.equal(region!.items[0], label, "an open branch stands for its label");
  assert.equal(region!.items.length, 8);
  assert.ok(region!.items.includes(collapsed), "a collapsed branch is one item");
  assert.ok(!region!.items.includes(open_branch));
  assert.ok(region!.items.includes(bare_branch), "a branch with no label child is its own item");
  assert.equal(region!.box_selector_, "[role=treeitem]:not(:has([role=treeitem]))");
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
  const days = (index: number) => Array.from({ length: 7 }, (_, day) => (index * 7 + day) % 31 + 1).join("");
  assert.deepEqual(regions_of(page_of(widget("grid", rows(6, "row", { height: 44, width: 400, text: days })))), [], "a wide calendar too");
  const spaced = (index: number) => `\n  ${index * 7 + 1}\n  ${index * 7 + 2}\n  ${index * 7 + 3}\n  ${index * 7 + 4}\n  ${index * 7 + 5}\n  ${index * 7 + 6}\n  ${index * 7 + 7}\n`;
  assert.deepEqual(regions_of(page_of(widget("grid", rows(6, "row", { height: 44, width: 400, text: spaced })))), [], "whitespace between the cells does not count");
  assert.deepEqual(regions_of(page_of({ t: "div", a: { role: "dialog" }, r: [0, 0, 1000, 600], c: [widget("listbox", rows(8, "option"))] })), []);
  assert.deepEqual(regions_of(page_of({ t: "div", a: { role: "alertdialog" }, r: [0, 0, 1000, 600], c: [widget("listbox", rows(8, "option"))] })), []);
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

test("the pass gives no answer when the time is out, also inside one widget", () => {
  const page = page_of(widget("listbox", rows(500, "option")));
  assert.equal(find_aria_lists(saved_reader(page), () => true, []), undefined);
  let reads = 0;
  assert.equal(find_aria_lists(saved_reader(page), () => ++reads > 50, []), undefined, "the clock runs out after the first widget check");
  assert.ok(reads < 120, `the walk went on after the clock ran out: ${reads} checks`);
  const found = find_items(saved_reader(page), { now_: (() => { let at = 0; return () => at++; })(), budget_ms_: 100 });
  assert.equal(found.timed_out_, true, "the finder marks the answer as timed out");
});

test("a big listbox that runs out of time leaves the finder's own list in the answer", () => {
  const counted = (page: SavedPage, budget_ms_: number) => {
    let calls = 0;
    const found = find_items(saved_reader(page), { now_: () => calls++, budget_ms_ });
    return { found, calls };
  };
  const list = { t: "div", r: [20, 100, 600, 1200], c: cards(10, 100) } as SavedNode;
  const page = page_of(list, widget("listbox", rows(500, "option", { top: 1500 })));
  // The walk of the 500 options reads the clock about a thousand times, at the end of the read, so a budget 300 reads short of the total runs out inside it.
  const { found } = counted(page, counted(page, 1e9).calls - 300);
  assert.equal(found.timed_out_, undefined);
  assert.equal(found.items.length, 10);
  assert.equal(found.regions.length, 1);
});

test("a feed that is the finder's own list is skipped without a walk", () => {
  const feed = widget("feed", cards(10, 100, "article"));
  let nodes_read = 0;
  const reader = saved_reader(page_of(feed));
  const counting = { ...reader, children_: (node: SavedNode) => (nodes_read++, reader.children_(node)) };
  const found = find_items(counting);
  const before = nodes_read;
  find_aria_lists(counting, () => false, found.regions);
  assert.ok(nodes_read - before < 20, `the pass walked the feed: ${nodes_read - before} reads`);
});

test("rows of a native table grid are items, and its header row is not", () => {
  const header: SavedNode = { t: "tr", r: [20, 60, 1000, 40], c: [{ t: "th", r: [20, 60, 500, 40] }] };
  const table = widget("grid", [header, ...rows(6, null, { tag: "tr" })], {}, "table");
  const [region] = regions_of(page_of(table));
  assert.equal(region!.items.length, 6);
  assert.equal(region!.box_selector_, "[role=row],tr:not([role])");
});

test("a page whose only list is an ARIA grid starts nothing: the derived row answers no item before a pick", () => {
  const page = page_of(widget("grid", rows(10, "row")));
  const row = create_derived_row({ find_: () => find_items(saved_reader(page)) as never, url_: () => "https://a.test/", now_: () => 0, is_shown_: () => true, in_view_: () => 1, tail_: () => [] });
  assert.deepEqual(row.items_(), []);
  assert.equal(row.lists_().length, 1);
});
