import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { check_args } from "../src/shared/registry/check_args.ts";
import { parse_command_line } from "../src/shared/registry/command_line.ts";
import { bookmark_rows, link_sections, read_sections, recent_tab_rows, type PageReaders, type TabWithUse } from "../src/newtab/lists.ts";
import { draw_tile } from "../src/newtab/tile.ts";
import { parse_setting_text, SETTING_SPECS } from "../src/shared/settings_schema.ts";
import { effective_settings } from "../src/shared/config.ts";
import { build_schemas } from "../src/shared/config_build/schemas.ts";

const tab = (id: number, url: string, last: number, extra: Partial<TabWithUse> = {}): TabWithUse => ({ id, windowId: 1, index: id, url, title: `T${id}`, incognito: false, lastAccessed: last, ...extra });
const TABS = [tab(1, "https://a.example/", 10), tab(2, "https://b.example/", 30), tab(3, "https://c.example/", 20), tab(4, "https://p.example/", 99, { incognito: true }), tab(5, "about:newtab", 50)];
const TREE = [{ type: "folder", children: [{ type: "bookmark", title: "Old", url: "https://old.example/", dateAdded: 1 }, { type: "bookmark", title: "New", url: "https://new.example/", dateAdded: 9 }, { type: "bookmark", title: "Js", url: "javascript:1", dateAdded: 20 }, { type: "bookmark", title: "Mid", url: "https://mid.example/", dateAdded: 5 }] }];

const readers = (over: Partial<PageReaders> = {}): PageReaders => ({ query_tabs: async () => TABS, bookmark_tree: async () => TREE, page_is_private: async () => false, cached_icons: async () => new Map(), ...over });

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
  const counting = readers({ query_tabs: async () => (reads++, TABS), bookmark_tree: async () => (reads++, TREE) });
  assert.deepEqual(await read_sections(effective_settings({}), counting), []);
  assert.deepEqual(await read_sections(effective_settings({ newtab_bookmarks: false, newtab_recent_tabs: false }), counting), []);
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
  assert.equal(SETTING_SPECS.newtab_links.settable, true, "the settings page saves it");
  // Typed text is never a list of tables, so `:set newtab_links` refuses it as `:set site_rules` does.
  for (const name of ["newtab_links", "site_rules"] as const) assert.deepEqual(parse_setting_text(name, "https://a.example/"), { error: `${name}: expected ${SETTING_SPECS[name].expectation}` });
});

test("a typed :set newtab_links is refused by the command's argument check, as :set site_rules is", () => {
  for (const name of ["newtab_links", "site_rules"]) {
    for (const text of [`set ${name} https://a.example/`, `set ${name} [{"label":"A","url":"https://a.example/"}]`]) {
      const parsed = parse_command_line(registry, text);
      assert.equal(parsed.kind, "invocation", text);
      const checked = check_args(registry.get("settings.set")!, parsed.kind === "invocation" ? parsed.invocation.args : undefined);
      assert.equal(checked.ok, false, text);
      assert.match(checked.ok ? "" : checked.error, new RegExp(name));
    }
  }
});

test("the editor schema describes the new settings", () => {
  const properties = (build_schemas([]).settings as { properties: Record<string, { default?: unknown }> }).properties;
  for (const name of ["newtab_bookmarks", "newtab_recent_tabs", "newtab_bookmarks_max", "newtab_recent_tabs_max", "newtab_links"]) assert.ok(name in properties, name);
  assert.equal(properties.newtab_bookmarks?.default, false);
  assert.equal(properties.newtab_recent_tabs_max?.default, 8);
});

const DOT = "data:image/png;base64,AAAA";

test("recent tabs take the cached icon for their site and ignore the tab's own favIconUrl", () => {
  const tabs = [tab(1, "https://a.example/x", 30, { favIconUrl: "https://a.example/i.png" }), tab(2, "https://b.example/", 20, { favIconUrl: DOT }), tab(3, "https://c.example/", 10)];
  const rows = recent_tab_rows(tabs, 8, false, new Map([["b.example", DOT]]));
  assert.deepEqual(rows.map((row) => [row.host, row.icon_url]), [["a.example", undefined], ["b.example", DOT], ["c.example", undefined]]);
  assert.ok(!("icon_url" in rows[0]!), "no icon key at all for a letter tile");
});

test("no http(s) address reaches an img src on the page, whatever a tab or the cache holds", () => {
  const made: { tag: string; src?: string }[] = [];
  const fake = (tag: string) => {
    const node = { tag, className: "", textContent: "", append() {}, addEventListener() {}, replaceWith() {}, set src(value: string) { (node as { src_value?: string }).src_value = value; made.push({ tag, src: value }); } };
    return node;
  };
  const real_document = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { createElement: fake };
  try {
    const tabs = [tab(1, "https://a.example/", 3, { favIconUrl: "https://a.example/i.png" }), tab(2, "https://b.example/", 2, { favIconUrl: "http://b.example/i.ico" })];
    // A poisoned cache entry shows the guard in the tile as well as the filter that reads the cache.
    const rows = [...recent_tab_rows(tabs, 8, false, new Map([["b.example", DOT]])), { label: "x", url: "https://x.example/", host: "x.example", icon_url: "https://x.example/i.png" }];
    for (const row of rows) draw_tile(row);
    assert.ok(made.every((entry) => !/^https?:/i.test(entry.src ?? "")), JSON.stringify(made));
    assert.deepEqual(made.map((entry) => entry.src), [DOT]);
  } finally {
    (globalThis as { document?: unknown }).document = real_document;
  }
});

test("bookmarks and links take the cached icon of their site and show the host without www", () => {
  const cached = new Map([["new.example", DOT]]);
  const [first] = bookmark_rows(TREE, 1, cached);
  assert.deepEqual([first!.host, first!.icon_url], ["new.example", DOT]);
  const [section] = link_sections([{ label: "W", url: "https://www.new.example/p" }], cached);
  assert.deepEqual([section!.rows[0]!.host, section!.rows[0]!.icon_url], ["new.example", DOT]);
});

test("private tabs stay out of the rows even when the cache knows the site", () => {
  const rows = recent_tab_rows(TABS, 8, false, new Map([["p.example", DOT]]));
  assert.ok(!rows.some((row) => row.host === "p.example"));
});

test("a cache that fails to read leaves the cards with letter tiles", async () => {
  const sections = await read_sections(effective_settings({ newtab_bookmarks: true }), readers({ cached_icons: () => Promise.reject(new Error("no")) }));
  assert.equal(sections[0]!.rows[0]!.icon_url, undefined);
});
