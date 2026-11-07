import assert from "node:assert/strict";
import { test } from "node:test";
import { scroll_label, security_state, status_widgets, tabs_label, url_label } from "../../src/cmdline/status.ts";

test("security state follows the scheme", () => {
  assert.equal(security_state("https://example.org/a"), "ok");
  assert.equal(security_state("http://example.org/"), "warn");
  for (const address of ["about:blank", "file:///tmp/a.html", "moz-extension://abc/page.html", "not an address", ""]) {
    assert.equal(security_state(address), "neutral", address);
  }
});

test("the url label is host and path without query or fragment", () => {
  assert.equal(url_label("https://example.org/"), "example.org");
  assert.equal(url_label("https://example.org/a/b?q=1#top"), "example.org/a/b");
  assert.equal(url_label("about:blank"), "about:blank");
  assert.equal(url_label("not an address"), "not an address");
});

test("a long url label is cut to the limit with an ellipsis", () => {
  const label = url_label("https://example.org/" + "a".repeat(100));
  assert.equal(label.length, 30);
  assert.ok(label.endsWith("…"));
  assert.equal(url_label("https://example.org/abcdef", 26), "example.org/abcdef");
  assert.equal(url_label("https://example.org/abcdef", 17), "example.org/abcd…");
});

test("the scroll label names the top, the bottom, a percent or a page that fits", () => {
  assert.equal(scroll_label(0, 1000), "Top");
  assert.equal(scroll_label(-5, 1000), "Top");
  assert.equal(scroll_label(1000, 1000), "Bot");
  assert.equal(scroll_label(999, 1000), "Bot");
  assert.equal(scroll_label(500, 1000), "50%");
  assert.equal(scroll_label(333.4, 1000), "33%");
  assert.equal(scroll_label(10, 0), "All");
  assert.equal(scroll_label(0, -3), "All");
  assert.equal(scroll_label(0, 0.4), "All");
  assert.equal(scroll_label(Number.NaN, 1000), "Top");
  assert.equal(scroll_label(5, Number.NaN), "All");
});

test("the tabs label counts from one", () => {
  assert.equal(tabs_label(0, 1), "[1/1]");
  assert.equal(tabs_label(2, 12), "[3/12]");
});

test("status_widgets follows the setting's order and skips a name it does not know", () => {
  const status = { url: "http://example.org/a", tab_index: 0, tab_count: 3 };
  assert.deepEqual(
    status_widgets(["tabs", "url", "clock", "scroll"], status, { top: 0, max: 0 }),
    [
      { name: "tabs", text: "[1/3]" },
      { name: "url", text: "example.org/a", title: "http://example.org/a", state: "warn" },
      { name: "scroll", text: "All" },
    ],
  );
  assert.deepEqual(status_widgets([], status, null), []);
});
