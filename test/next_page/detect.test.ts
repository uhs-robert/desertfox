import assert from "node:assert/strict";
import { test } from "node:test";
import { pick_next_control, rank_by_text } from "../../src/content/next_page/detect.ts";
import { is_load_text } from "../../src/content/next_page/load_more.ts";
import { saved_reader } from "../support/snapshot_page.ts";
import type { SavedNode } from "../support/snapshot_page.ts";

const link = (text: string, is_link = true) => ({ texts: [text], is_link });
const NEXT = ["next", "newer", ">", "›", ">>", "次へ"];
const best = (items: { texts: string[]; is_link: boolean }[], patterns = NEXT) => rank_by_text(items, patterns)[0] ?? -1;

test("an earlier pattern beats a later one whatever the page order", () => {
  assert.equal(best([link("Newer"), link("Next")]), 1);
});

test("a link beats a button, then the shorter text wins, then the earlier item", () => {
  assert.equal(best([link("next", false), link("next")]), 1);
  assert.equal(best([link("next page"), link("next")]), 1);
  assert.equal(best([link("next"), link("next")]), 0);
});

test("a word beside kana or kanji still matches, as those scripts have no spaces between words", () => {
  assert.equal(best([link("次のページへ")], ["次のページ"]), 0);
  assert.equal(best([link("次へ進む")]), 0);
});

test("every match is ranked, so a caller can pass over a skipped one", () => {
  assert.deepEqual(rank_by_text([link("home"), link("next page"), link("next")], NEXT), [2, 1]);
});

test("a word matches whole words only, so a tag that holds it is no next link", () => {
  assert.equal(best([link("#nextjs")]), -1);
  assert.equal(best([link("NEXT page")]), 0);
  assert.equal(best([link("次へ")]), 0);
});

test("a text of five words still matches and a sentence does not", () => {
  assert.equal(best([link("Go to next search page")]), 0);
  assert.equal(best([link("Read more about the next release")]), -1);
});

test("a one or two character pattern needs the whole text", () => {
  assert.equal(best([link("a > b"), link("Back to top >>")]), -1);
  assert.equal(best([link(" > ")]), 0);
});

test("any of the texts of an item can match, and blank patterns are ignored", () => {
  assert.equal(best([{ texts: ["", "Go on", "next"], is_link: true }], ["", "next"]), 0);
  assert.equal(best([link("anything")], [""]), -1);
});

test("a load text is a whole load word, with counts dropped and one noun allowed", () => {
  for (const text of ["More results", "LOAD MORE STORIES", "Еще 20 материалов", "Mostrar mais conteúdos", "もっと見る", "Voir plus d’articles"]) assert.ok(is_load_text(text), text);
  for (const text of ["Read more about the release", "Show more comments from people you follow", "Next"]) assert.ok(!is_load_text(text), text);
});

test("an arrow beside a sideways track is a carousel control, not the next page", () => {
  const arrow: SavedNode = { t: "button", a: { "aria-label": "Next" }, r: [900, 300, 40, 40] };
  const track: SavedNode = { t: "div", r: [0, 200, 880, 240], x: 1 };
  const pager: SavedNode = { t: "a", a: { href: "?page=2" }, r: [500, 2000, 60, 30], s: "Next" };
  const root: SavedNode = { t: "body", r: [0, 0, 1366, 2100], c: [{ t: "section", r: [0, 200, 1366, 240], c: [track, arrow] }, pager] };
  for (const node of [root, ...root.c!, track, arrow]) for (const child of node.c ?? []) child.up = node;
  const reader = saved_reader({ view: { w: 1366, h: 900, doc_h: 2100 }, root });
  const controls = [{ node: arrow, texts: ["Next"], is_link: false }, { node: pager, texts: ["Next"], is_link: true }];
  assert.equal(pick_next_control(reader, controls, NEXT), pager);
  assert.equal(pick_next_control(reader, controls.slice(0, 1), NEXT), undefined);
});
