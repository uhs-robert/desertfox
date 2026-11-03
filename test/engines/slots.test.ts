import assert from "node:assert/strict";
import { test } from "node:test";
import { SLOTS } from "../../src/shared/engines/slots.ts";

const read = (name: string, url: string, title?: string) => {
  const slot = SLOTS[name];
  assert.equal(slot?.kind, "page");
  return slot.kind === "page" ? slot.read(title === undefined ? { url } : { url, title }) : undefined;
};

test("repo reads owner/name on GitHub only", () => {
  assert.equal(read("repo", "https://github.com/o/r/issues"), "o/r");
  assert.equal(read("repo", "https://example.com/o/r"), undefined);
  assert.equal(read("repo", "https://github.com/o"), undefined);
  assert.equal(read("repo", "about:blank"), undefined);
});

test("subreddit reads the name under /r/", () => {
  assert.equal(read("subreddit", "https://old.reddit.com/r/rust/top"), "rust");
  assert.equal(read("subreddit", "https://www.reddit.com/user/x"), undefined);
  assert.equal(read("subreddit", "https://example.com/r/rust"), undefined);
});

test("url and host need a web page", () => {
  assert.equal(read("url", "https://a.com/x"), "https://a.com/x");
  assert.equal(read("host", "http://a.com:8080/x"), "a.com");
  assert.equal(read("url", "about:config"), undefined);
  assert.equal(read("host", "file:///tmp/x"), undefined);
});

test("title is the tab title when there is one", () => {
  assert.equal(read("title", "https://a.com", "Hi"), "Hi");
  assert.equal(read("title", "https://a.com", ""), undefined);
  assert.equal(read("title", "https://a.com"), undefined);
});

test("the query is an input slot", () => {
  assert.equal(SLOTS.query?.kind, "input");
});
