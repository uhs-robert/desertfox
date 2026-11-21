import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";
import { bind_tables_of, type SiteRuleRow } from "../src/shared/match_pattern.ts";
import { create_derived_row } from "../src/content/item/derived.ts";
import type { DerivedRow } from "../src/content/item/derived.ts";
import { args_for_pin, lists_with_row, pick_list } from "../src/content/item/lists.ts";
import { current_item, forget_move, item_rect, move_item, pick_item, place_of, read_cursor, step_from } from "../src/content/item/pick.ts";
import type { Box, ItemPage } from "../src/content/item/pick.ts";
import { click_first_shown } from "../src/content/hints/click_first.ts";

const box = (left: number, top: number, width = 100, height = 40): Box => ({ left, top, right: left + width, bottom: top + height });
const list = [box(0, 0), box(0, 60), box(0, 120), box(0, 180)];
// Two rows of three, with ragged tops in the second row as a justified image grid has.
const grid = [box(0, 0), box(110, 0), box(220, 0), box(0, 60), box(110, 66), box(220, 58)];

test("down and up step through a list in order", () => {
  assert.equal(step_from(list, 0, "down"), 1);
  assert.equal(step_from(list, 2, "up"), 1);
  assert.equal(step_from(list, 3, "down"), undefined);
  assert.equal(step_from(list, 0, "up"), undefined);
});

test("down and up in a grid take the item across the row, ragged tops included", () => {
  assert.equal(step_from(grid, 1, "down"), 4);
  assert.equal(step_from(grid, 5, "up"), 2);
  assert.equal(step_from(grid, 0, "down"), 3);
});

test("left and right stay on the row", () => {
  assert.equal(step_from(grid, 0, "right"), 1);
  assert.equal(step_from(grid, 4, "left"), 3);
  assert.equal(step_from(grid, 2, "right"), undefined);
  assert.equal(step_from(grid, 3, "left"), undefined);
});

// Seven masonry columns of uneven height: down from the top of column 1 must stay in column 1 even when a tile in column 2 starts nearer.
test("down and up in a masonry grid stay in the column", () => {
  const masonry = [box(0, 0, 100, 200), box(110, 0, 100, 90), box(0, 210, 100, 100), box(110, 100, 100, 90), box(110, 200, 100, 150)];
  assert.equal(step_from(masonry, 0, "down"), 2);
  assert.equal(step_from(masonry, 1, "down"), 3);
  assert.equal(step_from(masonry, 4, "up"), 3);
});

test("down prefers an item that overlaps across, even when one in the next column is nearer along", () => {
  const columns = [box(0, 0, 100, 200), box(110, 100, 100, 60), box(0, 210, 100, 200)];
  assert.equal(step_from(columns, 0, "down"), 2);
  // With nothing overlapping, the nearest row still decides first and the smaller gap across wins in it.
  const apart = [box(0, 0, 100, 40), box(300, 60, 100, 40), box(120, 64, 100, 40)];
  assert.equal(step_from(apart, 0, "down"), 2);
});

test("down takes the tile directly below, not a ragged neighbour that overlaps by a few pixels", () => {
  const ragged = [box(0, 0, 100, 80), box(95, 100, 200, 80), box(0, 106, 100, 80)];
  assert.equal(step_from(ragged, 0, "down"), 2);
});

test("candidates within half the item length along share a row, and the larger overlap across wins", () => {
  // Both start about a line below, 1 px apart along. The second overlaps more across.
  const near = [box(0, 0, 100, 40), box(60, 60, 100, 40), box(0, 61, 100, 40)];
  assert.equal(step_from(near, 0, "down"), 2);
});

test("left and right reach a column whose tiles each cover less than half the item's height", () => {
  const split = [box(200, 300, 100, 100), box(100, 140, 100, 200), box(100, 350, 100, 200), box(0, 280, 100, 140)];
  assert.equal(step_from(split, 0, "left"), 2);
  assert.equal(step_from(split, 2, "left"), 3);
});

test("up from a tall item takes the short item just above, not the one above that", () => {
  const stack = [box(0, 0, 100, 40), box(0, 60, 100, 40), box(0, 120, 100, 400)];
  assert.equal(step_from(stack, 2, "up"), 1);
});

test("left from a wide item takes its neighbour, not the one beyond", () => {
  const strip = [box(0, 0, 40, 100), box(60, 0, 40, 100), box(120, 0, 400, 100)];
  assert.equal(step_from(strip, 2, "left"), 1);
});

test("a list of titles with unequal widths still goes to the next one down", () => {
  const titles = [box(0, 0, 300, 20), box(0, 50, 100, 20), box(0, 100, 250, 20)];
  assert.equal(step_from(titles, 0, "down"), 1);
  assert.equal(step_from(titles, 1, "down"), 2);
});

test("a count moves that many items and stops on the last one", () => {
  assert.deepEqual(pick_item(list, { index: 0, on_item: true }, "down", 2), { index: 2 });
  assert.deepEqual(pick_item(list, { index: 1, on_item: true }, "down", 9), { index: 3 });
});

test("a move with nowhere to go is the end, and so is a move off an empty side", () => {
  assert.deepEqual(pick_item(list, { index: 3, on_item: true }, "down", 1), { end: true });
  assert.deepEqual(pick_item(list, { index: 0, on_item: true }, "up", 3), { end: true });
});

