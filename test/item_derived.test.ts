import assert from "node:assert/strict";
import { test } from "node:test";
import { create_derived_row, NONE_RECHECK_MS } from "../src/content/item/derived.ts";
import type { Found } from "../src/content/item/finder.ts";

type Fake = { name: string; isConnected: boolean; shown: boolean; contains: (node: unknown) => boolean };
type FakeLink = { name: string; isConnected: boolean };

// A page whose items the test can hide, drop and bring back, and a finder that counts how often it is asked. `answer` is what the finder gives next unless `fails` says it runs out of time or throws, and `tail` is what follows the last item of the list.
function setup(initial: Fake[]) {
  const state: { url: string; clock: number; finds: number; answer: Fake[]; fails: "" | "timeout" | "throw"; tail: unknown[]; links: Map<Fake, FakeLink> } = { url: "https://a.test/", clock: 0, finds: 0, answer: initial, fails: "", tail: ["footer"], links: new Map() };
  const link = { name: "link", isConnected: true };
  const row = create_derived_row({
    find_: () => {
      state.finds++;
      if (state.fails === "throw") throw new Error("finder bug");
      if (state.fails === "timeout") return { kind: "none", items: [], links: new Map(), timed_out_: true };
      const items = state.answer as unknown as Element[];
      return { kind: items.length > 0 ? "list" : "none", items, links: new Map(state.answer.map((entry) => [entry, state.links.get(entry) ?? link])) } as unknown as Found<Element>;
    },
    url_: () => state.url,
    now_: () => state.clock,
    is_shown_: (element) => (element as unknown as Fake).shown,
    tail_: () => state.tail,
  });
  return { state, row, link };
}

const item = (name: string, shown = true): Fake => {
  const entry: Fake = { name, isConnected: true, shown, contains: (node) => node === entry || ((node as FakeLink).isConnected && (node as FakeLink).name !== "stray") };
  return entry;
};
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
  assert.equal(row.link_of_(first!), link as unknown as Element);
  assert.equal(row.link_of_(item("stranger") as unknown as Element), undefined);
  assert.equal(state.finds, 1);
});

test("a run that ran out of time scrolls this press and is not kept, so the next press reads the page again", () => {
  const { state, row } = setup([]);
  state.fails = "timeout";
  assert.deepEqual(row.items_(), []);
  state.fails = "";
  state.answer = [item("a"), item("b")];
  assert.deepEqual(names(row.items_()), ["a", "b"]);
  assert.equal(state.finds, 2);
});

test("a finder that throws logs the error, gives no items and is asked again on the next press", (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const { state, row } = setup([]);
  state.fails = "throw";
  assert.deepEqual(row.items_(), []);
  assert.equal((logged.mock.calls[0]?.arguments[0] as Error).message, "finder bug");
  state.fails = "";
  state.answer = [item("a")];
  assert.deepEqual(names(row.items_()), ["a"]);
});

test("at the end of the list the row reads the page again only when something new follows its last item", () => {
  const { state, row } = setup([item("a"), item("b")]);
  row.items_();
  assert.equal(row.grew_(), false);
  assert.equal(state.finds, 1);
  state.tail = ["c", "footer"];
  state.answer = [...state.answer, item("c")];
  assert.equal(row.grew_(), true);
  assert.deepEqual(names(row.items_()), ["a", "b", "c"]);
  assert.equal(row.grew_(), false);
  assert.equal(state.finds, 2);
});

test("a kept link that left the page or its item is looked up again", () => {
  const first = item("a");
  const { state, row, link } = setup([first, item("b")]);
  const stale = { name: "stale", isConnected: false };
  state.links.set(first, stale);
  row.items_();
  state.links.set(first, link);
  assert.equal(row.link_of_(first as unknown as Element), link as unknown as Element);
  assert.equal(state.finds, 2);
  const stray = { name: "stray", isConnected: true };
  state.links.set(first, stray);
  state.url = "https://a.test/moved";
  row.items_();
  state.links.set(first, link);
  assert.equal(row.link_of_(first as unknown as Element), link as unknown as Element);
  assert.equal(state.finds, 4);
});

test("a second timeout in a row stands like a none answer, so a held j on a slow page does not run the finder on every press", () => {
  const { state, row } = setup([]);
  state.fails = "timeout";
  row.items_();
  row.items_();
  row.items_();
  assert.equal(state.finds, 2);
  state.clock += NONE_RECHECK_MS;
  state.fails = "";
  state.answer = [item("a")];
  assert.deepEqual(names(row.items_()), ["a"]);
  // A run that finishes starts the count again, so the next lone timeout is not kept.
  state.url = "https://a.test/next";
  state.fails = "timeout";
  row.items_();
  row.items_();
  assert.equal(state.finds, 5);
});
