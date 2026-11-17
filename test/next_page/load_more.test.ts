import assert from "node:assert/strict";
import { test } from "node:test";
import { detect_next_page } from "../../src/content/next_page/detect.ts";
import { find_load_more } from "../../src/content/next_page/load_more.ts";
import { DEFAULT_NEXT_PATTERNS } from "../../src/shared/default_settings.ts";
import { saved_input, saved_reader } from "../support/snapshot_page.ts";
import type { SavedNode, SavedPage } from "../support/snapshot_page.ts";

type Box = [number, number, number, number];
const node = (t: string, r: Box, rest: Partial<SavedNode> = {}): SavedNode => ({ t, r, ...rest });

// A column of six stacked items, then whatever follows the list in the main column. The page ends 200 px below the last item.
function page_with(after: SavedNode[], inside_first_item: SavedNode[] = []): SavedPage {
  const items = Array.from({ length: 6 }, (_, at) => node("li", [100, 100 + at * 100, 700, 90], { a: { class: "item" }, c: at === 0 ? inside_first_item : [] }));
  const main = node("main", [100, 100, 700, 600], { c: [node("ul", [100, 100, 700, 600], { c: items }), ...after] });
  const root = node("html", [0, 0, 1366, 900], { c: [node("body", [0, 0, 1366, 900], { c: [main] })] });
  const link_up = (at: SavedNode, up: SavedNode | null) => {
    at.up = up;
    for (const child of at.c ?? []) link_up(child, at);
  };
  link_up(root, null);
  return { view: { w: 1366, h: 800, doc_h: 900 }, root };
}

const answer = (page: SavedPage) => {
  const outcome = detect_next_page(saved_reader(page), saved_input(page, DEFAULT_NEXT_PATTERNS), find_load_more);
  return outcome.action === "none" ? "none" : `${outcome.action} ${outcome.target.s ?? outcome.target.t}`;
};

const pointer_div = (text: string, y = 710, extra: Partial<SavedNode> = {}) => node("div", [100, y, 700, 40], { k: 1, s: text, a: { class: "more" }, ...extra });

test("a div with its own pointer cursor and a load word is clicked", () => {
  assert.equal(answer(page_with([pointer_div("Еще 20 материалов")])), "click Еще 20 материалов");
});

test("a pointer div with no load word is not clicked", () => {
  assert.equal(answer(page_with([pointer_div("Subscribe to the newsletter")])), "scroll li");
});

test("a load word with no pointer cursor of its own is not clicked", () => {
  const plain = pointer_div("Load more");
  delete plain.k;
  assert.equal(answer(page_with([plain])), "scroll li");
});

test("a pointer div inside an item is not clicked", () => {
  assert.equal(answer(page_with([], [pointer_div("Show more", 700)])), "scroll li");
});

test("a pointer div that holds a link or button is left to that control", () => {
  const holder = pointer_div("Load more", 710, { c: [node("a", [110, 715, 100, 30], { a: { href: "/more" }, s: "Load more" })] });
  assert.equal(answer(page_with([holder])), "click Load more");
  assert.equal((detect_next_page(saved_reader(page_with([holder])), { rel_links: [], controls: [], patterns: [] }, find_load_more) as { target: SavedNode }).target.t, "a");
});

test("a pointer div in a footer branch of four controls is not clicked", () => {
  const footer = node("div", [100, 700, 700, 100], { c: [pointer_div("Load more"), ...[0, 1, 2].map((at) => node("button", [100 + at * 100, 760, 80, 30], { s: "x" }))] });
  assert.equal(answer(page_with([footer])), "scroll li");
});

test("a pointer div never counts as a plain button, so a worded one is needed", () => {
  assert.equal(answer(page_with([pointer_div("Continue")])), "scroll li");
});

test("a pointer div in page chrome is not clicked", () => {
  assert.equal(answer(page_with([node("footer", [100, 700, 700, 100], { c: [pointer_div("Load more", 710)] })])), "scroll li");
});

test("a pointer div marked aria-disabled is not clicked", () => {
  assert.equal(answer(page_with([pointer_div("Load more", 710, { a: { "aria-disabled": "true" } })])), "scroll li");
});