test("from no item, down lands on the first item in view and up on the one before it", () => {
  assert.deepEqual(pick_item(list, { index: 2, on_item: false }, "down", 1), { index: 2 });
  assert.deepEqual(pick_item(list, { index: 2, on_item: false }, "down", 2), { index: 3 });
  assert.deepEqual(pick_item(list, { index: 2, on_item: false }, "up", 1), { index: 1 });
  assert.deepEqual(pick_item(list, { index: 0, on_item: false }, "up", 1), { end: true });
  assert.deepEqual(pick_item(list, { index: 4, on_item: false }, "down", 1), { end: true });
});

test("the start is the focused item, else the last item while on screen, else the first one not above the view", () => {
  const items = list.map(() => ({ contains: () => false }) as unknown as Element);
  const holder = { contains: (node: unknown) => node === "inside" } as unknown as Element;
  assert.deepEqual(place_of([items[0]!, holder], "inside" as unknown as Element, items[0], list, 800), { index: 1, on_item: true });
  assert.deepEqual(place_of(items, null, items[2], list, 800), { index: 2, on_item: true });
  // A focus left on an item that a scroll took off screen gives way to the first item in view, and the remembered item too.
  assert.deepEqual(place_of([items[0]!, holder], "inside" as unknown as Element, undefined, [box(0, 0), box(0, -500)], 800), { index: 0, on_item: false });
  const scrolled = list.map((entry) => ({ ...entry, top: entry.top - 100, bottom: entry.bottom - 100 }));
  assert.deepEqual(place_of(items, null, items[0], scrolled, 800), { index: 2, on_item: false });
  assert.deepEqual(place_of(items, null, undefined, list.map((entry) => ({ ...entry, bottom: -1 })), 800), { index: 4, on_item: false });
});

test("nested items: the focus holds the deepest item around it, for the start and for current_item", () => {
  const leaf = { getAttribute: () => null } as unknown as Element;
  const inner = { contains: (node: unknown) => node === leaf } as unknown as Element;
  const outer = { contains: (node: unknown) => node === leaf || node === inner } as unknown as Element;
  assert.deepEqual(place_of([outer, inner], leaf, undefined, [box(0, 0), box(0, 30)], 800), { index: 1, on_item: true });
  // A focused treeitem holds the label the finder lists for it, and stands for that item.
  const label = { contains: () => false } as unknown as Element;
  const treeitem = { getAttribute: () => "treeitem", contains: (node: unknown) => node === label || node === treeitem } as unknown as Element;
  assert.deepEqual(place_of([label], treeitem, undefined, [box(0, 0)], 800), { index: 0, on_item: true });
  const held = fake_page(list, true, 1);
  const first = held.items[0] as unknown as { contains: (node: unknown) => boolean };
  first.contains = (node: unknown) => node === held.items[1] || node === held.items[0];
  move_item(held.page, { selector: "li", link: "a.t", direction: "down" });
  assert.equal(current_item(held.page)?.item_, held.items[1], "the inner item, not the outer one that comes first");
});

// A page of fake items. `focus` records which element took the focus and with which options.
function fake_page(rects: Box[], on_screen = true, focused_index = -1, hidden: number[] = []) {
  const log: string[] = [];
  const shown: string[] = [];
  const toasts: string[] = [];
  const selectors: string[] = [];
  const make = (rect: Box, index: number) => {
    const link = { tabIndex: 0, setAttribute: () => {}, focus: () => log.push(`focus link ${index}`) };
    const element = {
      tabIndex: -1,
      // A CSS-hidden item passes a bare checkVisibility(), so the handler must ask for the visibility property.
      checkVisibility: (options?: { visibilityProperty?: boolean; opacityProperty?: boolean }) => !(hidden.includes(index) && options?.visibilityProperty && options?.opacityProperty),
      getClientRects: () => [rect],
      getBoundingClientRect: () => rect,
      contains: (node: unknown) => node === element,
      querySelector: (selector: string) => (selector === "a.t" ? link : null),
      setAttribute: (name: string, value: string) => log.push(`${name}=${value} on ${index}`),
      focus: () => log.push(`focus item ${index}`),
      scrollIntoView: (options: { block: string }) => log.push(`scroll ${index} ${options.block}`),
      isConnected: true,
      localName: "li",
      classList: [],
      parentElement: null,
      getAttribute: () => null,
      closest: () => null,
    };
    return element;
  };
  const items = rects.map(make);
  const scrolls: number[][] = [];
  let clock = 0;
  const page_scroller = { scrollTop: 0, scrollHeight: 2000, clientHeight: 800, parentElement: null, scrollTo: () => {} };
  const page = {
    doc: { querySelectorAll: (selector: string) => (selector === "none" ? [] : items), scrollingElement: page_scroller },
    overflow_y_: () => "visible",
    wait_: async (ms: number) => void (clock += ms),
    now_: () => clock,
    watch_user_: () => ({ left_: () => false, stop_: () => {} }),
    view: { innerHeight: 800, innerWidth: on_screen ? 800 : 50, scrollY: 0 },
    focused: () => items[focused_index] ?? null,
    toast: (message: string) => toasts.push(message),
    scroll_by: (dx: number, dy: number) => scrolls.push([dx, dy]),
    box_shown: () => false,
    highlight: (item: unknown, selector: string) => (shown.push(String(items.indexOf(item as (typeof items)[number]))), selectors.push(selector)),
  } as unknown as ItemPage;
  return { page, items, log, shown, toasts, scrolls, selectors, add: (rect: Box) => items.push(make(rect, items.length)) };
}

test("move_item focuses the link inside the next item, reveals it only when it is not fully in view, and highlights it", () => {
  const { page, log, shown } = fake_page(list);
  move_item(page, { selector: "li", link: "a.t", direction: "down" });
  assert.deepEqual(log, ["focus link 0"]);
  assert.deepEqual(shown, ["0"]);
  const off = fake_page(list, false);
  move_item(off.page, { selector: "li", link: "a.t", direction: "down" });
  assert.deepEqual(off.log, ["focus link 0", "scroll 0 center"]);
});

