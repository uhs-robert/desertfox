import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";
import { move_item, pick_item, place_of, step_from } from "../src/content/item/pick.ts";
import type { Box, ItemPage } from "../src/content/item/pick.ts";

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
function fake_page(rects: Box[], on_screen = true) {
  const log: string[] = [];
  const shown: string[] = [];
  const toasts: string[] = [];
  const make = (rect: Box, index: number) => {
    const link = { tabIndex: 0, setAttribute: () => {}, focus: () => log.push(`focus link ${index}`) };
    return {
      tabIndex: -1,
      checkVisibility: () => true,
      getClientRects: () => [rect],
      getBoundingClientRect: () => rect,
      contains: () => false,
      querySelector: (selector: string) => (selector === "a.t" ? link : null),
      setAttribute: (name: string, value: string) => log.push(`${name}=${value} on ${index}`),
      focus: () => log.push(`focus item ${index}`),
      scrollIntoView: (options: { block: string }) => log.push(`scroll ${index} ${options.block}`),
    };
  };
  const items = rects.map(make);
  const scrolls: number[][] = [];
  const page = {
    doc: { querySelectorAll: (selector: string) => (selector === "none" ? [] : items) },
    view: { innerHeight: 800, innerWidth: on_screen ? 800 : 50 },
    focused: () => null,
    toast: (message: string) => toasts.push(message),
    scroll_by: (dx: number, dy: number) => scrolls.push([dx, dy]),
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

test("move_item toasts at the end", () => {
  const { page, toasts } = fake_page([box(0, 0)]);
  move_item(page, { selector: "li", direction: "down" });
  move_item(page, { selector: "li", direction: "down" });
  assert.deepEqual(toasts, ["No next item"]);
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
  for (const name of ["google", "bing", "hackernews", "wikipedia"]) {
    const rows = DEFAULT_SITE_ROWS.filter((entry) => entry.name === name);
    assert.ok(rows.length > 0, name);
    for (const { row } of rows) {
      assert.match(JSON.stringify(row.bind?.j), /"id":"page.item"/, name);
      assert.match(JSON.stringify(row.bind?.k), /"id":"page.item"/, name);
    }
  }
  assert.ok(!DEFAULT_SITE_ROWS.some((entry) => (entry.name as string) === "oldreddit"));
});
