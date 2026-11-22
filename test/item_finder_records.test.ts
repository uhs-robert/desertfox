import assert from "node:assert/strict";
import { test } from "node:test";
import { find_items } from "../src/content/item/finder.ts";
import { saved_reader } from "./support/snapshot_page.ts";
import type { SavedNode, SavedPage } from "./support/snapshot_page.ts";

// A stand-in for a notification inbox, written by hand: ten records in a list. Each record is a row of two blocks of one class: the title link on the left, and on the right the date with the avatars of the people in the thread. A record with one avatar has a lone link in its right block, which made the two blocks of such records a list of their own.
function inbox({ side_height = 20, lone_avatar = [4, 8], count = 10, in_main = true, top = 188, hidden_main = false, one_row = false, untitled = false, sideways = false, short_above = 0 } = {}): SavedPage {
  const record = (index: number, y0 = top): SavedNode => {
    const y = one_row ? y0 : y0 + index * 56;
    const x = one_row ? 253 + index * 360 : 253;
    const avatars = lone_avatar.includes(index) ? 1 : 2;
    return {
      t: "li",
      a: { class: "record unread" },
      r: [x, y, one_row ? 340 : 1084, 56],
      c: [
        {
          t: "div",
          a: { class: "row" },
          r: [261, y, 1076, 55],
          c: [
            { t: "div", a: { class: "block main" }, r: [261, y, 782, 55], c: [{ t: "a", a: { class: "title", href: `/thread/${index}` }, r: [299, y, 744, 55], s: untitled ? "" : `owner/repo #${index} The title of thread number ${index}` }] },
            {
              t: "div",
              a: { class: "block side" },
              r: [1043, y + 18, 294, side_height],
              c: [
                { t: "p", a: { class: "note" }, r: [1043, y + 18, 140, 20], n: 12 },
                ...Array.from({ length: avatars }, (_, at): SavedNode => ({ t: "a", a: { class: "avatar", href: `/user${at}` }, r: [1173 + at * 20, y + 16, 24, 24], s: "" })),
              ],
            },
          ],
        },
      ],
    };
  };
  const list: SavedNode = { t: "ul", a: { class: "records" }, ...(sideways ? { x: 1 as const } : {}), r: [253, top, 1084, count * 56], c: Array.from({ length: count }, (_, index) => record(index)) };
  // A short list of another class above the long one, both in the first screen.
  const above: SavedNode[] = short_above ? [{ t: "ul", a: { class: "pinned" }, r: [253, 70, 1084, short_above * 56], c: Array.from({ length: short_above }, (_, index) => record(index, 70)) }] : [];
  const main: SavedNode = { t: "main", r: [0, 64, 1354, 788], ...(hidden_main ? { h: 1 as const } : {}), c: [...above, list] };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 852], c: [{ t: "body", r: [0, 0, 1366, 852], c: [in_main ? main : list] }] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  return { view: { w: 1366, h: 682, doc_h: 852 }, root };
}

for (const [what, options] of [["short", { side_height: 20 }], ["tall", { side_height: 26 }]] as const) {
  test(`a list of records with a ${what} side block walks the records, not the blocks of a few of them`, () => {
    const found = find_items(saved_reader(inbox(options)));
    assert.equal(found.kind, "list");
    assert.deepEqual(found.items.map((item) => item.t), Array(10).fill("li"));
    assert.ok(found.items.every((item) => found.links.get(item)?.a?.class === "title"));
  });
}

for (const count of [2, 3, 5]) {
  test(`a short inbox of ${count} records in main is the answer, not a pick-only list`, () => {
    const found = find_items(saved_reader(inbox({ count })));
    assert.equal(found.kind, "list");
    assert.equal(found.pick_only_, undefined);
    assert.deepEqual(found.items.map((item) => item.t), Array(count).fill("li"));
    assert.equal(found.regions?.[0]?.items.length, count);
  });
}

test("two records with one avatar each walk the records, not the halves", () => {
  const found = find_items(saved_reader(inbox({ count: 2, lone_avatar: [0, 1] })));
  assert.deepEqual(found.items.map((item) => item.t), ["li", "li"]);
});

test("one record is no list", () => {
  assert.equal(find_items(saved_reader(inbox({ count: 1 }))).kind, "none");
});

for (const [what, options] of [["with no main", { in_main: false }], ["below the first screen of main", { top: 900 }]] as const) {
  test(`two records ${what} are no list`, () => {
    assert.equal(find_items(saved_reader(inbox({ count: 2, ...options }))).kind, "none");
  });
}

test("a hidden main with a short list answers none and does not throw", () => {
  assert.equal(find_items(saved_reader(inbox({ count: 2, hidden_main: true }))).kind, "none");
});

test("three items in one row are no short list", () => {
  assert.equal(find_items(saved_reader(inbox({ count: 3, one_row: true }))).kind, "none");
});

test("records with no title link are no short list", () => {
  assert.equal(find_items(saved_reader(inbox({ count: 3, untitled: true }))).kind, "none");
});

test("a short list that scrolls sideways is no short list", () => {
  assert.equal(find_items(saved_reader(inbox({ count: 3, sideways: true }))).kind, "none");
});

// Main starts at y 64 and the view is 682 high, so its first screen ends at 746, past the 682 of the page's own first screen.
test("a short list that starts inside the first screen of main, below the first screen of the page, is the answer", () => {
  assert.equal(find_items(saved_reader(inbox({ count: 3, top: 720 }))).kind, "list");
});

test("a short list that starts just past the first screen of main is no list", () => {
  assert.equal(find_items(saved_reader(inbox({ count: 3, top: 750 }))).kind, "none");
});

test("a long list keeps the answer over a short list above it", () => {
  const found = find_items(saved_reader(inbox({ count: 10, top: 300, short_above: 3 })));
  assert.equal(found.items.length, 10);
  assert.equal(found.pick_only_, undefined);
  assert.deepEqual(found.regions?.map((region) => region.items.length), [10, 3]);
});

// Two sections of three cards each. The sections alone are two rows, so only the short-list rule makes them the page's list, and the cards inside are the walk.
test("a short list of sections walks the cards inside them", () => {
  const card = (y: number, at: number): SavedNode => ({ t: "li", a: { class: "card" }, r: [261, y + at * 56, 1060, 56], c: [{ t: "a", a: { class: "title", href: `/card/${y}/${at}` }, r: [261, y + at * 56, 1060, 56], s: `A card of the section at ${y}, number ${at}` }] });
  const section = (y: number): SavedNode => ({ t: "li", a: { class: "section" }, r: [253, y, 1084, 180], c: [{ t: "ul", a: { class: "cards" }, r: [261, y, 1060, 168], c: [0, 1, 2].map((at) => card(y, at)) }] });
  const list: SavedNode = { t: "ul", a: { class: "sections" }, r: [253, 100, 1084, 380], c: [section(100), section(300)] };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 852], c: [{ t: "body", r: [0, 0, 1366, 852], c: [{ t: "main", r: [0, 64, 1354, 788], c: [list] }] }] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  const found = find_items(saved_reader({ view: { w: 1366, h: 682, doc_h: 852 }, root }));
  assert.deepEqual(found.items.map((item) => item.a?.class), Array(6).fill("card"));
  assert.equal(found.sections?.length, 2);
  assert.equal(found.regions?.length, 1);
});