test("current_item is the item that holds the focus, else the last one moved to, with its link", () => {
  const held = fake_page(list, true, 1);
  move_item(held.page, { selector: "li", link: "a.t", direction: "down" });
  assert.equal(current_item(held.page)?.item_, held.items[1], "the focused item wins over the one landed on");
  const moved = fake_page(list);
  move_item(moved.page, { selector: "li", link: "a.t", direction: "down" });
  assert.equal(current_item(moved.page)?.item_, moved.items[0], "the last move");
  assert.ok(current_item(moved.page)?.link_, "the row's link");
  forget_move();
  assert.equal(current_item(moved.page), undefined, "a picked list drops the move of the old one");
  move_item(moved.page, { selector: "li", link: "a.t", direction: "down" });
  (moved.items[0] as unknown as { isConnected: boolean }).isConnected = false;
  assert.equal(current_item(moved.page), undefined, "an item the page dropped is no current item");
});

// The two layouts of the saved Kagi pages. Tiles of a flex row share a height and differ in width, with a row below. Tiles of the column masonry have the heights of their grid-row spans and no shared row lines, and the DOM order fills the holes.
test("the Kagi flex rows walk by row: right along a row, down to the tile that overlaps most", () => {
  const rows = [box(0, 0, 200, 150), box(205, 0, 300, 150), box(510, 0, 150, 150), box(0, 155, 320, 160), box(325, 155, 180, 160), box(510, 155, 250, 160)];
  assert.equal(step_from(rows, 0, "right"), 1);
  assert.equal(step_from(rows, 2, "right"), undefined);
  assert.equal(step_from(rows, 1, "down"), 4);
  assert.equal(step_from(rows, 2, "down"), 5);
  assert.equal(step_from(rows, 4, "up"), 1);
});

test("the Kagi column masonry walks by position, not by DOM order", () => {
  // DOM order 0..6 fills the shortest column first, so it zigzags across the columns.
  const columns = [box(0, 0, 200, 320), box(205, 0, 200, 180), box(410, 0, 200, 240), box(205, 185, 200, 300), box(410, 245, 200, 100), box(0, 325, 200, 150), box(410, 350, 200, 200)];
  assert.equal(step_from(columns, 0, "down"), 5);
  assert.equal(step_from(columns, 1, "down"), 3);
  assert.equal(step_from(columns, 2, "down"), 4);
  assert.equal(step_from(columns, 4, "down"), 6);
  assert.equal(step_from(columns, 6, "up"), 4);
  assert.equal(step_from(columns, 3, "right"), 6);
  assert.equal(step_from(columns, 3, "left"), 5);
});

test("the brave_images row focuses the button tile itself, with no tabindex change", () => {
  const row = DEFAULT_SITE_ROWS.find((entry) => entry.name === "brave_images")!.row;
  const args = (row.keymap!.item!.j as unknown as { args: { selector: string; link?: string; direction: "down" } }).args;
  const { page, items, log } = fake_page(list);
  for (const item of items) item.tabIndex = 0;
  move_item(page, args);
  assert.deepEqual(log, ["focus item 0"]);
});

test("move_item gives an item with no link of its own tabindex -1 before it focuses it", () => {
  const { page, log } = fake_page(list);
  move_item(page, { selector: "li", direction: "down" });
  assert.deepEqual(log, ["tabindex=-1 on 0", "focus item 0"]);
});

test("down scrolls 50 px per count while the current item runs past the bottom of the view, redrawing its box, and then moves on", () => {
  const long = fake_page([box(0, 100, 100, 900), box(0, 1040)], true, 0);
  move_item(long.page, { selector: "li", direction: "down", times: 2 });
  assert.deepEqual([long.scrolls, long.shown, long.log], [[[0, 100]], ["0"], []]);
  const read = fake_page([box(0, -400, 100, 900), box(0, 540)], true, 0);
  move_item(read.page, { selector: "li", direction: "down" });
  assert.deepEqual([read.scrolls, read.shown], [[], ["1"]]);
});

test("up scrolls while the current item runs past the top of the view, redrawing its box, and then moves on", () => {
  const long = fake_page([box(0, -300, 100, 900), box(0, -400, 100, 50)], true, 0);
  move_item(long.page, { selector: "li", direction: "up", times: 3 });
  assert.deepEqual([long.scrolls, long.shown], [[[0, -150]], ["0"]]);
  const fits = fake_page([box(0, 0), box(0, 60)], true, 1);
  move_item(fits.page, { selector: "li", direction: "up" });
  assert.deepEqual([fits.scrolls, fits.shown], [[], ["0"]]);
});

test("at the last item down scrolls on and up at the first scrolls back, with no notice", () => {
  const last = fake_page([box(0, 0), box(0, 60)], true, 1);
  move_item(last.page, { selector: "li", direction: "down" });
  assert.deepEqual([last.scrolls, last.toasts, last.shown], [[[0, 50]], [], []]);
  const first = fake_page([box(0, 0), box(0, 60)], true, 0);
  move_item(first.page, { selector: "li", direction: "up", times: 2 });
  assert.deepEqual([first.scrolls, first.toasts], [[[0, -100]], []]);
});

test("left and right keep their notice at the end and do not scroll", () => {
  const { page, scrolls, toasts } = fake_page([box(0, 0), box(110, 0)], true, 1);
  move_item(page, { selector: "li", direction: "right" });
  assert.deepEqual([scrolls, toasts], [[], ["No next item"]]);
});

