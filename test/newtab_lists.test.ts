import assert from "node:assert/strict";
import { test } from "node:test";
import { bookmark_rows, link_sections, read_sections, recent_tab_rows, type PageReaders, type TabWithUse } from "../src/newtab/lists.ts";
import { SETTING_SPECS } from "../src/shared/settings_schema.ts";
import { effective_settings } from "../src/shared/config.ts";
import { build_schemas } from "../src/shared/config_build/schemas.ts";

const tab = (id: number, url: string, last: number, extra: Partial<TabWithUse> = {}): TabWithUse => ({ id, windowId: 1, index: id, url, title: `T${id}`, incognito: false, lastAccessed: last, ...extra });
const TABS = [tab(1, "https://a.example/", 10), tab(2, "https://b.example/", 30), tab(3, "https://c.example/", 20), tab(4, "https://p.example/", 99, { incognito: true }), tab(5, "about:newtab", 50)];
const TREE = [{ type: "folder", children: [{ type: "bookmark", title: "Old", url: "https://old.example/", dateAdded: 1 }, { type: "bookmark", title: "New", url: "https://new.example/", dateAdded: 9 }, { type: "bookmark", title: "Js", url: "javascript:1", dateAdded: 20 }, { type: "bookmark", title: "Mid", url: "https://mid.example/", dateAdded: 5 }] }];

const readers = (over: Partial<PageReaders> = {}): PageReaders => ({ query_tabs: async () => TABS, bookmark_tree: async () => TREE, page_is_private: async () => false, ...over });

test("recent tabs: last used first, private and non-web tabs left out", () => {
  assert.deepEqual(recent_tab_rows(TABS, 8, false).map((row) => row.url), ["https://b.example/", "https://c.example/", "https://a.example/"]);
});

test("recent tabs: the row cap holds, and a private page lists none", () => {
  assert.equal(recent_tab_rows(TABS, 2, false).length, 2);
  assert.deepEqual(recent_tab_rows(TABS, 8, true), []);
  assert.deepEqual(recent_tab_rows(TABS, 0, false), []);
});

test("bookmarks: newest added first, web addresses only, capped", () => {
  assert.deepEqual(bookmark_rows(TREE, 8).map((row) => row.label), ["New", "Mid", "Old"]);
  assert.deepEqual(bookmark_rows(TREE, 2).map((row) => row.label), ["New", "Mid"]);
});

test("lists are empty when the flags are off, and the readers never run", async () => {
  let reads = 0;
  const counting_ = readers({ query_tabs: async () => (reads++, TABS), bookmark_tree: async () => (reads++, TREE) });
  assert.deepEqual(await read_sections(effective_settings({}), counting_), []);
  assert.deepEqual(await read_sections(effective_settings({ newtab_bookmarks: false, newtab_recent_tabs: false }), counting_), []);
  assert.equal(reads, 0);
});

test("lists follow their flags and maxes", async () => {
  const sections = await read_sections(effective_settings({ newtab_bookmarks: true, newtab_bookmarks_max: 1, newtab_recent_tabs: true }), readers());
  assert.deepEqual(sections.map((section) => [section.title, section.rows.length]), [["Recent tabs", 3], ["Bookmarks", 1]]);
});

test("a failing reader leaves its list out", async () => {
  const sections = await read_sections(effective_settings({ newtab_bookmarks: true, newtab_recent_tabs: true }), readers({ query_tabs: async () => Promise.reject(new Error("no")) }));
  assert.deepEqual(sections.map((section) => section.title), ["Bookmarks"]);
});

test("links group by name in first-seen order, ungrouped links share one untitled list", () => {
  const sections = link_sections([{ label: "A", url: "https://a.example/", group: "Work" }, { label: "B", url: "https://b.example/" }, { label: "C", url: "https://c.example/", group: "Work" }]);
  assert.deepEqual(sections.map((section) => [section.title, section.rows.map((row) => row.label)]), [["Work", ["A", "C"]], ["", ["B"]]]);
});

test("newtab_links validates the scheme, the group and the fields", () => {
  const check = SETTING_SPECS.newtab_links.check;
  assert.equal(check([{ label: "A", url: "https://a.example/", group: "G" }, { label: "B", url: "http://b.example/" }]), true);
  assert.equal(check([]), true);
  for (const bad of [[{ label: "A", url: "javascript:alert(1)" }], [{ label: "A", url: "file:///etc/passwd" }], [{ label: "A", url: "https://a.example/", group: "" }], [{ label: "", url: "https://a.example/" }], [{ url: "https://a.example/" }], [{ label: "A", url: "https://a.example/", extra: 1 }], ["https://a.example/"], "x"]) assert.equal(check(bad), false, JSON.stringify(bad));
  assert.equal(SETTING_SPECS.newtab_links.settable, false, ":set refuses it");
});

test("the editor schema describes the new settings", () => {
  const properties = (build_schemas([]).settings as { properties: Record<string, { default?: unknown }> }).properties;
  for (const name of ["newtab_bookmarks", "newtab_recent_tabs", "newtab_bookmarks_max", "newtab_recent_tabs_max", "newtab_links"]) assert.ok(name in properties, name);
  assert.equal(properties.newtab_bookmarks?.default, false);
  assert.equal(properties.newtab_recent_tabs_max?.default, 8);
});
