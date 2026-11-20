import assert from "node:assert/strict";
import { test } from "node:test";
import { find_items } from "../src/content/item/finder.ts";
import { find_menus } from "../src/content/item/menus.ts";
import { saved_reader } from "./support/snapshot_page.ts";
import type { SavedNode, SavedPage } from "./support/snapshot_page.ts";

const link = (x: number, y: number, index: number): SavedNode => ({ t: "a", a: { href: `/page/${index}` }, r: [x, y, 150, 20], s: `Link ${index}` });
const entry = (x: number, y: number, index: number): SavedNode => ({ t: "li", r: [x, y, 150, 30], c: [link(x, y, index)] });
// A vertical stack of `count` items in a ul, from (x, y).
const stack = (count: number, x = 0, y = 100): SavedNode => ({ t: "ul", r: [x, y, 150, count * 30], c: Array.from({ length: count }, (_, at) => entry(x, y + at * 30, at)) });
// A horizontal row of `count` items.
const row = (count: number): SavedNode => ({ t: "ul", r: [0, 10, count * 160, 30], c: Array.from({ length: count }, (_, at) => entry(at * 160, 10, at)) });
const around = (tag: string, box: [number, number, number, number], children: SavedNode[], role?: string): SavedNode => ({ t: tag, ...(role ? { a: { role } } : {}), r: box, c: children });

function page(...body: SavedNode[]): SavedPage {
  const root: SavedNode = { t: "html", r: [0, 0, 1200, 3000], c: [{ t: "body", r: [0, 0, 1200, 3000], c: body }] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  return { view: { w: 1200, h: 800, doc_h: 3000 }, root };
}
const menus_of = (...body: SavedNode[]) => find_menus(saved_reader(page(...body)), () => false);

// A list of ten cards, tall enough to be the page's long list.
const results = (): SavedNode => ({
  t: "div",
  a: { class: "results" },
  r: [300, 0, 800, 1200],
  c: Array.from({ length: 10 }, (_, at) => ({ t: "div", a: { class: "card" }, r: [300, at * 120, 800, 100], c: [{ t: "h3", r: [300, at * 120, 700, 30], c: [{ t: "a", a: { href: `/result/${at}` }, r: [300, at * 120, 600, 20], s: `Result number ${at} with a long title` }] }] })),
});

test("a nav with a stack of four links is a menu, and each item maps to its link", () => {
  const nav = around("nav", [0, 100, 150, 120], [stack(4)]);
  const [menu] = menus_of(nav);
  assert.equal(menu!.items.length, 4);
  assert.equal(menu!.pick_only_, true);
  assert.ok(menu!.items.every((item) => menu!.links.get(item)?.t === "a"));
});

test("a horizontal bar, a stack of three, a header or footer nav and an off-page drawer are no menus", () => {
  assert.deepEqual(menus_of(around("nav", [0, 0, 800, 50], [row(5)])), []);
  assert.deepEqual(menus_of(around("nav", [0, 100, 150, 90], [stack(3)])), []);
  assert.deepEqual(menus_of(around("header", [0, 0, 1200, 300], [around("nav", [0, 100, 150, 120], [stack(5)])])), []);
  assert.deepEqual(menus_of(around("div", [0, 2500, 1200, 300], [around("nav", [0, 2600, 150, 120], [stack(5, 0, 2600)])], "contentinfo")), []);
  assert.deepEqual(menus_of(around("nav", [-300, 100, 150, 150], [stack(5, -300)])), []);
});

test("a role navigation and an aside are candidates, and an aside around a nav gives one menu", () => {
  assert.equal(menus_of(around("div", [0, 100, 150, 150], [stack(5)], "navigation")).length, 1);
  assert.equal(menus_of(around("aside", [0, 100, 150, 150], [stack(5)])).length, 1);
  const inner = around("nav", [0, 100, 150, 150], [stack(5)]);
  assert.equal(menus_of(around("aside", [0, 100, 150, 150], [inner])).length, 1);
});

test("a page of one menu answers none with the menu in its regions, pick-only, so item mode never starts on it", () => {
  const found = find_items(saved_reader(page(around("nav", [0, 100, 150, 150], [stack(5)]))));
  assert.equal(found.kind, "none");
  assert.deepEqual([found.items, found.regions.length, found.regions[0]?.pick_only_], [[], 1, true]);
});

test("a page with a long list and a menu keeps the list first and the menu last", () => {
  const found = find_items(saved_reader(page(around("nav", [0, 100, 150, 150], [stack(5)]), results())));
  assert.equal(found.kind, "list");
  assert.equal(found.items.length, 10);
  assert.deepEqual(found.regions.map((region) => [region.items.length, region.pick_only_]), [[10, undefined], [5, true]]);
});

test("a spent time budget loses the menus", () => {
  assert.deepEqual(find_menus(saved_reader(page(around("nav", [0, 100, 150, 150], [stack(5)]))), () => true), []);
});