test("a CSS-hidden item in the middle is skipped in both directions", () => {
  const down = fake_page([box(0, 0), box(0, 60), box(0, 120)], true, 0, [1]);
  move_item(down.page, { selector: "li", direction: "down" });
  assert.deepEqual(down.shown, ["2"]);
  const up = fake_page([box(0, 0), box(0, 60), box(0, 120)], true, 2, [1]);
  move_item(up.page, { selector: "li", direction: "up" });
  assert.deepEqual(up.shown, ["0"]);
});

test("with no item on the page the key scrolls by 50 px per count in its direction and shows no notice", () => {
  const { page, scrolls, toasts, log } = fake_page([]);
  move_item(page, { selector: "none", direction: "down" });
  move_item(page, { selector: "none", direction: "up", times: 3 });
  move_item(page, { selector: "none", direction: "right" });
  assert.deepEqual(scrolls, [[0, 50], [0, -150], [50, 0]]);
  assert.deepEqual([toasts, log], [[], []]);
});

test("an item taller than the view scrolls to its top, a shorter one to the centre", () => {
  const tall = fake_page([box(0, 900, 100, 1200)]);
  move_item(tall.page, { selector: "li", direction: "down" });
  assert.deepEqual(tall.log, ["tabindex=-1 on 0", "focus item 0", "scroll 0 start"]);
  const short = fake_page([box(0, 900, 100, 100)]);
  move_item(short.page, { selector: "li", direction: "down" });
  assert.deepEqual(short.log.at(-1), "scroll 0 center");
});

test("the item list is read fresh on each press, so an item added later is reached", () => {
  const { page, shown, add } = fake_page([box(0, 0)]);
  move_item(page, { selector: "li", direction: "down" });
  move_item(page, { selector: "li", direction: "down" });
  assert.deepEqual(shown, ["0"]);
  add(box(0, 60));
  move_item(page, { selector: "li", direction: "down" });
  assert.deepEqual(shown, ["0", "1"]);
});

test("page.item is a command of the item bundle", () => {
  const command = registry.get("page.item")!;
  assert.equal(command.bundle, "item");
});

test("the shipped result rows bind j and k to page.item", () => {
  for (const name of ["google", "google_videos", "ddg_news", "bing", "hackernews", "wikipedia", "reddit"]) {
    const rows = DEFAULT_SITE_ROWS.filter((entry) => entry.name === name);
    assert.ok(rows.length > 0, name);
    for (const { row } of rows) {
      assert.match(JSON.stringify(row.keymap?.item?.j), /"id":"page.item"/, name);
      assert.match(JSON.stringify(row.keymap?.item?.k), /"id":"page.item"/, name);
      assert.equal(row.bind, undefined, `${name} leaves the plain keys alone`);
    }
  }
  assert.ok(!DEFAULT_SITE_ROWS.some((entry) => (entry.name as string) === "oldreddit"));
});

test("the shipped image row binds hjkl to page.item", () => {
  for (const name of ["ddg_images", "google_images", "google_news", "google_short_videos", "google_shopping", "ddg_videos", "amazon", "kagi_images", "brave_images"]) {
    const rows = DEFAULT_SITE_ROWS.filter((entry) => entry.name === name);
    assert.ok(rows.length > 0, name);
    for (const { row } of rows) {
      const directions = ["h", "j", "k", "l"].map((key) => (row.keymap?.item?.[key] as { id: string; args: { direction: string } }).args.direction);
      assert.deepEqual(directions, ["left", "down", "up", "right"], name);
      assert.match(JSON.stringify(row.keymap?.item?.h), /"id":"page.item"/, name);
    }
  }
});

test("the Kagi and Brave image rows name their tiles, and only Kagi names a link inside them", () => {
  const args_of = (name: string) => (DEFAULT_SITE_ROWS.find((entry) => entry.name === name)!.row.keymap!.item!.j as unknown as { args: { selector: string; link?: string } }).args;
  assert.deepEqual([args_of("kagi_images").selector, args_of("kagi_images").link], ["._0_image_item", "a._0_img_link_el"]);
  assert.deepEqual([args_of("brave_images").selector, args_of("brave_images").link], ["button.image-result", undefined]);
  for (const name of ["kagi_images", "brave_images"]) assert.equal(DEFAULT_SITE_ROWS.find((entry) => entry.name === name)!.row.pass, undefined, name);
});

test("first and last go to the ends of the page whatever has focus, skip hidden items, and do nothing with no item", async () => {
  const middle = fake_page(list, true, 2);
  await move_item(middle.page, { selector: "li", link: "a.t", direction: "first" });
  await move_item(middle.page, { selector: "li", link: "a.t", direction: "last", times: 3 });
  assert.deepEqual(middle.shown, ["0", "3"]);
  assert.deepEqual(middle.log, ["focus link 0", "focus link 3"]);
  const hidden_ends = fake_page(list, true, -1, [0, 3]);
  await move_item(hidden_ends.page, { selector: "li", link: "a.t", direction: "first" });
  await move_item(hidden_ends.page, { selector: "li", link: "a.t", direction: "last" });
  assert.deepEqual(hidden_ends.shown, ["1", "2"]);
  const none = fake_page(list);
  await move_item(none.page, { selector: "none", direction: "last" });
  assert.deepEqual([none.log, none.scrolls, none.toasts], [[], [], []]);
});

// The finder's ends: no selector, the items come from the derived row.
const finder_page = (rects: Box[]) => {
  const fake = fake_page(rects);
  fake.page.derived = { sections_: () => [], items_: () => fake.page.doc.querySelectorAll("li") as unknown as Element[], link_of_: () => undefined, selector_: () => "li", grew_: () => false, grid_: () => false };
  return fake;
};

