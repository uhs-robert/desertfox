// The shipped amazon row's selectors run against a trimmed copy of a saved Amazon results page (test/fixtures/amazon/search_results.html).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { load } from "cheerio";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";

type Item_args = { selector: string; link: string };

const rows = DEFAULT_SITE_ROWS.filter((entry) => entry.name === "amazon");
const { selector, link } = (rows[0]!.row.keymap!.item!.j as unknown as { args: Item_args }).args;
const page = load(readFileSync(new URL("fixtures/amazon/search_results.html", import.meta.url), "utf8"));

test("the amazon rows cover the search address forms and share one item selector", () => {
  assert.deepEqual(rows.map(({ row }) => row.site), ["https://www.amazon.com/s?*", "https://www.amazon.com/s/*"]);
  for (const { row } of rows) assert.deepEqual((row.keymap!.item!.l as unknown as { args: Item_args }).args, { selector, link, direction: "right" });
});

test("the item selector matches organic results only, not ads, carousels or the header", () => {
  const items = page(selector).toArray();
  assert.equal(items.length, 6);
  assert.ok(items.every((item) => !page(item).hasClass("AdHolder") && page(item).find(".puis-sponsored-label-text").length === 0));
  assert.equal(page('div[data-component-type="s-search-result"]').length, 8);
});

test("each item has one title link, the anchor around the h2, and not the image link", () => {
  for (const item of page(selector).toArray()) {
    const links = page(item).find(link);
    assert.equal(links.length, 1);
    assert.equal(links.first().find("> h2").length, 1);
    assert.ok(!links.first().hasClass("s-no-outline"));
  }
});
