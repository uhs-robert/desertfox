import assert from "node:assert/strict";
import { test } from "node:test";
import { format_page_link } from "../../src/content/handlers/copy.ts";
import type { PageLinkFacts } from "../../src/content/handlers/copy.ts";

const facts: PageLinkFacts = {
  url: "https://a.com/p?x=(1)",
  title: "A [draft] page",
  canonical_url: "https://a.com/p",
  short_url: "https://a.co/1",
};

test("each format builds its string", () => {
  assert.equal(format_page_link("plain", facts), "https://a.com/p?x=(1)");
  assert.equal(format_page_link("canonical", facts), "https://a.com/p");
  assert.equal(format_page_link("short", facts), "https://a.co/1");
  assert.equal(format_page_link("title", facts), "A [draft] page");
  assert.equal(format_page_link("markdown", facts), "[A (draft) page](https://a.com/p?x=(1%29)");
  assert.equal(format_page_link("org", facts), "[[https://a.com/p?x=(1)][A (draft) page]]");
});

test("a missing link falls back to the plain URL", () => {
  const bare = { ...facts, canonical_url: undefined, short_url: undefined };
  assert.equal(format_page_link("canonical", bare), facts.url);
  assert.equal(format_page_link("short", bare), facts.url);
});

test("org format percent-encodes a closing bracket in the URL", () => {
  assert.equal(format_page_link("org", { ...facts, url: "https://a.com/p?x=[1]" }), "[[https://a.com/p?x=[1%5D][A (draft) page]]");
});
