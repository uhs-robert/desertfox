import assert from "node:assert/strict";
import { test } from "node:test";
import { engine_search_url, incremented_url, parent_url, root_url } from "../../src/commands/url_build.ts";

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

test("increment adds to and subtracts from the last number in the path", () => {
  assert.equal(incremented_url("https://a.com/page/2", "up", 1), "https://a.com/page/3");
  assert.equal(incremented_url("https://a.com/page/2", "down", 1), "https://a.com/page/1");
  assert.equal(incremented_url("https://a.com/a1/b22", "up", 5), "https://a.com/a1/b27");
});

test("increment keeps leading zeros and carries past them", () => {
  assert.equal(incremented_url("https://a.com/page007", "up", 1), "https://a.com/page008");
  assert.equal(incremented_url("https://a.com/p/099", "up", 1), "https://a.com/p/100");
  assert.equal(incremented_url("https://a.com/p/0100", "down", 1), "https://a.com/p/0099");
  assert.equal(incremented_url("https://a.com/p/99", "up", 1), "https://a.com/p/100");
});

test("increment refuses to go below 0", () => {
  assert.equal(incremented_url("https://a.com/p/3", "down", 3), "https://a.com/p/0");
  assert.throws(() => incremented_url("https://a.com/p/0", "down", 1), /below 0/);
  assert.throws(() => incremented_url("https://a.com/p/3", "down", 4), /below 0/);
});

test("increment refuses a run over 15 digits and accepts exactly 15", () => {
  assert.throws(() => incremented_url("https://a.com/id/1234567890123456", "up", 1), /more than 15 digits/);
  assert.equal(incremented_url("https://a.com/id/123456789012345", "up", 1), "https://a.com/id/123456789012346");
});

test("increment prefers the query number, and leaves the host and fragment alone", () => {
  assert.equal(incremented_url("https://a2.com/p/1?page=9#s3", "up", 1), "https://a2.com/p/1?page=10#s3");
  assert.equal(incremented_url("https://a.com:8080/p/1?q=x#s3", "up", 1), "https://a.com:8080/p/2?q=x#s3");
});

test("increment refuses an address with no number or no http page", () => {
  assert.throws(() => incremented_url("https://a2.com/about#3", "up", 1), /no number/);
  assert.throws(() => incremented_url("about:blank", "up", 1), /cannot change/);
});
