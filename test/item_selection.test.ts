import assert from "node:assert/strict";
import { test } from "node:test";
import { create_selection, keys_of, settle } from "../src/content/item/selection.ts";

// An item with the two facts the keys read: the address of its link and `data-id`.
const item = (href?: string, id?: string) =>
  ({
    matches: () => false,
    querySelector: () => (href === undefined ? null : { getAttribute: () => href }),
    getAttribute: () => id ?? null,
  }) as unknown as Element;

test("keys come from the link address when every item has its own, else data-id, else the row index", () => {
  assert.deepEqual(keys_of([item("/a", "1"), item("/b", "2")]), ["/a", "/b"]);
  assert.deepEqual(keys_of([item("/a", "1"), item("/a", "2")]), ["1", "2"], "a repeated address falls to data-id");
  assert.deepEqual(keys_of([item("/a", "1"), item("/a")]), ["0", "1"], "one item with no id falls to the row index");
  assert.deepEqual(keys_of([item(undefined, "1"), item("/a", "1")]), ["0", "1"]);
});

test("settle finds each end by key, else at its last place clamped to the list, and gives nothing for an empty list", () => {
  assert.deepEqual(settle(["a", "b", "c"], [["c", 0], ["a", 2]]), [2, 0], "the key wins over the place");
  assert.deepEqual(settle(["a", "b"], [["x", 5], ["y", 0]]), [1, 0], "a removed end takes the clamped place");
  assert.equal(settle([], [["a", 0], ["a", 0]]), undefined);
});

// The page: a list the test replaces, the mode, and what the store told its owner.
function make(initial: Element[]) {
  const page = { items: initial, visual: true, followed: [] as Element[], ended: 0 };
  const selection = create_selection({ items_: () => page.items, in_visual_: () => page.visual, follow_: (found) => page.followed.push(found), ended_: () => page.ended++ });
  return { page, selection };
}
const row = (...hrefs: string[]) => hrefs.map((href) => item(href));
const range_hrefs = (selection: ReturnType<typeof make>["selection"], page: { items: Element[] }) => selection.tick_()?.range_.map((found) => page.items.indexOf(found));

test("a start sets both ends and a later land moves the cursor only, in both directions", () => {
  const { page, selection } = make(row("/a", "/b", "/c", "/d"));
  selection.start_next_land_(true);
  selection.land_(page.items[1]!);
  selection.start_next_land_(false);
  assert.deepEqual(range_hrefs(selection, page), [1]);
  selection.land_(page.items[3]!);
  assert.deepEqual(range_hrefs(selection, page), [1, 2, 3]);
  selection.land_(page.items[0]!);
  assert.deepEqual(range_hrefs(selection, page), [0, 1], "the cursor passed the anchor, which stays");
  assert.equal(selection.tick_()?.anchor_, page.items[1]);
});

test("the ends follow their items when the page replaces every node", () => {
  const { page, selection } = make(row("/a", "/b", "/c", "/d"));
  selection.start_next_land_(true);
  selection.land_(page.items[1]!);
  selection.start_next_land_(false);
  selection.land_(page.items[3]!);
  page.items = row("/a", "/b", "/c", "/d");
  assert.deepEqual(range_hrefs(selection, page), [1, 2, 3]);
  assert.equal(selection.tick_()?.cursor_, page.items[3]);
  assert.equal(page.followed.at(-1), page.items[3], "the next move starts from the new node");
});

test("an end that left the list takes its neighbour, and the selection goes on", () => {
  const { page, selection } = make(row("/a", "/b", "/c", "/d", "/e"));
  selection.start_next_land_(true);
  selection.land_(page.items[1]!);
  selection.start_next_land_(false);
  selection.land_(page.items[3]!);
  // The cursor's row goes: the cursor takes the row that now stands at its place.
  page.items = row("/a", "/b", "/c", "/e");
  assert.deepEqual(range_hrefs(selection, page), [1, 2, 3]);
  // The anchor's row goes: the anchor takes the row at its place.
  page.items = row("/a", "/c", "/e");
  assert.deepEqual(range_hrefs(selection, page), [1, 2]);
  assert.equal(page.ended, 0);
});

test("both ends past the new end of a shorter list clamp to its last item", () => {
  const { page, selection } = make(row("/a", "/b", "/c", "/d"));
  selection.start_next_land_(true);
  selection.land_(page.items[2]!);
  selection.start_next_land_(false);
  selection.land_(page.items[3]!);
  page.items = row("/a");
  assert.deepEqual(range_hrefs(selection, page), [0]);
  assert.equal(page.ended, 0);
});

test("a list with no items ends the selection once and tells its owner", () => {
  const { page, selection } = make(row("/a", "/b"));
  selection.start_next_land_(true);
  selection.land_(page.items[0]!);
  page.items = [];
  assert.equal(selection.tick_(), undefined);
  assert.equal(page.ended, 1);
  assert.equal(selection.tick_(), undefined);
  assert.equal(page.ended, 1, "nothing is left to end");
});

test("leaving the mode drops the selection, so the next land starts a new one", () => {
  const { page, selection } = make(row("/a", "/b", "/c"));
  selection.start_next_land_(true);
  selection.land_(page.items[0]!);
  page.visual = false;
  assert.equal(selection.tick_(), undefined);
  selection.land_(page.items[2]!);
  page.visual = true;
  selection.land_(page.items[1]!);
  assert.deepEqual(range_hrefs(selection, page), [1], "no old anchor came back");
});

test("swap makes the anchor the cursor and the range stays", () => {
  const { page, selection } = make(row("/a", "/b", "/c", "/d"));
  selection.start_next_land_(true);
  selection.land_(page.items[1]!);
  selection.start_next_land_(false);
  selection.land_(page.items[3]!);
  assert.equal(selection.swap_(), page.items[1]);
  assert.deepEqual(range_hrefs(selection, page), [1, 2, 3]);
  assert.equal(selection.tick_()?.anchor_, page.items[3]);
});
