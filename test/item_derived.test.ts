import assert from "node:assert/strict";
import { test } from "node:test";
import { create_derived_row, in_view_, list_tail, NONE_RECHECK_MS, OVERRUN_PAUSE_MS } from "../src/content/item/derived.ts";
import { FINDER_BUDGET_MS, LONG_BUDGET_MS } from "../src/content/item/finder.ts";
import type { Found, Region } from "../src/content/item/finder.ts";

type Fake = { name: string; isConnected: boolean; shown: boolean; area?: number; covered?: boolean; contains: (node: unknown) => boolean };
type FakeLink = { name: string; isConnected: boolean; shown: boolean };

// A page whose items the test can hide, drop and bring back, and a finder that counts how often it is asked. `answer` is what the finder gives next unless `fails` says it runs out of time or throws, and `tail` is what follows the last item of the list.
function setup(initial: Fake[]) {
  const state: { url: string; clock: number; finds: number; answer: Fake[]; fails: "" | "timeout" | "throw"; tail: unknown[]; links: Map<Fake, FakeLink>; budgets: number[]; others: Fake[][] } = { url: "https://a.test/", clock: 0, finds: 0, answer: initial, fails: "", tail: ["footer"], links: new Map(), budgets: [], others: [] };
  const link = { name: "link", isConnected: true, shown: true };
  const row = create_derived_row({
    find_: (budget_ms) => {
      state.finds++;
      state.budgets.push(budget_ms);
      if (state.fails === "throw") throw new Error("finder bug");
      if (state.fails === "timeout") return { kind: "none", items: [], links: new Map(), regions: [], timed_out_: true };
      const region_of = (entries: Fake[]) => ({ kind: entries.length > 0 ? "list" : "none", items: entries, links: new Map(entries.map((entry) => [entry, state.links.get(entry) ?? link])) });
      const regions = [state.answer, ...state.others].filter((entries) => entries.length > 0).map(region_of);
      return { ...region_of(state.answer), regions } as unknown as Found<Element>;
    },
    url_: () => state.url,
    now_: () => state.clock,
    is_shown_: (element) => (element as unknown as Fake).shown,
    // A shown item is in view with the area it says, or 1. A covered one is shown and still counts for nothing (a fixed header over it, `pointer-events: none`).
    in_view_: (element) => ((element as unknown as Fake).shown && !(element as unknown as Fake).covered ? ((element as unknown as Fake).area ?? 1) : 0),
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
  state.clock += NONE_RECHECK_MS;
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

test("a kept link the page hides is looked up again", () => {
  const first = item("a");
  const { state, row, link } = setup([first, item("b")]);
  const hidden = { name: "hidden", isConnected: true, shown: false };
  state.links.set(first, hidden);
  row.items_();
  state.links.set(first, link);
  assert.equal(row.link_of_(first as unknown as Element), link as unknown as Element);
  assert.equal(state.finds, 2);
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

test("a node after the list that changes on its own causes no read on a press in the middle of the list", () => {
  const { state, row } = setup([item("a"), item("b")]);
  row.items_();
  for (let press = 0; press < 5; press++) {
    state.tail = [`footer ${press}`];
    assert.deepEqual(names(row.items_()), ["a", "b"]);
  }
  assert.equal(state.finds, 1);
});

test("a kept link that left the page or its item is looked up again", () => {
  const first = item("a");
  const { state, row, link } = setup([first, item("b")]);
  const stale = { name: "stale", isConnected: false, shown: true };
  state.links.set(first, stale);
  row.items_();
  state.links.set(first, link);
  assert.equal(row.link_of_(first as unknown as Element), link as unknown as Element);
  assert.equal(state.finds, 2);
  const stray = { name: "stray", isConnected: true, shown: true };
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

// A table-of-contents or footnote click changes the hash, which drops the kept answer. A short budget on the reads after it (400, 40, 40) timed out on a long page and left j scrolling until a reload.
test("after a hash change drops the kept answer, the next reads get the long budget again", () => {
  const { state, row } = setup([item("a"), item("b")]);
  row.items_();
  state.url = "https://a.test/#History";
  row.items_();
  state.url = "https://a.test/#Notes";
  row.items_();
  assert.deepEqual(state.budgets, [LONG_BUDGET_MS, LONG_BUDGET_MS, LONG_BUDGET_MS]);
});

test("at an address where two reads overran the long budget, reads get the short one until the address changes", () => {
  const { state, row } = setup([]);
  state.fails = "timeout";
  row.items_();
  row.items_();
  state.clock += NONE_RECHECK_MS;
  row.items_();
  state.url = "https://a.test/other";
  row.items_();
  assert.deepEqual(state.budgets, [LONG_BUDGET_MS, LONG_BUDGET_MS, FINDER_BUDGET_MS, LONG_BUDGET_MS]);
});

test("a held j on a page with no list re-reads its expired none with the short budget, and a timeout there keeps the none", () => {
  const { state, row } = setup([]);
  row.items_();
  state.clock += NONE_RECHECK_MS;
  row.items_();
  state.fails = "timeout";
  state.clock += NONE_RECHECK_MS;
  assert.deepEqual(row.items_(), []);
  row.items_();
  assert.deepEqual([state.budgets, state.finds], [[LONG_BUDGET_MS, FINDER_BUDGET_MS, FINDER_BUDGET_MS], 3]);
});

test("the overrun count starts again at a new address, so its first timeout is not kept", () => {
  const { state, row } = setup([]);
  state.fails = "timeout";
  row.items_();
  row.items_();
  state.url = "https://a.test/#Notes";
  row.items_();
  row.items_();
  assert.deepEqual(state.budgets, [LONG_BUDGET_MS, LONG_BUDGET_MS, LONG_BUDGET_MS, LONG_BUDGET_MS]);
});

test("two overruns put the address on the short budget only for a while, then the long one tries again", () => {
  const { state, row } = setup([]);
  state.fails = "timeout";
  row.items_();
  row.items_();
  state.clock += NONE_RECHECK_MS;
  row.items_();
  state.clock += OVERRUN_PAUSE_MS;
  row.items_();
  assert.deepEqual(state.budgets, [LONG_BUDGET_MS, LONG_BUDGET_MS, FINDER_BUDGET_MS, LONG_BUDGET_MS]);
});

// A frame of elements as far as `list_tail` reads them: the parent link, the next sibling and the parent's last child. `relink` rebuilds the sibling links after the children change.
type Tree = { name: string; parentElement: Tree | null; nextElementSibling: Tree | null; lastElementChild: Tree | null; kids: Tree[] };
const tree = (name: string, parentElement: Tree | null = null): Tree => ({ name, parentElement, nextElementSibling: null, lastElementChild: null, kids: [] });
function relink(parent: Tree) {
  parent.kids.forEach((kid, at) => ((kid.parentElement = parent), (kid.nextElementSibling = parent.kids[at + 1] ?? null)));
  parent.lastElementChild = parent.kids.at(-1) ?? null;
}
const tail_of = (items: Tree[]) => list_tail(items as unknown as Element[]);

test("a load that replaces the trailing form in the items' parent changes the tail, and a page that did not change keeps it", () => {
  const frame = tree("frame");
  const articles = [0, 1, 2].map((at) => tree(`article ${at}`));
  frame.kids = [...articles.flatMap((article, at) => [article, tree(`div ${at}`)]), tree("form")];
  relink(frame);
  // The tail is compared by identity, as `grew_` does.
  const differs = (a: unknown[], b: unknown[]) => a.some((entry, at) => entry !== b[at]);
  const before = tail_of(articles);
  assert.ok(!differs(tail_of(articles), before));
  // Page two replaces the form with its own items and a new form, in the same parent.
  const next = [3, 4].map((at) => tree(`article ${at}`));
  frame.kids = [...frame.kids.slice(0, -1), ...next.flatMap((article, at) => [article, tree(`div ${at + 3}`)]), tree("form")];
  relink(frame);
  assert.ok(differs(tail_of(articles), before));
});

test("the follow selector is the tag and first class, and the class alone when the kept items mix tags", () => {
  (globalThis as { CSS?: unknown }).CSS = { escape: (text: string) => text };
  const shaped = (name: string, localName: string) => ({ ...item(name), localName, classList: ["story"] });
  const same = setup([shaped("a", "div"), shaped("b", "div")] as Fake[]);
  same.row.items_();
  assert.equal(same.row.selector_(), "div.story");
  const mixed = setup([shaped("a", "div"), shaped("b", "article")] as Fake[]);
  mixed.row.items_();
  assert.equal(mixed.row.selector_(), ".story");
});

// Lists on one page: `state.answer` is the largest, `state.others` the rest. `leave` takes a list out of the view and `enter` puts it in.
const leave = (list: Fake[]) => list.forEach((entry) => (entry.shown = false));
const enter = (list: Fake[]) => list.forEach((entry) => (entry.shown = true));

test("the first press takes the list with the most area in view, not the largest list", () => {
  const mix = [item("m1"), item("m2")];
  const related = [item("r1"), item("r2"), item("r3")];
  leave(related);
  const { state, row } = setup(related);
  state.others = [mix];
  assert.deepEqual(names(row.items_()), ["m1", "m2"]);
  assert.equal(state.finds, 1);
});

test("equal areas in view go to the largest list, which the finder gives first", () => {
  const { state, row } = setup([item("big")]);
  state.others = [[item("small")]];
  assert.deepEqual(names(row.items_()), ["big"]);
});

test("a list that loads after the first press does not take the active list while it shows", () => {
  const mix = [item("m1"), item("m2")];
  const { state, row } = setup(mix);
  assert.deepEqual(names(row.items_()), ["m1", "m2"]);
  const related = [item("r1"), item("r2"), item("r3")];
  related.forEach((entry) => (entry.area = 50));
  state.answer = related;
  state.others = [mix];
  // A read of the page at the end of the active list sees both lists, and the active one stays.
  state.tail = ["more"];
  assert.equal(row.grew_(), true);
  assert.deepEqual(names(row.items_()), ["m1", "m2"]);
  assert.equal(state.finds, 2);
});

test("a list that loads late does not steal the list that holds the view through the reads of a held j", () => {
  const comments = [item("c1")];
  const { state, row } = setup(comments);
  row.items_();
  const related = [item("r1")];
  related[0]!.area = 99;
  state.answer = related;
  state.others = [comments];
  for (let press = 0; press < 5; press++) {
    state.clock += NONE_RECHECK_MS * 10;
    assert.deepEqual(names(row.items_()), ["c1"]);
  }
  assert.equal(state.finds, 1);
});

test("the active list hands over on the next press after it leaves the view, and scrolling alone changes nothing", () => {
  const mix = [item("m1"), item("m2")];
  const comments = [item("c1"), item("c2")];
  leave(comments);
  const { state, row } = setup(mix);
  state.others = [comments];
  row.items_();
  // The user scrolls: the view changes, and no press reads anything.
  leave(mix);
  enter(comments);
  assert.equal(state.finds, 1);
  assert.deepEqual(names(row.items_()), ["c1", "c2"]);
  assert.equal(state.finds, 2);
  // It stays on comments while they show, though the mix is shown again and larger.
  enter(mix);
  mix.forEach((entry) => (entry.area = 100));
  assert.deepEqual(names(row.items_()), ["c1", "c2"]);
});

test("the end of a list that grew keeps the list, and does not cross into another list in view", () => {
  const feed = [item("f1"), item("f2")];
  const rail = [item("r1"), item("r2")];
  const { state, row } = setup(feed);
  state.others = [rail];
  assert.deepEqual(names(row.items_()), ["f1", "f2"]);
  rail.forEach((entry) => (entry.area = 500));
  state.tail = ["more"];
  state.answer = [...feed, item("f3")];
  assert.equal(row.grew_(), true);
  assert.deepEqual(names(row.items_()), ["f1", "f2", "f3"]);
});

test("with no list in view the active list stays, and the page is read again with the short budget once the answer is old", () => {
  const mix = [item("m1")];
  const { state, row } = setup(mix);
  row.items_();
  leave(mix);
  assert.deepEqual(row.items_(), []);
  assert.equal(state.finds, 1);
  const late = [item("late")];
  state.answer = late;
  state.clock += NONE_RECHECK_MS;
  assert.deepEqual(names(row.items_()), ["late"]);
  assert.deepEqual(state.budgets, [LONG_BUDGET_MS, FINDER_BUDGET_MS]);
});

test("a read that times out with no list in view keeps the active list", () => {
  const mix = [item("m1")];
  const { state, row } = setup(mix);
  row.items_();
  leave(mix);
  state.fails = "timeout";
  state.clock += NONE_RECHECK_MS;
  assert.deepEqual(row.items_(), []);
  state.fails = "";
  enter(mix);
  assert.deepEqual(names(row.items_()), ["m1"]);
  assert.equal(state.finds, 2);
});

test("a cached answer does not outlive the removal of its list, though other lists of it remain", () => {
  const mix = [item("m1"), item("m2")];
  const related = [item("r1"), item("r2")];
  const { state, row } = setup(mix);
  state.others = [related];
  assert.deepEqual(names(row.items_()), ["m1", "m2"]);
  // The page drops the mix panel (a new video loads).
  mix.forEach((entry) => (entry.isConnected = false));
  state.answer = related;
  state.others = [];
  assert.deepEqual(names(row.items_()), ["r1", "r2"]);
  assert.equal(state.finds, 2);
});

test("a list removed from the DOM is not served from the cache when its answer is the only one", () => {
  const mix = [item("m1")];
  const { state, row } = setup(mix);
  row.items_();
  mix[0]!.isConnected = false;
  state.answer = [];
  assert.deepEqual(row.items_(), []);
  assert.equal(state.finds, 2);
});

test("after a read the active list is the one the user was on when it is still on the page", () => {
  const mix = [item("m1")];
  const related = [item("r1")];
  const { state, row } = setup(mix);
  state.others = [related];
  row.items_();
  leave(mix);
  enter(related);
  assert.deepEqual(names(row.items_()), ["r1"]);
  state.url = "https://a.test/?next";
  state.answer = [item("n1")];
  state.others = [];
  assert.deepEqual(names(row.items_()), ["n1"]);
});

test("the link, the selector and the grid answer follow the active list", () => {
  (globalThis as { CSS?: unknown }).CSS = { escape: (text: string) => text };
  const shaped = (name: string, class_name: string) => ({ ...item(name), localName: "li", classList: [class_name] });
  const mix = [shaped("m1", "mix")] as Fake[];
  const comments = [shaped("c1", "comment")] as Fake[];
  leave(mix);
  const { state, row } = setup(comments);
  state.others = [mix];
  row.items_();
  assert.equal(row.selector_(), "li.comment");
  leave(comments);
  enter(mix);
  assert.deepEqual(names(row.items_()), ["m1"]);
  assert.equal(row.selector_(), "li.mix");
});

test("a list that loaded since the last read competes at the hand-over", () => {
  const mix = [item("m1")];
  const related = [item("r1")];
  const { state, row } = setup(mix);
  state.others = [related];
  row.items_();
  // The comments load while the user looks at the mix panel, and the user then scrolls to them, beside the related column.
  const comments = [item("c1")];
  comments[0]!.area = 500;
  state.others = [related, comments];
  leave(mix);
  assert.deepEqual(names(row.items_()), ["c1"]);
});

test("a list the user handed over to stays active when it grows, and the old list does not come back", () => {
  const mix = [item("m1")];
  const related = [item("r1"), item("r2")];
  const { state, row } = setup(mix);
  state.others = [related];
  row.items_();
  leave(mix);
  assert.deepEqual(names(row.items_()), ["r1", "r2"]);
  enter(mix);
  state.tail = ["more"];
  related.push(item("r3"));
  assert.equal(row.grew_(), true);
  assert.deepEqual(names(row.items_()), ["r1", "r2", "r3"]);
});

test("an item that shows but is covered counts for nothing, so another list in view takes over and a lone list stays", () => {
  const feed = [item("f1")];
  feed[0]!.covered = true;
  const rail = [item("r1")];
  const { state, row } = setup(feed);
  state.others = [rail];
  assert.deepEqual(names(row.items_()), ["r1"]);
  const lone = setup([item("a")]);
  lone.state.answer[0]!.covered = true;
  assert.deepEqual(names(lone.row.items_()), ["a"]);
  assert.deepEqual(names(lone.row.items_()), ["a"]);
  assert.equal(lone.state.finds, 1);
});

test("an end command keeps its list while its own scroll brings another into view, and the next key press hands over", () => {
  const feed = [item("f1"), item("f2")];
  const rail = [item("r1")];
  const { state, row } = setup(feed);
  state.others = [rail];
  row.items_();
  const out_of_view = () => feed.forEach((entry) => (entry.covered = true));
  out_of_view();
  state.tail = ["more"];
  feed.push(item("f3"));
  out_of_view();
  assert.equal(row.grew_(), true);
  assert.deepEqual(names(row.items_(true)), ["f1", "f2", "f3"]);
  assert.deepEqual(names(row.items_()), ["r1"]);
});

// The live in-view area over fake rectangles and a fake hit test.
type Probe = { rect: { left: number; top: number; right: number; bottom: number }; hit: (x: number, y: number) => unknown };
function probed(entry: Probe, in_shadow = false): Element {
  const element = { getBoundingClientRect: () => entry.rect, contains: (node: unknown) => node === element, getRootNode: () => ({ elementFromPoint: (x: number, y: number) => (in_shadow ? entry.hit(x, y) : null) }) };
  Object.assign(globalThis, { innerWidth: 1000, innerHeight: 800, document: { elementFromPoint: (x: number, y: number) => entry.hit(x, y) } });
  if (!in_shadow) element.getRootNode = () => (globalThis as unknown as { document: Document }).document as never;
  return element as unknown as Element;
}

test("the in-view area is the rectangle clipped to the view, probed at the middle of what shows", () => {
  const self = {};
  const under_header = probed({ rect: { left: 0, top: -100, right: 500, bottom: 300 }, hit: (_x, y) => (y < 56 ? "masthead" : null) });
  assert.equal(in_view_(under_header), 0);
  const card: Probe = { rect: { left: 10, top: 700, right: 410, bottom: 900 }, hit: () => self };
  const element = probed(card);
  card.hit = () => element;
  assert.equal(in_view_(element), 400 * 100);
  // A rounded corner falls through to the parent at the corner and not at the middle.
  const rounded: Probe = { rect: { left: 0, top: 100, right: 300, bottom: 200 }, hit: () => null };
  const round_element = probed(rounded);
  rounded.hit = (x, y) => (x < 5 && y < 105 ? "parent" : round_element);
  assert.equal(in_view_(round_element), 300 * 100);
  const above = probed({ rect: { left: 0, top: -300, right: 300, bottom: -10 }, hit: () => null });
  assert.equal(in_view_(above), 0);
});

test("an item inside a shadow root is probed through its own root", () => {
  const card: Probe = { rect: { left: 0, top: 0, right: 200, bottom: 100 }, hit: () => null };
  const element = probed(card, true);
  card.hit = () => element;
  assert.equal(in_view_(element), 200 * 100);
});

test("an end command keeps its list when the page drops the list's first item and a larger list shows", () => {
  const feed = [item("f1"), item("f2"), item("f3")];
  const rail = [item("r1")];
  rail[0]!.area = 500;
  const { state, row } = setup(feed);
  state.others = [];
  row.items_();
  // A virtualized feed drops its first item and keeps the rest. A larger rail shows, and the feed itself is out of the view.
  feed[0]!.isConnected = false;
  feed.slice(1).forEach((entry) => (entry.covered = true));
  state.answer = feed.slice(1);
  state.others = [rail];
  assert.deepEqual(names(row.items_(true)), ["f2", "f3"]);
  assert.deepEqual(names(row.items_(true)), ["f2", "f3"]);
});

test("an end command keeps its list when the page hides the list's first item and a larger list shows", () => {
  const feed = [item("f1"), item("f2"), item("f3")];
  const rail = [item("r1")];
  rail[0]!.area = 500;
  const { state, row } = setup(feed);
  row.items_();
  // The first item stays in the page but is hidden, so the next read leaves it out. The rest are out of the view while a larger rail shows.
  feed[0]!.shown = false;
  feed.slice(1).forEach((entry) => (entry.covered = true));
  state.answer = feed.slice(1);
  state.others = [rail];
  state.tail = ["more"];
  assert.equal(row.grew_(), true);
  assert.deepEqual(names(row.items_(true)), ["f2", "f3"]);
});

test("lists_ gives every list of the page, reading the page first", () => {
  const mix = [item("m1")];
  const related = [item("r1"), item("r2")];
  const { state, row } = setup(related);
  state.others = [mix];
  assert.deepEqual(row.lists_().map((region) => names(region.items)), [["r1", "r2"], ["m1"]]);
  assert.equal(state.finds, 1);
});

test("lists_ gives none for a page with no list", () => {
  const { row } = setup([]);
  assert.deepEqual(row.lists_(), []);
});

test("a picked list stays active while the old list still shows, and the old list takes over again only after the picked one leaves", () => {
  const related = [item("r1"), item("r2")];
  const comments = [item("c1"), item("c2")];
  const { state, row } = setup(related);
  state.others = [comments];
  assert.deepEqual(names(row.items_()), ["r1", "r2"]);
  row.pick_(row.lists_()[1]!);
  assert.deepEqual(names(row.items_()), ["c1", "c2"]);
  assert.equal(state.finds, 1);
  leave(comments);
  assert.deepEqual(names(row.items_()), ["r1", "r2"]);
});

// A page with a long list and a short one beside it, as the finder reports them: the short region comes last and carries `short_`.
function with_short_list(long_items: Fake[], short_items: Fake[]) {
  const state = { clock: 0, finds: 0 };
  const region_of = (entries: Fake[], short: boolean) => ({ kind: "list", items: entries, links: new Map(), ...(short ? { short_: true } : {}) });
  const row = create_derived_row({
    find_: () => (state.finds++, { ...region_of(long_items, false), regions: [region_of(long_items, false), region_of(short_items, true)] } as unknown as Found<Element>),
    url_: () => "https://a.test/",
    now_: () => state.clock,
    is_shown_: (element) => (element as unknown as Fake).shown,
    in_view_: (element) => ((element as unknown as Fake).shown ? 1 : 0),
    tail_: () => [],
  });
  return { state, row };
}

test("a short list is never the first choice, and a long list that leaves the view does not hand over to it", () => {
  const long_items = [item("l1"), item("l2")];
  const short_items = [item("s1"), item("s2")];
  const { state, row } = with_short_list(long_items, short_items);
  assert.deepEqual(names(row.items_()), ["l1", "l2"]);
  long_items.forEach((entry) => (entry.shown = false));
  state.clock += NONE_RECHECK_MS;
  assert.deepEqual(names(row.items_()), [], "the long list stays active with nothing in view");
});

test("a picked short list stays active through a read of the page", () => {
  const long_items = [item("l1"), item("l2")];
  const short_items = [item("s1"), item("s2")];
  const { row } = with_short_list(long_items, short_items);
  row.pick_(row.lists_()[1]!);
  assert.deepEqual(names(row.items_()), ["s1", "s2"]);
  long_items.forEach((entry) => (entry.shown = false));
  assert.deepEqual(names(row.items_()), ["s1", "s2"]);
});

// The pin: a picked list that a site row's keys cannot walk stays active until the address changes, the list leaves, or `unpin_`.
function pinned_setup() {
  const related = [item("r1"), item("r2")];
  const comments = [item("c1"), item("c2")];
  const page = setup(related);
  page.state.others = [comments];
  page.row.items_();
  page.row.pin_(page.row.lists_()[1]!);
  return { ...page, related, comments };
}
const active_names = (row: ReturnType<typeof setup>["row"]) => names(row.active_()!.items);

test("a pinned list stays active when another list is in view and the pinned one is not", () => {
  const { state, row, comments } = pinned_setup();
  comments.forEach((entry) => (entry.shown = false));
  state.clock += NONE_RECHECK_MS;
  assert.equal(row.pinned_(), true);
  row.items_();
  assert.deepEqual(active_names(row), ["c1", "c2"]);
  row.unpin_();
  assert.equal(row.pinned_(), false);
  assert.deepEqual(names(row.items_()), ["r1", "r2"], "without the pin the list in view takes over");
});

test("a pin outlives the kept answer: a link the page replaced reads the page again and the pin matches the list through its items", () => {
  const { state, row, link } = pinned_setup();
  state.links.set(state.others[0]![0]!, link);
  link.shown = false;
  row.link_of_(state.others[0]![0]! as unknown as Element);
  assert.equal(row.pinned_(), true);
  assert.deepEqual(active_names(row), ["c1", "c2"]);
});

test("a pin keeps through a read that runs out of time, and holds the list when the next read answers", () => {
  const { state, row } = pinned_setup();
  state.fails = "timeout";
  state.others[0]![0]!.isConnected = false;
  row.items_();
  state.fails = "";
  assert.equal(row.pinned_(), true, "a timed out read tells nothing about the list");
  assert.deepEqual(active_names(row), ["c1", "c2"]);
});

test("a pin drops when its list leaves the page, and the list in view takes over", () => {
  const { state, row, comments } = pinned_setup();
  comments.forEach((entry) => (entry.isConnected = false));
  state.others = [];
  assert.equal(row.pinned_(), false);
  assert.deepEqual(active_names(row), ["r1", "r2"]);
});

test("a pin drops at an address change even when the list stays", () => {
  const { state, row, comments } = pinned_setup();
  state.url = "https://a.test/?p=2";
  assert.equal(row.pinned_(), false);
  comments.forEach((entry) => (entry.shown = false));
  state.clock += NONE_RECHECK_MS;
  assert.deepEqual(names(row.items_()), ["r1", "r2"], "the list in view takes over again");
});

test("a pin set before the first read still holds the list", () => {
  const related = [item("r1")];
  const comments = [item("c1")];
  const { state, row } = setup(related);
  state.others = [comments];
  row.pin_({ kind: "list", items: comments as unknown as Element[], links: new Map() });
  assert.equal(row.pinned_(), true);
  assert.deepEqual(active_names(row), ["c1"]);
});

test("a pin keeps its list through two reads in a row that run out of time, and drops only when a whole read lacks the list", () => {
  const { state, row, comments } = pinned_setup();
  state.fails = "timeout";
  comments[0]!.isConnected = false;
  row.items_();
  row.items_();
  row.items_();
  state.fails = "";
  assert.equal(row.pinned_(), true, "timeouts say nothing about the list");
  state.clock += NONE_RECHECK_MS;
  row.items_();
  assert.deepEqual(active_names(row), ["c1", "c2"], "the next whole read finds the list through its items");
  state.others = [];
  comments.forEach((entry) => (entry.isConnected = false));
  assert.equal(row.pinned_(), false, "a whole read without the list drops it");
});