test("with no selector and no derived item, first and last refuse so content.js can scroll, and a selector row still does nothing", async () => {
  const { page, log, scrolls } = fake_page(list);
  page.derived = { sections_: () => [], items_: () => [], link_of_: () => undefined, selector_: () => "", grew_: () => false, grid_: () => false };
  assert.deepEqual(await move_item(page, { direction: "first" }), { ok: false, message: "No item" });
  assert.deepEqual(await move_item(page, { direction: "last" }), { ok: false, message: "No item" });
  assert.deepEqual([log, scrolls], [[], []]);
  assert.equal(await move_item(page, { selector: "none", direction: "last" }), undefined);
});

test("with no selector, first and last land on the end item when it is in view after the scroll", async () => {
  const { page, shown } = finder_page(list);
  await move_item(page, { direction: "first" });
  await move_item(page, { direction: "last" });
  assert.deepEqual(shown, ["0", "3"]);
});

test("with no selector, an end item off screen after the scroll takes no focus or box, so the next j does not jump back", async () => {
  const { page, log, shown } = finder_page([box(0, 1500), box(0, 1600), box(0, 1700), box(0, -900)]);
  await move_item(page, { direction: "first" });
  await move_item(page, { direction: "last" });
  assert.deepEqual([log, shown], [[], []]);
  // A row that names its selector keeps the pin on an end item off screen.
  const { page: bound, shown: bound_shown } = fake_page([box(0, 1500), box(0, 1600)]);
  await move_item(bound, { selector: "li", direction: "first" });
  assert.deepEqual(bound_shown, ["0"]);
});

test("after gg the first item stays the start of the next move while the box shows it at the same page scroll, and the pin ends with the box or a scroll", async () => {
  // The first two items lie above the view, the third is the first one in it.
  const rects = [box(0, -300), box(0, -200), box(0, 100)];
  const down_after_gg = async (change: (state: { box_shown: boolean; scroll_y: number }) => void) => {
    const { page, shown } = fake_page(rects);
    const state = { box_shown: true, scroll_y: 0 };
    Object.assign(page, { box_shown: () => state.box_shown });
    Object.defineProperty(page.view, "scrollY", { get: () => state.scroll_y });
    await move_item(page, { selector: "li", link: "a.t", direction: "first" });
    change(state);
    await move_item(page, { selector: "li", link: "a.t", direction: "down" });
    return shown;
  };
  assert.deepEqual(await down_after_gg(() => {}), ["0", "1"]);
  assert.deepEqual(await down_after_gg((state) => (state.box_shown = false)), ["0", "2"]);
  assert.deepEqual(await down_after_gg((state) => (state.scroll_y = 40)), ["0", "2"]);
});

test("every shipped page.item bind table that moves binds gg and G to its first and last item, guarded by its own item selector", () => {
  type Step = { id?: string; args?: { selector?: string; direction?: string }; when_present?: string };
  const steps_of = (binding: unknown): Step[] => [binding].flat(2) as Step[];
  let tables = 0;
  // Reddit unloads posts far above the view, so its row leaves gg to the plain scroll to the top (see REDDIT_ITEMS).
  for (const { name, row } of DEFAULT_SITE_ROWS.filter((entry) => entry.name !== "reddit")) {
    for (const { scope, table } of bind_tables_of(row as SiteRuleRow)) {
      const moves = Object.values(table).flatMap(steps_of).filter((step) => step.id === "page.item" && !["first", "last", "current"].includes(step.args?.direction ?? ""));
      if (moves.length === 0) continue;
      tables++;
      const selectors = new Set(moves.map((step) => step.args?.selector));
      for (const [key, direction] of [["gg", "first"], ["G", "last"]] as const) {
        const [bind] = steps_of(table[key]);
        const where = `${name} ${row.site} ${scope}${key}`;
        assert.equal(bind?.id, "page.item", `${where} is not bound to page.item`);
        assert.equal(bind?.args?.direction, direction, where);
        assert.ok(selectors.has(bind?.args?.selector), `${where} moves through ${bind?.args?.selector}, not the table's items`);
        assert.equal(bind?.when_present, bind?.args?.selector, `${where} is not guarded by its item selector`);
      }
    }
  }
  assert.ok(tables >= 15, `${tables} page.item bind tables`);
});

test("current focuses the item a move starts from, the first one in view when none holds the focus, and does nothing with no item", () => {
  const held = fake_page(list, true, 2);
  move_item(held.page, { selector: "li", link: "a.t", direction: "current" });
  assert.deepEqual([held.shown, held.log, held.scrolls, held.toasts], [["2"], ["focus link 2"], [], []]);
  const loose = fake_page(list);
  move_item(loose.page, { selector: "li", link: "a.t", direction: "current" });
  assert.deepEqual([loose.shown, loose.log], [["0"], ["focus link 0"]]);
  // The focus left the items (on the view toggle), so current returns to the item the last move landed on.
  const remembered = fake_page(list);
  move_item(remembered.page, { selector: "li", link: "a.t", direction: "down" });
  move_item(remembered.page, { selector: "li", link: "a.t", direction: "down" });
  move_item(remembered.page, { selector: "li", link: "a.t", direction: "current" });
  assert.deepEqual(remembered.shown, ["0", "1", "1"]);
  // With every item above the view the start index runs past the end, and current takes the last item.
  const above = fake_page(list.map((entry) => ({ ...entry, top: entry.top - 1000, bottom: entry.bottom - 1000 })));
  move_item(above.page, { selector: "li", link: "a.t", direction: "current" });
  assert.deepEqual(above.shown, [String(list.length - 1)]);
  const none = fake_page(list);
  move_item(none.page, { selector: "none", direction: "current" });
  assert.deepEqual([none.log, none.scrolls, none.toasts], [[], [], []]);
});

