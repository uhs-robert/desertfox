import assert from "node:assert/strict";
import { test } from "node:test";
import { matches_pattern } from "../src/shared/match_pattern.ts";

test("the host comes from the parsed URL, not from text before the first slash", () => {
  assert.ok(!matches_pattern("*://*.example.com/*", "https://evil.test?x=@a.example.com/"));
  assert.ok(!matches_pattern("https://app.example.com/*", "https://app.example.com@evil.test/"));
  assert.ok(!matches_pattern("https://app.example.com/*", "https://evil.test/app.example.com/"));
  assert.ok(matches_pattern("*://*.example.com/*", "https://user@a.example.com/"));
});

test("the path matches the pathname and query, not the fragment", () => {
  assert.ok(matches_pattern("https://a.test/board?x=1", "https://a.test/board?x=1#top"));
  assert.ok(!matches_pattern("https://a.test/board", "https://a.test/board?x=1"));
  assert.ok(matches_pattern("file:///home/*", "file:///home/me/page.html"));
});

test("text that is not a URL matches nothing", () => {
  assert.ok(!matches_pattern("https://a.test/*", "not a url"));
  assert.ok(!matches_pattern("bad pattern", "https://a.test/"));
});
