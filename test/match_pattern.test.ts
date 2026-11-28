import assert from "node:assert/strict";
import { test } from "node:test";
import { about_pattern_of, hosts_disjoint, matches_about_pattern, match_regex_source, matches_pattern } from "../src/shared/match_pattern.ts";

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

test("an about: pattern names one page or a prefix, and there is no about:*", () => {
  const source = (pattern: string) => match_regex_source([pattern]);
  const covers = (pattern: string, address: string) => new RegExp(source(pattern) ?? "$^").test(address);
  assert.ok(covers("about:preferences", "about:preferences"));
  assert.ok(covers("about:preferences", "about:preferences#privacy"));
  assert.ok(!covers("about:preferences", "about:preferences?x=1"));
  assert.ok(!covers("about:preferences", "about:preferencesx"));
  assert.ok(covers("about:preferences*", "about:preferences?x=1"));
  assert.ok(covers("about:preferences*", "about:preferencesx"));
  assert.ok(!covers("about:preferences*", "about:config"));
  assert.ok(!covers("about:config", "https://a.test/about:config"));
  for (const bad of ["about:*", "about:", "about:Config", "about:a b", "about:a*b", "ABOUT:config"]) assert.equal(source(bad), undefined, bad);
  assert.deepEqual(about_pattern_of("about:config*"), { base: "about:config", prefix: true });
  assert.equal(about_pattern_of("*://a.test/*"), undefined);
  // The module's own check agrees with the regex.
  for (const [pattern, address] of [["about:config", "about:config#a"], ["about:config", "about:configx"], ["about:config*", "about:configx"], ["about:config*", "about:cons"]] as const) assert.equal(matches_about_pattern(pattern, address), covers(pattern, address), `${pattern} ${address}`);
});

test("an about: pattern is disjoint from a web pattern, and from another page unless a prefix reaches it", () => {
  assert.ok(hosts_disjoint("about:config", "*://a.test/*"));
  assert.ok(!hosts_disjoint("about:config", "<all_urls>"));
  assert.ok(hosts_disjoint("about:config", "about:support"));
  assert.ok(!hosts_disjoint("about:config", "about:config"));
  assert.ok(!hosts_disjoint("about:conf*", "about:config"));
  assert.ok(!hosts_disjoint("about:config", "about:conf*"));
  assert.ok(hosts_disjoint("about:config*", "about:support*"));
});
