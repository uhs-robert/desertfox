import assert from "node:assert/strict";
import { test } from "node:test";
import { engine_search_url, incremented_url, openable_url, parent_url, root_url } from "../../src/commands/url_build.ts";

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

test("increment keeps an empty query or fragment delimiter", () => {
  assert.equal(incremented_url("https://a.com/p/1?", "up", 1), "https://a.com/p/2?");
  assert.equal(incremented_url("https://a.com/p/1#", "up", 1), "https://a.com/p/2#");
  assert.equal(incremented_url("https://a.com/p/1?#", "down", 1), "https://a.com/p/0?#");
});

test("increment skips digits inside percent escapes", () => {
  assert.throws(() => incremented_url("https://a.com/about%20us", "up", 1), /no number/);
  assert.equal(incremented_url("https://a.com/p/4?q=a%20b", "up", 1), "https://a.com/p/5?q=a%20b");
  assert.equal(incremented_url("https://a.com/p/4?q=a%2021", "up", 1), "https://a.com/p/4?q=a%2022");
});

test("increment refuses an amount or a result that needs more than 15 digits", () => {
  assert.throws(() => incremented_url("https://a.com/p/1", "up", 1e15), /amount/);
  assert.throws(() => incremented_url("https://a.com/p/999999999999999", "up", 1), /past 15 digits/);
  assert.equal(incremented_url("https://a.com/p/999999999999998", "up", 1), "https://a.com/p/999999999999999");
});

const OWN_PAGES = () => "moz-extension://0a1b2c3d-own/";

// Each row: the address, whether a request from an extension sender opens it, whether a request from a page does.
const OPENABLE_TABLE: [string, boolean, boolean][] = [
  ["https://example.org/", true, true],
  ["http://example.org/a?b#c", true, true],
  ["HTTPS://EXAMPLE.ORG/", true, true],
  ["  https://example.org/  ", true, true],
  ["ftp://ftp.example.org/f", true, true],
  ["mailto:a@b.example", true, true],
  ["MailTo:a@b.example", true, true],
  ["tel:+15551234", true, true],
  ["magnet:?xt=urn:btih:abc", true, true],
  ["about:blank", true, true],
  ["ABOUT:BLANK", true, true],
  ["about:blank#top", true, true],
  ["view-source:https://example.org/", true, true],
  ["VIEW-SOURCE:http://example.org/?q#h", true, true],
  // A tab or newline inside the scheme is dropped by the URL parser, as Firefox drops it, so it cannot hide a scheme.
  ["java\tscript:alert(1)", false, false],
  ["java\nscript:alert(1)", false, false],
  ["javascript:alert(1)", false, false],
  ["  JavaScript:alert(1)", false, false],
  ["data:text/html,hi", false, false],
  ["blob:https://example.org/1234", false, false],
  ["file:///etc/passwd", false, false],
  ["chrome://browser/content/browser.xhtml", false, false],
  ["resource://gre/modules/x.mjs", false, false],
  ["place:sort=8", false, false],
  ["about:config", false, false],
  ["about:newtab", false, false],
  ["about:blankx", false, false],
  ["sms:12345", false, false],
  ["ws://example.org/", false, false],
  ["ext+x:y", false, false],
  ["view-source:javascript:alert(1)", false, false],
  ["view-source:view-source:https://example.org/", false, false],
  ["view-source:file:///etc/passwd", false, false],
  ["view-source:about:config", false, false],
  ["view-source:", false, false],
  ["moz-extension://0a1b2c3d-own/home.html#grant", true, false],
  ["MOZ-EXTENSION://0A1B2C3D-OWN/help.html", true, false],
  ["moz-extension://ffff-other/home.html", false, false],
  ["moz-extension://0a1b2c3d-own.evil/home.html", false, false],
  ["moz-extension:0a1b2c3d-own/home.html", false, false],
  ["view-source:moz-extension://0a1b2c3d-own/home.html", false, false],
  ["", false, false],
  ["not a url", false, false],
];

test("openable_url holds the allow-list, and opens the extension's own pages for an extension sender only", () => {
  for (const [url, from_extension, from_page] of OPENABLE_TABLE) {
    assert.equal(openable_url(url, OWN_PAGES), from_extension, `extension sender: ${JSON.stringify(url)}`);
    assert.equal(openable_url(url, undefined), from_page, `page sender: ${JSON.stringify(url)}`);
  }
});

test("openable_url asks for the extension's base only for a moz-extension: address", () => {
  let asked = 0;
  const counting = () => (asked++, "moz-extension://0a1b2c3d-own/");
  for (const [url] of OPENABLE_TABLE) if (!/moz-extension/i.test(url)) openable_url(url, counting);
  assert.equal(asked, 0);
});
