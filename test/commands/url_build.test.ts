import assert from "node:assert/strict";
import { test } from "node:test";
import { engine_search_url, parent_url, root_url } from "../../src/commands/url_build.ts";

test("parent drops the last segment, the query and the fragment", () => {
  assert.equal(parent_url("https://a.com/x/y/z?q=1#h"), "https://a.com/x/y/");
  assert.equal(parent_url("https://a.com/x/y/"), "https://a.com/x/");
  assert.equal(parent_url("https://a.com/x"), "https://a.com/");
});

test("parent of a root with a query keeps the root, and of a bare root has none", () => {
  assert.equal(parent_url("https://a.com/?q=1"), "https://a.com/");
  assert.equal(parent_url("https://a.com/"), undefined);
  assert.equal(parent_url("about:blank"), undefined);
});

test("parent with levels stops at the root", () => {
  assert.equal(parent_url("https://a.com/x/y/z", 2), "https://a.com/x/");
  assert.equal(parent_url("https://a.com/x/y", 9), "https://a.com/");
});

test("root keeps the port and drops the path", () => {
  assert.equal(root_url("http://a.com:8080/x/y?z#w"), "http://a.com:8080/");
  assert.equal(root_url("file:///tmp/x"), undefined);
});

test("engine template encodes the query at every placeholder", () => {
  assert.equal(engine_search_url("https://e.com/?q=%s&r=%s", "a&b/c d"), "https://e.com/?q=a%26b%2Fc%20d&r=a%26b%2Fc%20d");
});
