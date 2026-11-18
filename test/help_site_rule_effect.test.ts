import assert from "node:assert/strict";
import { test } from "node:test";
import type { SiteRuleRow } from "../src/shared/match_pattern.ts";
import { site_rule_effect, site_rule_effects } from "../src/help/site_rule_effect.ts";

test("a rule that passes keys names how many and which", () => {
  assert.equal(site_rule_effect({ site: "*://a.test/*", pass: "j k l" }), "Pass 3 keys: j k l");
  assert.equal(site_rule_effect({ site: "*://a.test/*", pass: "j" }), "Pass 1 key: j");
});

test("a long pass list is cut after six keys", () => {
  assert.equal(site_rule_effect({ site: "*://a.test/*", pass: "a b c d e f g h" }), "Pass 8 keys: a b c d e f ...");
});

test("only counts the keys that stay on", () => {
  assert.equal(site_rule_effect({ site: "*://a.test/*", only: "j k" }), "Only 2 keys");
});

test("a rule with nothing but a site, or off, turns keys off", () => {
  assert.equal(site_rule_effect({ site: "*://a.test/*" }), "Off");
  assert.equal(site_rule_effect({ site: "*://a.test/*", off: true }), "Off");
  assert.equal(site_rule_effect({ site: "*://a.test/*", off: false }), "Keys stay on");
});

test("binds, modes and per-site settings each add a phrase", () => {
  const row: SiteRuleRow = { site: "*://a.test/*", bind: { h: "tab.prev" }, keymap: { visual: { y: "copy" } }, modes: { m: { label: "M", bind: { x: "tab.next" } } }, zoom: 1.25, media_quality: 720, hint_add: [".a", ".b"] };
  assert.deepEqual(site_rule_effects(row), ["2 binds", "1 site mode", "Sets zoom to 1.25", "Sets media quality to 720", "Sets hint add to .a, .b"]);
});
