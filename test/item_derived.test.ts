import assert from "node:assert/strict";
import { test } from "node:test";
import { create_derived_row, NONE_RECHECK_MS } from "../src/content/item/derived.ts";
import type { Found } from "../src/content/item/finder.ts";

type Fake = { name: string; isConnected: boolean; shown: boolean };

// A page whose items the test can hide, drop and bring back, and a finder that counts how often it is asked.
function setup(initial: Fake[]) {
  const state = { url: "https://a.test/", clock: 0, finds: 0, answer: initial };
  const link = { name: "link" } as unknown as Element;
  const row = create_derived_row({
    find_: () => {
      state.finds++;
      const items = state.answer as unknown as Element[];
      return { kind: items.length > 0 ? "list" : "none", items, links: new Map(items.map((item) => [item, link])) } as Found<Element>;
    },
    url_: () => state.url,
    now_: () => state.clock,
    is_shown_: (element) => (element as unknown as Fake).shown,
  });
  return { state, row, link };
}

const item = (name: string, shown = true): Fake => ({ name, isConnected: true, shown });
const names = (items: Element[]) => items.map((element) => (element as unknown as Fake).name);

test("the answer is read once and kept while an item shows, the first item is in the page and the address stays", () => {
  const { state, row } = setup([item("a"), item("b"), item("c")]);
  assert.deepEqual(names(row.items_()), ["a", "b", "c"]);
  state.clock += 60_000;
  assert.deepEqual(names(row.items_()), ["a", "b", "c"]);
  assert.equal(state.finds, 1);
});

test("items the page hides are left out of a read that keeps the answer", () => {
  const { state, row } = setup([item("a"), item("b", false), item("c")]);
  assert.deepEqual(names(row.items_()), ["a", "c"]);
  assert.equal(state.finds, 1);
});

test("the page is read again when no item of the answer shows", () => {
  const { state, row } = setup([item("a"), item("b")]);
  row.items_();
  state.answer.forEach((entry) => (entry.shown = false));
  const fresh = [item("x"), item("y")];
  state.answer = fresh;
  assert.deepEqual(names(row.items_()), ["x", "y"]);
  assert.equal(state.finds, 2);
});

test("the page is read again when the first item has left the DOM, even while others show", () => {
  const { state, row } = setup([item("a"), item("b")]);
  row.items_();
  state.answer[0]!.isConnected = false;
  state.answer = [item("c"), item("d")];
  assert.deepEqual(names(row.items_()), ["c", "d"]);
  assert.equal(state.finds, 2);
});

test("the page is read again when the address changes, and not before", () => {
  const { state, row } = setup([item("a"), item("b")]);
  row.items_();
  state.url = "https://a.test/?p=2";
  state.answer = [item("p2a"), item("p2b")];
  assert.deepEqual(names(row.items_()), ["p2a", "p2b"]);
  row.items_();
  assert.equal(state.finds, 2);
});

test("a page with no list is not read again by every key press, only after the none answer is old", () => {
  const { state, row } = setup([]);
  row.items_();
  row.items_();
  state.clock += NONE_RECHECK_MS - 1;
  row.items_();
  assert.equal(state.finds, 1);
  state.answer = [item("late")];
  state.clock += 1;
  assert.deepEqual(names(row.items_()), ["late"]);
  assert.equal(state.finds, 2);
});

test("a none answer is read again at once when the address changes", () => {
  const { state, row } = setup([]);
  row.items_();
  state.url = "https://a.test/other";
  state.answer = [item("new")];
  assert.deepEqual(names(row.items_()), ["new"]);
});

test("the link of an item is the one the finder named, and an unknown item has none", () => {
  const { state, row, link } = setup([item("a"), item("b")]);
  const [first] = row.items_();
  assert.equal(row.link_of_(first!), link);
  assert.equal(row.link_of_(item("stranger") as unknown as Element), undefined);
  assert.equal(state.finds, 1);
});
