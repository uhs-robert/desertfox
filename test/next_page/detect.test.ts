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

test("a CJK next word is not found inside a longer word or a long sentence", () => {
  const patterns = ["次へ", "次のページ"];
  assert.equal(best([link("目次へ")], patterns), -1);
  assert.equal(best([link("目次へ戻る")], patterns), -1);
  assert.equal(best([link("目次へ戻る"), link("次のページへ")], patterns), 1);
  assert.equal(best([link("次へ進むには会員登録が必要です。詳細は利用規約をご確認ください")], patterns), -1);
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
  const track: SavedNode = { t: "div", r: [0, 200, 880, 240], x: 1, c: [{ t: "div", r: [0, 200, 400, 240] }, { t: "div", r: [400, 200, 400, 240] }] };
  const pager: SavedNode = { t: "a", a: { href: "?page=2" }, r: [500, 2000, 60, 30], s: "Next" };
  const root: SavedNode = { t: "body", r: [0, 0, 1366, 2100], c: [{ t: "section", r: [0, 200, 1366, 240], c: [track, arrow] }, pager] };
  for (const node of [root, ...root.c!, track, arrow]) for (const child of node.c ?? []) child.up = node;
  const reader = saved_reader({ view: { w: 1366, h: 900, doc_h: 2100 }, root });
  const controls = [{ node: arrow, texts: ["Next"], is_link: false }, { node: pager, texts: ["Next"], is_link: true }];
  assert.equal(pick_next_control(reader, controls, NEXT), pager);
  assert.equal(pick_next_control(reader, controls.slice(0, 1), NEXT), undefined);
});

test("a short page with an audio element is no player, so its pager still counts", () => {
  const pager: SavedNode = { t: "a", a: { href: "?page=2" }, r: [500, 600, 60, 30], s: "Next" };
  const root: SavedNode = { t: "body", r: [0, 0, 1366, 800], c: [{ t: "audio", r: [0, 0, 300, 30] }, pager] };
  for (const child of root.c!) child.up = root;
  const reader = saved_reader({ view: { w: 1366, h: 900, doc_h: 800 }, root });
  assert.equal(pick_next_control(reader, [{ node: pager, texts: ["Next"], is_link: true }], NEXT), pager);
});

const link_among = (children: SavedNode[], pager: SavedNode, texts = "Next") => {
  const root: SavedNode = { t: "body", r: [0, 0, 1366, 800], c: children };
  const wire = (node: SavedNode) => node.c?.forEach((child) => ((child.up = node), wire(child)));
  wire(root);
  const reader = saved_reader({ view: { w: 1366, h: 900, doc_h: 800 }, root });
  return pick_next_control(reader, [{ node: pager, texts: [texts], is_link: true }], NEXT);
};

test("a sideways track is a carousel whatever its children, but a code block is not", () => {
  const pager: SavedNode = { t: "a", a: { href: "?page=2" }, r: [500, 600, 60, 30], s: "Next" };
  const spans = Array.from({ length: 6 }, (_, at) => ({ t: "span", r: [at * 100, 100, 100, 20] }) as SavedNode);
  assert.equal(link_among([{ t: "pre", r: [0, 100, 600, 200], x: 1, c: spans }, pager], pager), pager);
  assert.equal(link_among([{ t: "table", r: [0, 100, 600, 200], x: 1 }, pager], pager), pager);
  const cards = [{ t: "div", r: [0, 100, 200, 200] }, { t: "div", r: [200, 100, 200, 200] }] as SavedNode[];
  assert.equal(link_among([{ t: "div", r: [0, 100, 600, 200], x: 1, c: cards }, pager], pager), undefined);
});

test("a menu scroller with one inner track keeps its arrow from being the next page", () => {
  const arrow: SavedNode = { t: "a", a: { href: "/menu2" }, r: [1300, 20, 40, 30], s: "次へ" };
  const track: SavedNode = { t: "ul", r: [0, 20, 1200, 30], c: [{ t: "li", r: [0, 20, 100, 30] }] };
  assert.equal(link_among([{ t: "div", r: [0, 20, 1250, 30], x: 1, c: [track] }, arrow], arrow, "次へ"), undefined);
});

test("a pager in a nav of stacked items is still followed", () => {
  const pager: SavedNode = { t: "a", a: { href: "?page=3" }, r: [10, 260, 120, 30], s: "Next" };
  const item = (y: number, c: SavedNode[] = []) => ({ t: "li", r: [10, y, 120, 30], c }) as SavedNode;
  const nav: SavedNode = { t: "nav", r: [0, 100, 200, 200], c: [{ t: "ul", r: [10, 200, 120, 100], c: [item(200), item(230), item(260, [pager])] }] };
  assert.equal(link_among([nav], pager), pager);
});

test("the arrow of an ad post's gallery is skipped even when it is the only ad in its list", () => {
  const arrow: SavedNode = { t: "button", a: { "aria-label": "Next page" }, r: [900, 300, 40, 40] };
  const ad: SavedNode = { t: "shreddit-ad-post", a: { class: "promotedlink" }, r: [0, 200, 700, 500], c: [arrow] };
  const feed: SavedNode = { t: "div", r: [0, 100, 1000, 900], c: [ad, { t: "article", a: { class: "post" }, r: [0, 750, 700, 150] }] };
  const root: SavedNode = { t: "body", r: [0, 0, 1366, 1000], c: [feed] };
  for (const node of [root, feed, ad]) for (const child of node.c ?? []) child.up = node;
  const reader = saved_reader({ view: { w: 1366, h: 900, doc_h: 1000 }, root });
  const controls = [{ node: arrow, texts: ["Next page"], is_link: false }];
  assert.equal(pick_next_control(reader, controls, NEXT), undefined);
  ad.t = "x-load-post";
  ad.a = { class: "load-more pagination-header" };
  assert.equal(pick_next_control(reader, controls, NEXT), arrow);
  ad.t = "div";
  delete ad.a;
  assert.equal(pick_next_control(reader, controls, NEXT), arrow);
});
