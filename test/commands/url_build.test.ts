import assert from "node:assert/strict";
import { test } from "node:test";
import {
  archive_url,
  engine_search_url,
  isdown_url,
  parent_url,
  repo_search_url,
  root_url,
  site_search_url,
  subreddit_of,
  subreddit_search_url,
  translate_url,
} from "../../src/commands/url_build.ts";

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

test("archive, isdown and translate build from the page", () => {
  assert.equal(archive_url("https://a.com/x"), "https://web.archive.org/web/https://a.com/x");
  assert.equal(isdown_url("https://sub.a.com:81/x"), "https://www.isitdownrightnow.com/sub.a.com.html");
  assert.equal(isdown_url("about:blank"), undefined);
  assert.equal(translate_url("https://a.com/x?y=1&z"), "https://translate.google.com/translate?sl=auto&tl=en&u=https%3A%2F%2Fa.com%2Fx%3Fy%3D1%26z");
});

test("site search puts the host in a site: filter", () => {
  assert.equal(site_search_url("https://a.com/x", "rust & go"), "https://www.google.com/search?q=site%3Aa.com%20rust%20%26%20go");
});

test("repo search reads owner and repo from the GitHub path", () => {
  assert.equal(
    repo_search_url("https://github.com/o/r/blob/main/x.ts", "a b"),
    "https://github.com/o/r/search?q=a%20b&type=code",
  );
  assert.equal(repo_search_url("https://github.com/o", "x"), undefined);
  assert.equal(repo_search_url("https://gitlab.com/o/r", "x"), undefined);
});

test("subreddit comes from /r/<name>, an explicit sub wins, and all is the fallback", () => {
  assert.equal(subreddit_of("https://www.reddit.com/r/rust/comments/1"), "rust");
  assert.equal(subreddit_of("https://www.reddit.com/user/x"), undefined);
  const search = (page: string, sub: string) => subreddit_search_url(page, "q 1", sub);
  assert.equal(search("https://www.reddit.com/r/rust/", "all"), "https://www.reddit.com/r/rust/search/?q=q%201&restrict_sr=1");
  assert.equal(search("https://www.reddit.com/r/rust/", "go"), "https://www.reddit.com/r/go/search/?q=q%201&restrict_sr=1");
  assert.equal(search("https://a.com/", "all"), "https://www.reddit.com/r/all/search/?q=q%201&restrict_sr=1");
});

test("engine template encodes the query at every placeholder", () => {
  assert.equal(engine_search_url("https://e.com/?q=%s&r=%s", "a&b/c d"), "https://e.com/?q=a%26b%2Fc%20d&r=a%26b%2Fc%20d");
});

test("archive and translate refuse non-http pages", () => {
  assert.equal(archive_url("about:preferences"), undefined);
  assert.equal(translate_url("about:preferences"), undefined);
  assert.equal(archive_url("https://a.com/x"), "https://web.archive.org/web/https://a.com/x");
});
