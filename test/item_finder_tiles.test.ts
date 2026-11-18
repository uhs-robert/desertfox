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
