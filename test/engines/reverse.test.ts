import assert from "node:assert/strict";
import { test } from "node:test";
import type { SearchEngine } from "../../src/shared/config.ts";
import { engine_of_page, read_query, reverse_problem } from "../../src/shared/engines/reverse.ts";

const engine = (url: string, extra: Partial<SearchEngine> = {}): SearchEngine => ({ url, label: "x", ...extra });

test("a query pair is read back, with plus and percent twenty as a space", () => {
  const google = engine("https://www.google.com/search?q={query}");
  assert.equal(read_query(google, "https://www.google.com/search?q=rust+lang"), "rust lang");
  assert.equal(read_query(google, "https://www.google.com/search?q=rust%20lang%26go%2Bx"), "rust lang&go+x");
  assert.equal(read_query(google, "https://www.google.com/search?hl=en&q=a&sca_esv=1"), "a");
});

test("the shipped %s spelling reads like {query}", () => {
  assert.equal(read_query(engine("https://duckduckgo.com/?q=%s"), "https://duckduckgo.com/?q=a+b"), "a b");
});

test("a path segment is read back, and a tail after it is allowed", () => {
  const maps = engine("https://www.google.com/maps/search/{query}");
  assert.equal(read_query(maps, "https://www.google.com/maps/search/coffee%20shop"), "coffee shop");
  assert.equal(read_query(maps, "https://www.google.com/maps/search/coffee/@1,2,3z"), "coffee");
  assert.equal(read_query(maps, "https://www.google.com/maps/place/coffee"), undefined);
});

test("another host, another path, a missing param, an empty query or a bad page give nothing", () => {
  const google = engine("https://www.google.com/search?q={query}");
  assert.equal(read_query(google, "https://example.com/search?q=a"), undefined);
  assert.equal(read_query(google, "https://www.google.com/other?q=a"), undefined);
  assert.equal(read_query(google, "https://www.google.com/search?x=a"), undefined);
  assert.equal(read_query(google, "https://www.google.com/search?q="), undefined);
  assert.equal(read_query(google, "https://www.google.com/search?q=%E0%A4%A"), undefined);
  assert.equal(read_query(google, "not a url"), undefined);
});

test("{query|url} and {query:raw} read nothing", () => {
  assert.equal(read_query(engine("https://archive.example/web/{query|url}"), "https://archive.example/web/a"), undefined);
  assert.equal(read_query(engine("https://archive.example/web/{query:raw}"), "https://archive.example/web/a"), undefined);
});

test("a fixed query pair of the template must be on the page", () => {
  const issues = engine("https://github.com/search?q={query}&type=issues");
  assert.equal(read_query(issues, "https://github.com/search?q=a&type=issues"), "a");
  assert.equal(read_query(issues, "https://github.com/search?q=a&type=code"), undefined);
});

test("a template that repeats a fixed query name reads its own page", () => {
  const commons = engine("https://commons.example/w/index.php?search_fields=title&search_fields=tags&search={query}");
  assert.equal(read_query(commons, "https://commons.example/w/index.php?search_fields=title&search_fields=tags&search=cat"), "cat");
  assert.equal(read_query(commons, "https://commons.example/w/index.php?search_fields=title&search=cat"), undefined);
});

test("a page slot in the template reads as any text, and a scope before the query is dropped", () => {
  const repo = engine("https://github.com/search?q=repo:{repo} {query}&type=code");
  assert.equal(read_query(repo, "https://github.com/search?q=repo:foo%2Fbar%20the%20thing&type=code"), "the thing");
});

test("the engine with the longest fixed template start owns the page, then more fixed pairs, then the name", () => {
  const engines = {
    web: engine("https://example.com/?q={query}"),
    ia: engine("https://example.com/?q={query}&ia=web"),
    a_first: engine("https://example.com/?q={query}"),
    deep: engine("https://example.com/?q={query}&ia=web&kl=us"),
  };
  assert.deepEqual(engine_of_page(engines, "https://example.com/?q=x&ia=web"), { name: "ia", query: "x" });
  assert.deepEqual(engine_of_page(engines, "https://example.com/?q=x&ia=web&kl=us"), { name: "deep", query: "x" });
  assert.deepEqual(engine_of_page(engines, "https://example.com/?q=x"), { name: "a_first", query: "x" });
  assert.equal(engine_of_page(engines, "https://other.example/?q=x"), undefined);
});

test("a longer literal start beats a shorter one", () => {
  const engines = { all: engine("https://example.com/s?q={query}"), books: engine("https://example.com/s?kind=book&q={query}") };
  assert.equal(engine_of_page(engines, "https://example.com/s?kind=book&q=x")?.name, "books");
  assert.equal(engine_of_page(engines, "https://example.com/s?q=x")?.name, "all");
});

test("the built-in site engine never owns a page", () => {
  const engines = { duck: engine("https://duckduckgo.com/?q={query}"), site: engine("https://duckduckgo.com/?q=site:{host}+{query}", { slots: ["host"] }) };
  assert.equal(engine_of_page(engines, "https://duckduckgo.com/?q=site:a.com+b")?.name, "duck");
});

test("a reverse regex replaces the template reader and is matched against the whole address", () => {
  const wiki = engine("https://wiki.example/search/{query}/results", { reverse: "https://wiki\\.example/find/([^/]+)" });
  assert.equal(read_query(wiki, "https://wiki.example/find/a%20b"), "a b");
  assert.equal(read_query(wiki, "https://wiki.example/search/a/results"), undefined);
  assert.equal(read_query(wiki, "https://wiki.example/find/a/b"), undefined);
});

test("a reverse that cannot be used is refused", () => {
  assert.match(reverse_problem("")!, /1 to 200/);
  assert.match(reverse_problem("a".repeat(201))!, /1 to 200/);
  assert.match(reverse_problem("(unclosed")!, /valid/);
  assert.match(reverse_problem("a")!, /one capture group/);
  assert.match(reverse_problem("(a)(b)")!, /one capture group/);
  assert.match(reverse_problem("(a+)+b(c)")!, /quantifier on a group/);
  assert.match(reverse_problem("(?:a|aa)+(x)")!, /quantifier on a group/);
  assert.match(reverse_problem("(?:a)?(x)")!, /quantifier on a group/);
  assert.match(reverse_problem("|(a)\\")!, /valid/);
  assert.equal(reverse_problem("a\\)+([^)]+)"), undefined);
  assert.equal(reverse_problem("https://x\\.example/([^/]+)"), undefined);
});
