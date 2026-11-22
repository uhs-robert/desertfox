import assert from "node:assert/strict";
import { test } from "node:test";
import { find_items } from "../src/content/item/finder.ts";
import { saved_reader } from "./support/snapshot_page.ts";
import type { SavedNode, SavedPage } from "./support/snapshot_page.ts";

// A stand-in for a notification inbox, written by hand: ten records in a list. Each record is a row of two blocks of one class: the title link on the left, and on the right the date with the avatars of the people in the thread. A record with one avatar has a lone link in its right block, which made the two blocks of such records a list of their own.
function inbox({ side_height = 20, lone_avatar = [4, 8], count = 10, in_main = true, top = 188 } = {}): SavedPage {
  const record = (index: number): SavedNode => {
    const y = top + index * 56;
    const avatars = lone_avatar.includes(index) ? 1 : 2;
    return {
      t: "li",
      a: { class: "record unread" },
      r: [253, y, 1084, 56],
      c: [
        {
          t: "div",
          a: { class: "row" },
          r: [261, y, 1076, 55],
          c: [
            { t: "div", a: { class: "block main" }, r: [261, y, 782, 55], c: [{ t: "a", a: { class: "title", href: `/thread/${index}` }, r: [299, y, 744, 55], s: `owner/repo #${index} The title of thread number ${index}` }] },
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
  const list: SavedNode = { t: "ul", a: { class: "records" }, r: [253, top, 1084, count * 56], c: Array.from({ length: count }, (_, index) => record(index)) };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 852], c: [{ t: "body", r: [0, 0, 1366, 852], c: [in_main ? { t: "main", r: [0, 64, 1354, 788], c: [list] } : list] }] };
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
