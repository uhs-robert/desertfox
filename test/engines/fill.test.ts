import assert from "node:assert/strict";
import { test } from "node:test";
import { fill_template, page_requirements } from "../../src/shared/engines/fill.ts";

const page = { url: "https://example.com/a b?x=1#frag", title: "T" };
const url_of = (template: string, input: Parameters<typeof fill_template>[1]) => {
  const filled = fill_template(template, input);
  assert.ok(filled.ok, JSON.stringify(filled));
  return filled.url;
};

test("a query in the path is encoded", () => {
  assert.equal(url_of("https://d.com/wiki/{query}", { query: "a/b c" }), "https://d.com/wiki/a%2Fb%20c");
});

test("a query value is encoded and a literal plus stays", () => {
  assert.equal(url_of("https://s.com/?x=a+{query}&y=1", { query: "c&d" }), "https://s.com/?x=a+c%26d&y=1");
});

test("scope and query share one q value and encode together", () => {
  assert.equal(url_of("https://g.com/s?q=repo:{repo} {query}", { query: "foo bar", page: { url: "https://github.com/o/r" } }), "https://g.com/s?q=repo:o%2Fr%20foo%20bar");
});

test("a fragment slot is encoded", () => {
  assert.equal(url_of("https://s.com/#q={query}", { query: "a#b" }), "https://s.com/#q=a%23b");
});

test("%s reads as the query slot", () => {
  assert.equal(url_of("https://duckduckgo.com/?q=%s", { query: "x y" }), "https://duckduckgo.com/?q=x%20y");
});

test("{url} is encoded and {url:raw} is not", () => {
  assert.equal(url_of("https://t.com/?u={url}", { page }), "https://t.com/?u=https%3A%2F%2Fexample.com%2Fa%20b%3Fx%3D1%23frag");
  assert.equal(url_of("https://web.archive.org/web/{url:raw}", { page: { url: "https://example.com/a?b=1" } }), "https://web.archive.org/web/https://example.com/a?b=1");
});

test("{query|url} takes the query when given, else the page address", () => {
  assert.equal(url_of("https://w/{query|url:raw}", { query: "typed.com", page }), "https://w/typed.com");
  assert.equal(url_of("https://w/{query|url:raw}", { query: "", page: { url: "https://p.com/" } }), "https://w/https://p.com/");
});

test("a slot that cannot fill gives its message", () => {
  const filled = fill_template("https://g.com/?q={repo} {query}", { query: "x", page: { url: "https://example.com/" } });
  assert.deepEqual(filled, { ok: false, message: "This page is not in a GitHub repository" });
  assert.deepEqual(fill_template("https://w/{query|url}", { query: "", page: { url: "about:blank" } }), { ok: false, message: "This address is not a web page" });
});

test("page requirements leave out expressions the query can fill", () => {
  assert.deepEqual(page_requirements("https://g/?q={repo} {query}&r={repo}&h={host}"), ["repo", "host"]);
  assert.deepEqual(page_requirements("https://w/{query|url}"), []);
  assert.deepEqual(page_requirements("https://w/{url|host}"), ["url|host"]);
});
