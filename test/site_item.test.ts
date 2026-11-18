import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";
import { bind_tables_of, type SiteRuleRow } from "../src/shared/match_pattern.ts";
import { move_item, pick_item, place_of, step_from } from "../src/content/item/pick.ts";
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

// A page of fake items. `focus` records which element took the focus and with which options.
function fake_page(rects: Box[], on_screen = true, focused_index = -1, hidden: number[] = []) {
  const log: string[] = [];
  const shown: string[] = [];
  const toasts: string[] = [];
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
    highlight: (item: unknown) => shown.push(String(items.indexOf(item as (typeof items)[number]))),
  } as unknown as ItemPage;
  return { page, log, shown, toasts, scrolls, add: (rect: Box) => items.push(make(rect, items.length)) };
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
      assert.match(JSON.stringify(row.bind?.j), /"id":"page.item"/, name);
      assert.match(JSON.stringify(row.bind?.k), /"id":"page.item"/, name);
    }
  }
  assert.ok(!DEFAULT_SITE_ROWS.some((entry) => (entry.name as string) === "oldreddit"));
});

test("the shipped image row binds hjkl to page.item", () => {
  for (const name of ["ddg_images", "google_images", "google_news", "google_short_videos", "google_shopping", "ddg_videos", "amazon"]) {
    const rows = DEFAULT_SITE_ROWS.filter((entry) => entry.name === name);
    assert.ok(rows.length > 0, name);
    for (const { row } of rows) {
      const directions = ["h", "j", "k", "l"].map((key) => (row.bind?.[key] as { id: string; args: { direction: string } }).args.direction);
      assert.deepEqual(directions, ["left", "down", "up", "right"], name);
      assert.match(JSON.stringify(row.bind?.h), /"id":"page.item"/, name);
    }
  }
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
