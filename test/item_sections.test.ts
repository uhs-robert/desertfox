import assert from "node:assert/strict";
import { test } from "node:test";
import { args_for_pin } from "../src/content/item/lists.ts";
import { forget_move, move_item, pick_section, section_starts } from "../src/content/item/pick.ts";
import type { ItemPage } from "../src/content/item/pick.ts";
import type { DerivedRow } from "../src/content/item/derived.ts";

const on = (index: number) => ({ index, on_item: true });
const off = (index: number) => ({ index, on_item: false });

test("pick_section: next goes to the next start, a count runs on and stops at the last", () => {
  const starts = [0, 2, 4];
  assert.deepEqual(pick_section(starts, on(0), "next_section", 1), 2);
  assert.deepEqual(pick_section(starts, on(3), "next_section", 1), 4);
  assert.deepEqual(pick_section(starts, on(0), "next_section", 2), 4);
  assert.deepEqual(pick_section(starts, on(0), "next_section", 9), 4);
  assert.deepEqual(pick_section(starts, on(4), "next_section", 1), undefined);
  assert.deepEqual(pick_section([2, 4], on(0), "next_section", 1), 2, "an item before all sections goes to the first start");
});

test("pick_section: previous goes to the own section start first, then back", () => {
  const starts = [0, 2, 4];
  assert.deepEqual(pick_section(starts, on(3), "prev_section", 1), 2);
  assert.deepEqual(pick_section(starts, on(2), "prev_section", 1), 0);
  assert.deepEqual(pick_section(starts, on(3), "prev_section", 2), 0);
  assert.deepEqual(pick_section(starts, on(0), "prev_section", 1), undefined);
  assert.deepEqual(pick_section([2, 4], on(1), "prev_section", 1), undefined, "an item before all sections has no previous");
});

test("pick_section: from no item next takes the first start at or after the place and previous the last before it", () => {
  const starts = [0, 2, 4];
  assert.deepEqual(pick_section(starts, off(2), "next_section", 1), 2);
  assert.deepEqual(pick_section(starts, off(3), "next_section", 1), 4);
  assert.deepEqual(pick_section(starts, off(2), "prev_section", 1), 0);
  assert.deepEqual(pick_section(starts, off(6), "next_section", 1), undefined);
});

// Items and sections as nodes: a section holds the items listed in `holds`.
const node = (name: string, holds: unknown[] = []) => ({ name, contains: (other: unknown) => other === node_by_name.get(name) || holds.includes(other) });
const node_by_name = new Map<string, unknown>();
const make = (name: string, holds?: unknown[]) => {
  const made = node(name, holds);
  node_by_name.set(name, made);
  return made as unknown as Element;
};

test("section_starts takes the first item of each section in document order and skips empty sections and items outside", () => {
  const items = ["a", "b", "c", "d", "e"].map((name) => make(name));
  const [, b, c, d, e] = items;
  const late_first = make("s_late", [d, e]);
  const early = make("s_early", [b, c]);
  const empty = make("s_empty", []);
  assert.deepEqual(section_starts(items, [late_first, early, empty]), [1, 3], "document order, a is in no section");
  assert.deepEqual(section_starts(items, []), []);
});

// A page of five items in two sections: items 0 and 1 in section A, items 2, 3 and 4 in section B.
function sectioned_page(options: { sections?: boolean; section_selector?: boolean } = {}) {
  const shown: number[] = [];
  const log: string[] = [];
  const items: Record<string, unknown>[] = [];
  for (let index = 0; index < 5; index++) {
    const rect = { top: index * 60, bottom: index * 60 + 40, left: 0, right: 100 };
    items.push({ index, getBoundingClientRect: () => rect, getClientRects: () => [rect], checkVisibility: () => true, tabIndex: 0, focus: () => log.push(`focus ${index}`), setAttribute: () => {}, contains: (other: unknown) => other === items[index], isConnected: true, scrollIntoView: () => {}, querySelector: () => null, matches: () => false });
  }
  const make_section = (held: number[]) => ({ getClientRects: () => [{}], checkVisibility: () => true, contains: (other: unknown) => held.some((index) => items[index] === other) });
  const sections = [make_section([0, 1]), make_section([2, 3, 4])];
  const derived = { items_: () => items, sections_: () => (options.sections === false ? [] : sections), link_of_: () => undefined, selector_: () => "li", grew_: () => false, grid_: () => false, focus_none_: () => false };
  const page = {
    doc: { querySelectorAll: (selector: string) => (selector === ".sec" ? sections : selector === ".nosec" ? [] : items) },
    view: { innerHeight: 800, innerWidth: 800, scrollY: 0 },
    focused: () => null,
    toast: () => {},
    scroll_by: () => log.push("scroll"),
    box_shown: () => false,
    highlight: (item: { index: number }) => shown.push(item.index),
    derived,
  } as unknown as ItemPage;
  return { page, shown, log };
}

test("the section moves land on the section starts, and a count jumps that many", () => {
  forget_move();
  const { page, shown } = sectioned_page();
  const fail = (message: string) => ({ ok: false, message });
  move_item(page, { direction: "next_section" });
  assert.deepEqual(shown, [0], "from no item the first start at or after the first item in view");
  move_item(page, { direction: "next_section" });
  assert.deepEqual(shown, [0, 2]);
  assert.deepEqual(move_item(page, { direction: "next_section" }), fail("No next section"));
  move_item(page, { direction: "prev_section" });
  assert.deepEqual(shown, [0, 2, 0], "from the start of B, previous goes to the start of A");
  assert.deepEqual(move_item(page, { direction: "prev_section" }), fail("No previous section"));
  move_item(page, { direction: "next_section", times: 5 });
  assert.deepEqual(shown, [0, 2, 0, 2], "a count stops at the last section");
});

test("a section selector in the args replaces the finder's sections, and no sections fail without scrolling", () => {
  forget_move();
  const named = sectioned_page();
  move_item(named.page, { direction: "next_section", section: ".sec", times: 2 });
  assert.deepEqual(named.shown, [2]);
  const none = sectioned_page({ sections: false });
  const outcomes = [move_item(none.page, { direction: "next_section" }), move_item(none.page, { direction: "prev_section", section: ".nosec" })];
  assert.deepEqual(outcomes, Array(2).fill({ ok: false, message: "No sections in this list" }));
  assert.deepEqual([none.shown, none.log], [[], []]);
});

test("a pinned list drops the row's section selector with its selector, so the finder's sections of the pinned list count", () => {
  const pinned = { pinned_: () => true } as unknown as DerivedRow;
  const free = { pinned_: () => false } as unknown as DerivedRow;
  const args = { selector: "li", section: ".sec", direction: "next_section" as const };
  assert.deepEqual(args_for_pin(pinned, args), { direction: "next_section" });
  assert.equal(args_for_pin(free, args), args);
});
