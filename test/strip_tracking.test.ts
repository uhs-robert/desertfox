import assert from "node:assert/strict";
import { test } from "node:test";
import { strip_tracking } from "../src/content/strip_tracking.ts";
import { DEFAULT_STRIP_TRACKING_PARAMS } from "../src/shared/default_settings.ts";

const patterns = ["utm_*", "fbclid"];

test("a prefix glob and a plain name drop their parameters, the rest stays in order", () => {
  assert.equal(strip_tracking("https://a.com/p?utm_source=x&id=5&fbclid=z&utm_medium=m&b=2", patterns), "https://a.com/p?id=5&b=2");
});

test("names compare without case, values do not matter", () => {
  assert.equal(strip_tracking("https://a.com/p?UTM_Source=x&FBCLID=&id=5", patterns), "https://a.com/p?id=5");
});

test("a repeated parameter goes every time", () => {
  assert.equal(strip_tracking("https://a.com/p?fbclid=1&id=5&fbclid=2", patterns), "https://a.com/p?id=5");
});

test("the fragment stays, and a query that empties out loses its question mark", () => {
  assert.equal(strip_tracking("https://a.com/p?utm_source=x#frag", patterns), "https://a.com/p#frag");
  assert.equal(strip_tracking("https://a.com/p?utm_source=x&id=5#frag?utm_x=1", patterns), "https://a.com/p?id=5#frag?utm_x=1");
});

test("an address with no query, or no matching parameter, comes back byte for byte", () => {
  assert.equal(strip_tracking("https://a.com/p#x", patterns), "https://a.com/p#x");
  assert.equal(strip_tracking("https://a.com/p?q=a%20b+c&r=%E2%82%AC", patterns), "https://a.com/p?q=a%20b+c&r=%E2%82%AC");
});

test("a parameter without a value and a name that only starts like a pattern", () => {
  assert.equal(strip_tracking("https://a.com/p?fbclid&xfbclid=1&utm", patterns), "https://a.com/p?xfbclid=1&utm");
});

test("an address that is no web address passes through", () => {
  assert.equal(strip_tracking("mailto:a@b.c?utm_source=x", patterns), "mailto:a@b.c?utm_source=x");
  assert.equal(strip_tracking("not a url?utm_source=x", patterns), "not a url?utm_source=x");
  assert.equal(strip_tracking("https://", patterns), "https://");
});

test("an empty list turns the stripping off", () => {
  assert.equal(strip_tracking("https://a.com/p?utm_source=x", []), "https://a.com/p?utm_source=x");
});

test("the shipped list drops the common trackers", () => {
  assert.equal(strip_tracking("https://a.com/p?gclid=1&msclkid=2&_hsenc=3&mkt_tok=4&id=5", DEFAULT_STRIP_TRACKING_PARAMS), "https://a.com/p?id=5");
});