test("page.click clicks the first shown match, and refuses a bad selector or no shown match", () => {
  const clicked: string[] = [];
  const page = (names: string[]) => ({ querySelectorAll: (selector: string) => (selector === "[" ? (() => { throw new SyntaxError("bad"); })() : names) });
  const shown = (name: string) => !name.startsWith("hidden");
  assert.equal(click_first_shown(page(["hidden copy", "shown", "second"]), ".go", shown, (name) => clicked.push(name)), undefined);
  assert.deepEqual(clicked, ["shown"]);
  assert.equal(click_first_shown(page(["hidden copy"]), ".go", shown, (name) => clicked.push(name)), "Nothing shown on the page matches .go");
  assert.equal(click_first_shown(page([]), "[", shown, (name) => clicked.push(name)), "[ is not a valid CSS selector");
  assert.deepEqual(clicked, ["shown"]);
});

// The item finder's row: a move with no selector reads the items and links from `derived`, and `]]` has no selector to read the list again by.
test("a move with no selector walks the derived row and focuses the link the finder named", () => {
  const { page, log, shown, selectors } = fake_page(list);
  const items = page.doc.querySelectorAll("li") as unknown as { querySelector: (selector: string) => unknown }[];
  const named = { tabIndex: 0, setAttribute: () => {}, focus: () => log.push("focus found link") };
  const queries: string[] = [];
  page.doc = { ...page.doc, querySelectorAll: (selector: string) => (queries.push(selector), []) } as unknown as Document;
  page.derived = { sections_: () => [], items_: () => items as unknown as Element[], link_of_: (item) => (item === (items[0] as unknown) ? (named as unknown as Element) : undefined), selector_: () => "li.row", grew_: () => false, grid_: () => false };
  move_item(page, { direction: "down" });
  assert.deepEqual([log, shown, queries], [["focus found link"], ["0"], []]);
  // The box follows a page script's focus by the selector of the derived row, and by the row's own selector when there is one.
  assert.deepEqual(selectors, ["li.row"]);
});

test("with no selector and no derived items down scrolls like the plain key, and a count adds up", () => {
  const { page, scrolls, shown } = fake_page(list);
  page.derived = { sections_: () => [], items_: () => [], link_of_: () => undefined, selector_: () => "", grew_: () => false, grid_: () => false };
  move_item(page, { direction: "down", times: 3 });
  move_item(page, { direction: "up" });
  assert.deepEqual([scrolls, shown], [[[0, 150], [0, -50]], []]);
});

test("a move through the derived row leaves no cursor for the load step of ]]", () => {
  const { page } = fake_page(list);
  page.derived = { sections_: () => [], items_: () => page.doc.querySelectorAll("li") as unknown as Element[], link_of_: () => undefined, selector_: () => "li", grew_: () => false, grid_: () => false };
  move_item(page, { direction: "down" });
  assert.equal(read_cursor(page, true), undefined);
  move_item(page, { selector: "li", direction: "down" });
  assert.equal(read_cursor(page, true)?.selector_, "li");
});

test("with no selector and no derived item in view, down and up scroll and move no focus", () => {
  const below = list.map((entry) => ({ ...entry, top: entry.top + 5000, bottom: entry.bottom + 5000 }));
  const { page, log, scrolls, shown } = fake_page(below);
  page.derived = { sections_: () => [], items_: () => page.doc.querySelectorAll("li") as unknown as Element[], link_of_: () => undefined, selector_: () => "li", grew_: () => false, grid_: () => false };
  move_item(page, { direction: "down" });
  move_item(page, { direction: "up" });
  assert.deepEqual([log, shown, scrolls], [[], [], [[0, 50], [0, -50]]]);
});

test("down at the last item of the derived row scrolls on, so the page below the results stays reachable", () => {
  const { page, scrolls } = fake_page(list, true, 3);
  page.derived = { sections_: () => [], items_: () => page.doc.querySelectorAll("li") as unknown as Element[], link_of_: () => undefined, selector_: () => "li", grew_: () => false, grid_: () => false };
  move_item(page, { direction: "down" });
  assert.deepEqual(scrolls, [[0, 50]]);
});

test("down at the end of the derived row asks it to read the page again once, and walks on to the items the page added", () => {
  const { page, log, scrolls, add } = fake_page(list, true, 3);
  let grew = 0;
  const derived_items = () => page.doc.querySelectorAll("li") as unknown as Element[];
  page.derived = { sections_: () => [], items_: derived_items, link_of_: () => undefined, selector_: () => "li", grew_: () => (grew++ === 0 ? (add(box(0, 240)), true) : false), grid_: () => false };
  move_item(page, { direction: "down" });
  assert.deepEqual([log.at(-1), scrolls], ["focus item 4", []]);
  // A list that did not change at its end scrolls on, and the row reads nothing again.
  const { page: still, scrolls: still_scrolls } = fake_page(list, true, 3);
  still.derived = { sections_: () => [], items_: () => still.doc.querySelectorAll("li") as unknown as Element[], link_of_: () => undefined, selector_: () => "li", grew_: () => false, grid_: () => false };
  move_item(still, { direction: "down" });
  assert.deepEqual(still_scrolls, [[0, 50]]);
});

