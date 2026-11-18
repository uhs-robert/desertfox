import assert from "node:assert/strict";
import { test } from "node:test";
import { find_items } from "../src/content/item/finder.ts";
import { saved_reader } from "./support/snapshot_page.ts";
import type { SavedNode, SavedPage } from "./support/snapshot_page.ts";

// A stand-in for a video site's front page, written by hand: a grid of thumbnail tiles, four to a row. Each tile holds the picture link (with its length and quality over it), the title link under the picture and a short channel link. Both links of a tile go to the same video.
function video_grid(tile_height = (_index: number) => 256): SavedPage {
  const tile = (index: number): SavedNode => {
    const [x, y] = [35 + (index % 4) * 330, 120 + Math.floor(index / 4) * 270];
    const video = `/video/${index}/a-video`;
    return {
      t: "div",
      a: { class: "tile" },
      r: [x, y, 321, tile_height(index)],
      c: [
        { t: "a", a: { class: "thumb", href: video }, r: [x, y, 321, 200], s: "10 min 720p", c: [{ t: "img", r: [x, y, 321, 200] }] },
        { t: "p", a: { class: "title" }, r: [x, y + 205, 321, 20], n: 40, c: [{ t: "a", a: { href: video }, r: [x, y + 205, 300, 20], s: `The video with the number ${index} in its title` }] },
        { t: "p", a: { class: "meta" }, r: [x, y + 230, 321, 18], n: 12, c: [{ t: "a", a: { href: `/channel/${index}` }, r: [x, y + 230, 90, 18], s: "Channel name" }] },
      ],
    };
  };
  const grid: SavedNode = { t: "div", a: { class: "grid" }, r: [35, 120, 1310, 1610], c: Array.from({ length: 24 }, (_, index) => tile(index)) };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 1800], c: [{ t: "body", r: [0, 0, 1366, 1800], c: [grid] }] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  return { view: { w: 1366, h: 682, doc_h: 1800 }, root };
}

test("a grid of video thumbnails is a grid, and the title under each picture is the link that takes the focus", () => {
  const found = find_items(saved_reader(video_grid()));
  assert.equal(found.kind, "grid");
  assert.equal(found.items.length, 24);
  assert.ok(found.items.every((item) => found.links.get(item)?.s?.startsWith("The video with the number")));
});

test("top-aligned cards of unequal height in a row are still a grid", () => {
  const found = find_items(saved_reader(video_grid((index) => 200 + (index % 4) * 20)));
  assert.equal(found.kind, "grid");
});

// Sections stacked down the page, each holding two cards that fill about 46% of it (the shape of a news front). The cards are the items, not the sections and not the pieces of a card.
test("cards that fill nearly half of every section stay the picked items", () => {
  const card = (x: number, y: number, index: number): SavedNode => ({
    t: "div",
    a: { class: "card" },
    r: [x, y, 300, 300],
    c: [
      { t: "a", a: { href: `/story/${index}` }, r: [x, y, 300, 20], s: `Story number ${index} headline`, c: [] },
      { t: "p", r: [x, y + 30, 300, 100], n: 200, c: [] },
    ],
  });
  const section = (index: number): SavedNode => {
    const y = 100 + index * 400;
    return { t: "section", a: { class: "block" }, r: [35, y, 1300, 300], c: [card(35, y, index * 2), card(400, y, index * 2 + 1)] };
  };
  const body: SavedNode = { t: "body", r: [0, 0, 1366, 2600], c: Array.from({ length: 6 }, (_, index) => section(index)) };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 2600], c: [body] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  const found = find_items(saved_reader({ view: { w: 1366, h: 682, doc_h: 2600 }, root }));
  assert.equal(found.items.length, 12);
  assert.ok(found.items.every((item) => item.a?.class === "card"));
});

// Five sections, three of which hold two small blocks each, and four more such blocks outside every section. Three of five is under the share that marks card parts, so the finder steps into the blocks. An item with no holder must not count as a fourth holder.
test("an inner group held by three of five sections, with items outside them, is not card parts", () => {
  const block = (x: number, y: number, index: number): SavedNode => ({
    t: "div",
    a: { class: "block" },
    r: [x, y, 300, 100],
    c: [{ t: "a", a: { href: `/story/${index}` }, r: [x, y, 300, 20], s: `Story number ${index} headline`, c: [] }],
  });
  const section = (index: number): SavedNode => {
    const y = 100 + index * 400;
    const blocks = index < 3 ? [block(35, y, index * 2), block(35, y + 120, index * 2 + 1)] : [];
    return { t: "section", a: { class: "block_group" }, r: [35, y, 1300, 300], c: blocks };
  };
  const outside: SavedNode = { t: "div", a: { class: "extra" }, r: [35, 2100, 1300, 480], c: [0, 1, 2, 3].map((index) => block(35, 2100 + index * 120, 10 + index)) };
  const body: SavedNode = { t: "body", r: [0, 0, 1366, 2600], c: [...Array.from({ length: 5 }, (_, index) => section(index)), outside] };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 2600], c: [body] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  const found = find_items(saved_reader({ view: { w: 1366, h: 682, doc_h: 2600 }, root }));
  assert.equal(found.items.length, 10);
  assert.equal(found.sections?.length, 5);
});

// Ten stacked comment panels. Each has a short link at the top and a long link low in the panel ("Show 12 more replies"), and both go to the same address. When that address is a placeholder the two links do not name one target, so the long link is no title and the panels are no list. A real shared address still names the item.
function reply_panels(href: string): SavedPage {
  const panel = (index: number): SavedNode => {
    const y = 100 + index * 220;
    return {
      t: "div",
      a: { class: "panel" },
      r: [35, y, 800, 200],
      c: [
        { t: "a", a: { href }, r: [35, y, 60, 20], s: "Reply", c: [] },
        { t: "a", a: { href }, r: [35, y + 150, 300, 20], s: "Show 12 more replies", c: [] },
      ],
    };
  };
  const list: SavedNode = { t: "div", a: { class: "thread" }, r: [35, 100, 800, 2200], c: Array.from({ length: 10 }, (_, index) => panel(index)) };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 2400], c: [{ t: "body", r: [0, 0, 1366, 2400], c: [list] }] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  return { view: { w: 1366, h: 682, doc_h: 2400 }, root };
}

test("links that share only a placeholder address do not name their panel", () => {
  for (const href of ["#", "", "javascript:void(0)", " JavaScript:;"]) {
    assert.equal(find_items(saved_reader(reply_panels(href))).items.length, 0, `href ${JSON.stringify(href)}`);
  }
});

test("links that share a real address or a fragment name their panel", () => {
  for (const href of ["/thread/7", "#item-3"]) {
    assert.equal(find_items(saved_reader(reply_panels(href))).items.length, 10, `href ${JSON.stringify(href)}`);
  }
});