test("down with every kept item above the view asks the derived row first, and lands on the item a load added", () => {
  const above = list.map((entry) => ({ ...entry, top: entry.top - 1000, bottom: entry.bottom - 1000 }));
  const { page, log, scrolls, add } = fake_page(above);
  let asked = 0;
  page.derived = { sections_: () => [], items_: () => page.doc.querySelectorAll("li") as unknown as Element[], link_of_: () => undefined, selector_: () => "li", grew_: () => (asked++ === 0 ? (add(box(0, 240)), true) : false), grid_: () => false };
  move_item(page, { direction: "down" });
  assert.deepEqual([log.at(-1), scrolls, asked], ["focus item 4", [], 1]);
  // A page that did not grow still scrolls on.
  const { page: still, scrolls: still_scrolls } = fake_page(above);
  still.derived = { sections_: () => [], items_: () => still.doc.querySelectorAll("li") as unknown as Element[], link_of_: () => undefined, selector_: () => "li", grew_: () => false, grid_: () => false };
  move_item(still, { direction: "down" });
  assert.deepEqual(still_scrolls, [[0, 50]]);
});

// The real derived row over the fake page, with a footer node that follows the list.
function real_derived_page(focused_index: number) {
  const fake = fake_page(list, true, focused_index);
  const state = { footer: "footer" };
  fake.page.derived = create_derived_row({
    find_: () => {
      const region = { kind: "list", items: [...(fake.page.doc.querySelectorAll("li") as unknown as Element[])], links: new Map() };
      return { ...region, regions: [region] } as never;
    },
    url_: () => "https://a.test/",
    now_: () => 0,
    is_shown_: () => true,
    in_view_: () => 1,
    tail_: () => [state.footer],
  });
  return { ...fake, state };
}

test("last with the real derived row lands on an item the page adds while the first item stays shown", async () => {
  const { page, shown, add, state } = real_derived_page(-1);
  const done = move_item(page, { direction: "last" }) as Promise<void>;
  add(box(0, 240));
  state.footer = "footer 2";
  await done;
  assert.equal(shown.at(-1), "4");
});

test("down at the end of a list the real derived row kept reads again once the page adds items, and walks on to them", () => {
  const { page, log, scrolls, add, state } = real_derived_page(3);
  move_item(page, { direction: "down" });
  assert.deepEqual(scrolls, [[0, 50]]);
  add(box(0, 240));
  state.footer = "footer 2";
  move_item(page, { direction: "down" });
  assert.equal(log.at(-1), "focus item 4");
});

test("with no selector, h and l step along a derived grid and scroll sideways on a derived list", () => {
  const { page, log, scrolls } = fake_page(grid, true, 0);
  let grid_kind = true;
  page.derived = { sections_: () => [], items_: () => page.doc.querySelectorAll("li") as unknown as Element[], link_of_: () => undefined, selector_: () => "li", grew_: () => false, grid_: () => grid_kind };
  move_item(page, { direction: "right" });
  assert.deepEqual([log.at(-1), scrolls], ["focus item 1", []]);
  grid_kind = false;
  move_item(page, { direction: "right" });
  move_item(page, { direction: "left", times: 2 });
  assert.deepEqual(scrolls, [[50, 0], [-100, 0]]);
});

// The pin: a picked side list is the one a row's keys walk.
test("with a pin a move that names the row's selector walks the pinned list and leaves no cursor for ]]", () => {
  const { page, log } = real_derived_page(-1);
  const derived = page.derived as unknown as DerivedRow;
  const walk = (args: { selector?: string; link?: string; direction: "down" }) => move_item(page, args_for_pin(derived, args));
  walk({ selector: "li", link: "a.t", direction: "down" });
  assert.equal(read_cursor(page, true)?.selector_, "li", "no pin: the row walks its selector and link");
  assert.deepEqual(log, ["focus link 0"]);
  forget_move();
  derived.pin_(derived.lists_()[0]!);
  log.length = 0;
  walk({ selector: "li", link: "a.t", direction: "down" });
  assert.deepEqual(log, ["tabindex=-1 on 0", "focus item 0"], "the row's link selector is dropped for the pinned list");
  assert.equal(read_cursor(page, true), undefined);
  derived.unpin_();
  forget_move();
  walk({ selector: "li", link: "a.t", direction: "down" });
  assert.equal(read_cursor(page, true)?.selector_, "li", "an unpinned list gives the row its keys back");
});

test("a row that matches no item still walks the pinned list, and scrolls once the pin is off", () => {
  const { page, log, scrolls } = real_derived_page(-1);
  const derived = page.derived as unknown as DerivedRow;
  derived.pin_(derived.lists_()[0]!);
  move_item(page, args_for_pin(derived, { selector: "none", direction: "down" }));
  assert.deepEqual([log, scrolls], [["tabindex=-1 on 0", "focus item 0"], []]);
  derived.unpin_();
  forget_move();
  move_item(page, args_for_pin(derived, { selector: "none", direction: "down" }));
  assert.deepEqual(scrolls, [[0, 50]]);
});

// `lists_with_row` over fake elements: contains is the DOM one, a node holds itself and what is under it.
test("the picker offers the row's list first, then the finder's lists that share no item with it", () => {
  type Node = { name: string; contains: (other: Node) => boolean; checkVisibility: () => boolean; getClientRects: () => number[]; getBoundingClientRect: () => { width: number; height: number } };
  const node = (name: string, parent?: Node): Node => {
    const made: Node = { name, contains: (other) => other === made || (other as unknown as { parent?: Node }).parent === made, checkVisibility: () => true, getClientRects: () => [1], getBoundingClientRect: () => ({ width: 100, height: 40 }) };
    Object.assign(made, { parent });
    return made;
  };
  const rows = [node("r1"), node("r2")];
  const inner = node("inner", rows[0]);
  const side = [node("s1"), node("s2")];
  const region = (items: Node[]) => ({ kind: "list" as const, items: items as never[], links: new Map() });
  const doc = { querySelectorAll: (selector: string) => (selector === "row" ? rows : []) } as unknown as ParentNode;
  const finder = () => [region(rows), region([inner]), region(side)];
  const names = (regions: { items: unknown[] }[]) => regions.map((one) => (one.items as Node[]).map((entry) => entry.name).join());
  assert.deepEqual(names(lists_with_row(doc, finder, "row", false)), ["r1,r2", "s1,s2"], "a finder list equal to, or held by, a row item is the row again");
  assert.equal(lists_with_row(doc, finder, "row", false)[0]?.row_, true);
  assert.deepEqual(names(lists_with_row(doc, finder, "row", true)), ["r1,r2"], "row_only offers the row alone");
  assert.deepEqual(names(lists_with_row(doc, finder, "other", false)), ["r1,r2", "inner", "s1,s2"], "a row with no item shown offers the finder's lists as they are");
});

// A row pick unpins and leaves the side list active, so picking the side list again is a new pick: it takes the focus and drops the old move.
test("picking a side list again after a pick of the row's list takes the focus again", () => {
  const { page } = real_derived_page(-1);
  const derived = page.derived as unknown as DerivedRow;
  const side = derived.lists_()[0]!;
  const row = { kind: "list" as const, items: [{}] as never[], links: new Map(), row_: true as const };
  const focuses: string[] = [];
  const focus = { focus: () => focuses.push("focus") } as unknown as HTMLElement;
  pick_list(derived, side, focus, true);
  assert.deepEqual(focuses, ["focus"]);
  pick_list(derived, side, focus, true);
  assert.deepEqual(focuses, ["focus"], "the pinned list again leaves the focus alone");
  pick_list(derived, row, focus, true);
  pick_list(derived, side, focus, true);
  assert.equal(focuses.length, 3, "the row pick and the repick each take the focus");
  assert.equal(derived.pinned_(), true);
});

// A list that names its own active row (aria-activedescendant): the pick and the landing leave the focus where the widget keeps it, the box still draws, and Enter's link is the row.
test("an ARIA list with focus_none_ takes no focus on a pick or a landing, draws the box and gives the row as its link", () => {
  const { page, items, log, shown, selectors } = fake_page(list, true, -1);
  const region = { kind: "list" as const, items: items as unknown as Element[], links: new Map(items.map((entry) => [entry, entry])), pick_only_: true as const, focus_none_: true as const, box_selector_: "[role=option]" } as never;
  const derived = create_derived_row({ find_: () => ({ ...(region as object), regions: [region] }) as never, url_: () => "https://a.test/", now_: () => 0, is_shown_: () => true, in_view_: () => 1, tail_: () => [] });
  page.derived = derived;
  derived.items_();
  const focuses: string[] = [];
  pick_list(derived, region, { focus: () => focuses.push("focus") } as unknown as HTMLElement, false);
  assert.deepEqual(focuses, [], "the pick leaves the widget's focus alone");
  move_item(page, { direction: "current" });
  move_item(page, { direction: "down" });
  assert.deepEqual([log, shown, selectors], [[], ["0", "1"], ["[role=option]", "[role=option]"]]);
  assert.equal(derived.link_of_(items[1] as unknown as Element), items[1]);
});

const rect_of = (top: number, bottom: number) => ({ left: 10, right: 110, top, bottom, width: 100, height: bottom - top });
const head_with_text = (text: { top: number; bottom: number; shown: boolean } | null, selected: string[] = []) =>
  ({
    getBoundingClientRect: () => rect_of(100, 136),
    parentElement: { querySelector: (selector: string) => (selected.push(selector), text && { checkVisibility: () => text.shown, getBoundingClientRect: () => rect_of(text.top, text.bottom) }) },
  }) as unknown as Element;

test("item_rect grows the box from the head down to the text the extent selector finds from the parent", () => {
  const selected: string[] = [];
  assert.deepEqual(item_rect(head_with_text({ top: 136, bottom: 1500, shown: true }, selected), ":scope > div > [slot=comment]"), { left: 10, right: 110, top: 100, bottom: 1500, width: 100, height: 1400 });
  assert.deepEqual(selected, [":scope > div > [slot=comment]"]);
});

test("item_rect keeps the own box with no extent, no match, a hidden match or a match above the head's bottom", () => {
  const own = { left: 10, right: 110, top: 100, bottom: 136, width: 100, height: 36 };
  const selected: string[] = [];
  assert.deepEqual(item_rect(head_with_text({ top: 136, bottom: 900, shown: true }, selected)), own);
  assert.deepEqual(selected, [], "an empty extent runs no query");
  assert.deepEqual(item_rect(head_with_text(null), "p"), own);
  assert.deepEqual(item_rect(head_with_text({ top: 136, bottom: 900, shown: false }), "p"), own, "a folded comment's stale text box is ignored");
  assert.deepEqual(item_rect(head_with_text({ top: 0, bottom: 120, shown: true }), "p"), own);
});

test("an item inside the window that the hit test finds covered is centered, once per landing", () => {
  const { page, log } = fake_page(list);
  let covered = true;
  page.in_view_ = () => (covered ? 0 : 1);
  move_item(page, { selector: "li", link: "a.t", direction: "down" });
  assert.deepEqual(log, ["focus link 0", "scroll 0 center"]);
  // An item the probe finds uncovered does not scroll. There is no loop: land_on probes once per landing.
  covered = false;
  log.length = 0;
  move_item(page, { selector: "li", link: "a.t", direction: "down" });
  assert.deepEqual(log, ["focus link 1"]);
});
