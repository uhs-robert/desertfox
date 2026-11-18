import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";
import { normal_tree_for, page_keymap_for, site_columns_for } from "../src/background/page_keymap.ts";
import { key_command_id_on_page } from "../src/background/open_help.ts";
import { HELD_KEYS } from "../src/background/item_finder_row.ts";
import { site_rules_view } from "../src/background/site_rules_view.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch, TreeLeaf } from "../src/shared/prefix_tree.ts";

const compiled = (settings: Record<string, unknown> = {}) =>
  compile_config({ config: { ...empty_config(), settings: settings as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
const ask = async (keymap: CompiledKeymap, url: string) => (await page_keymap_for({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: keymap }) } as never, [url]))!;
// A key of more than one character (gg) sits under its prefix branches.
const step_of = (reply: Awaited<ReturnType<typeof ask>>, key: string) => ([...key].reduce<TreeBranch | TreeLeaf>((node, char) => (node as TreeBranch).children[char]!, reply.keymap.modes.normal as TreeBranch) as TreeLeaf).steps[0]!.invocation;

test("the setting is off by default, so j and k stay the plain scroll on every page", async () => {
  const result = compiled();
  assert.deepEqual(result.warnings, []);
  assert.equal(step_of(await ask(result.compiled, "https://a.test/"), "j").id, "scroll.lines");
  assert.equal(step_of(await ask(result.compiled, "https://a.test/"), "k").id, "scroll.lines");
});

test("with item_navigator on, j and k walk the finder's items on a page with no row", async () => {
  const result = compiled({ item_navigator: true });
  assert.deepEqual(result.warnings, []);
  const reply = await ask(result.compiled, "https://a.test/");
  for (const [key, direction] of [["j", "down"], ["k", "up"]] as const) {
    const invocation = step_of(reply, key);
    assert.deepEqual([invocation.id, invocation.args?.["direction"], invocation.args?.["selector"]], ["page.item", direction, ""]);
  }
});

test("a shipped row that binds j and k decides them before the finder, and a user row wins over both", async () => {
  const reply = await ask(compiled({ item_navigator: true }).compiled, "https://duckduckgo.com/?q=x");
  assert.equal(step_of(reply, "j").args!["selector"], 'article[data-testid="result"]');
  const mine = { site: "https://a.test/*", bind: { j: { id: "tab.next" } } };
  assert.equal(step_of(await ask(compiled({ item_navigator: true, site_rules: [mine] }).compiled, "https://a.test/"), "j").id, "tab.next");
});

test("a shipped grid row keeps h, j, k and l on its pages, ahead of the finder", async () => {
  const reply = await ask(compiled({ item_navigator: true }).compiled, "https://www.amazon.com/s?k=keyboard");
  for (const key of ["h", "j", "k", "l"]) assert.notEqual(step_of(reply, key).args!["selector"], "", key);
});

test("turning a shipped row off hands its site to the finder", async () => {
  const reply = await ask(compiled({ item_navigator: true, default_site_rows_off: ["ddg"] }).compiled, "https://duckduckgo.com/?q=x");
  assert.equal(step_of(reply, "j").args!["selector"], "");
});

test("the finder binds h and l too, for a grid, and gg and G to the ends of the list", async () => {
  const reply = await ask(compiled({ item_navigator: true }).compiled, "https://a.test/");
  for (const [key, direction] of [["h", "left"], ["l", "right"]] as const) {
    const invocation = step_of(reply, key);
    assert.deepEqual([invocation.id, invocation.args?.["direction"], invocation.args?.["selector"]], ["page.item", direction, ""]);
  }
  for (const [key, direction] of [["gg", "first"], ["G", "last"]] as const) {
    const invocation = step_of(reply, key);
    assert.deepEqual([invocation.id, invocation.args?.["direction"], invocation.args?.["selector"]], ["page.item", direction, ""], key);
  }
});

test("with the setting off gg and G stay the plain scroll to the top and bottom", async () => {
  const reply = await ask(compiled().compiled, "https://a.test/");
  assert.deepEqual([step_of(reply, "gg").id, step_of(reply, "G").id], ["scroll.to", "scroll.to"]);
});

const plain_h = (reply: Awaited<ReturnType<typeof ask>>) => step_of(reply, "h").id;
const is_finder_step = (invocation: ReturnType<typeof step_of>) => invocation.id === "page.item" && invocation.args?.["selector"] === "";
const claims_j_or_k = (row: (typeof DEFAULT_SITE_ROWS)[number]["row"]) => row.bind?.["j"] !== undefined || row.bind?.["k"] !== undefined || /(^|\s)[jk](\s|$)/.test(row.pass ?? "");

test("no shipped row that binds or passes j or k leaves h, l, gg or G to the finder", async () => {
  const { compiled: keymap } = compiled({ item_navigator: true });
  const rows = DEFAULT_SITE_ROWS.filter(({ row }) => claims_j_or_k(row));
  assert.ok(rows.length > 20);
  for (const { name, row } of rows) {
    const reply = await ask(keymap, row.site.replaceAll("*", "x"));
    for (const key of ["h", "l", "gg", "G"]) assert.equal(is_finder_step(step_of(reply, key)), false, `${name} ${row.site} ${key}`);
  }
});

test("kagi passes j and k and keeps the plain h and l, and brave binds only j and k", async () => {
  const { compiled: keymap } = compiled({ item_navigator: true });
  for (const url of ["https://kagi.com/search?q=x", "https://search.brave.com/search?q=x"]) {
    const reply = await ask(keymap, url);
    assert.deepEqual([step_of(reply, "h").id, step_of(reply, "l").id], ["scroll.pixels", "scroll.pixels"], url);
  }
  assert.equal(step_of(await ask(keymap, "https://search.brave.com/search?q=x"), "j").id, "page.send_key");
});

test("kagi and brave keep the plain gg and G, and reddit keeps its own G and the plain gg", async () => {
  const { compiled: keymap } = compiled({ item_navigator: true });
  for (const url of ["https://kagi.com/search?q=x", "https://search.brave.com/search?q=x", "https://www.reddit.com/r/x/"]) {
    const reply = await ask(keymap, url);
    assert.equal(step_of(reply, "gg").id, "scroll.to", url);
    assert.equal(is_finder_step(step_of(reply, "G")), false, url);
  }
  assert.equal(step_of(await ask(keymap, "https://www.reddit.com/r/x/"), "G").id, "page.item");
  assert.equal(step_of(await ask(keymap, "https://kagi.com/search?q=x"), "G").id, "scroll.to");
});

test("a user remap of gg or G shows on a row page, and an unbound one is left to the finder", async () => {
  const kagi = "https://kagi.com/search?q=x";
  const remapped = with_keymap({ gg: { id: "tab.prev" }, G: [{ id: "tab.next" }, { id: "tab.prev" }] });
  const reply = await ask(remapped.compiled, kagi);
  assert.deepEqual([step_of(reply, "gg").id, step_of(reply, "G").id], ["tab.prev", "tab.next"]);
  assert.deepEqual(remapped.warnings, []);
  const unbound = await ask(with_keymap({ gg: null, G: null }).compiled, kagi);
  assert.deepEqual([is_finder_step(step_of(unbound, "gg")), is_finder_step(step_of(unbound, "G"))], [true, true]);
});

test("a user key that starts with g keeps working beside the finder's gg", async () => {
  const reply = await ask(with_keymap({ gx: { id: "tab.next" } }).compiled, "https://a.test/");
  const g = (reply.keymap.modes.normal as TreeBranch).children["g"] as TreeBranch;
  assert.equal(g.kind, "branch");
  assert.equal((g.children["x"] as TreeLeaf).steps[0]!.invocation.id, "tab.next");
  assert.equal(is_finder_step(((g.children["g"]) as TreeLeaf).steps[0]!.invocation), true);
});

test("a user row that binds only k keeps the plain j, h and l on its pages", async () => {
  const mine = { site: "https://a.test/*", bind: { k: { id: "tab.next" } } };
  const reply = await ask(compiled({ item_navigator: true, site_rules: [mine] }).compiled, "https://a.test/");
  assert.equal(step_of(reply, "k").id, "tab.next");
  assert.deepEqual([step_of(reply, "j").id, step_of(reply, "h").id, step_of(reply, "l").id], ["scroll.lines", "scroll.pixels", "scroll.pixels"]);
});

test("a row that binds h itself keeps it, and the hold-back leaves h alone", async () => {
  const mine = { site: "https://a.test/*", bind: { j: { id: "tab.next" }, h: { id: "tab.prev" } } };
  const result = compiled({ item_navigator: true, site_rules: [mine] });
  const reply = await ask(result.compiled, "https://a.test/");
  assert.equal(plain_h(reply), "tab.prev");
  assert.equal(step_of(reply, "l").id, "scroll.pixels");
});

test("a user remap of h shows on a row page and wins over the default h", async () => {
  const config = { ...empty_config(), settings: { item_navigator: true } as never, keymap: { normal: { h: { id: "tab.prev" } } } };
  const result = compile_config({ config, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
  const reply = await ask(result.compiled, "https://kagi.com/search?q=x");
  assert.equal(plain_h(reply), "tab.prev");
  assert.equal(step_of(reply, "l").id, "scroll.pixels");
});

test("j and k moved to other keys leave the row's own j and k, and h stays plain", async () => {
  const config = { ...empty_config(), settings: { item_navigator: true } as never, keymap: { normal: { j: null, k: null, J: { id: "scroll.lines", args: { count: 3 } } } } };
  const result = compile_config({ config, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
  assert.equal(step_of(await ask(result.compiled, "https://search.brave.com/search?q=x"), "j").id, "page.send_key");
  assert.equal(step_of(await ask(result.compiled, "https://search.brave.com/search?q=x"), "h").id, "scroll.pixels");
});

test("with the setting off no hold-back row is compiled, and with it on each site pattern gets one", () => {
  const off = compiled().compiled.site_rules!;
  const on = compiled({ item_navigator: true }).compiled.site_rules!;
  assert.deepEqual(off.filter((rule) => (rule as { name?: string }).name === "item_navigator"), []);
  // A row that binds every held key itself needs no hold.
  const held = new Set(DEFAULT_SITE_ROWS.filter(({ row }) => claims_j_or_k(row) && !HELD_KEYS.every((key) => row.bind?.[key])).map(({ row }) => row.site));
  assert.equal(on.length - off.length, held.size + 1);
});

test("two rows at one site share one hold-back row", () => {
  const rows = [{ site: "https://a.test/*", bind: { j: { id: "tab.next" } } }, { site: "https://a.test/*", pass: "k" }];
  const holds = compiled({ item_navigator: true, site_rules: rows }).compiled.site_rules!.filter((rule) => (rule as { name?: string }).name === "item_navigator" && rule.site === "https://a.test/*");
  assert.equal(holds.length, 1);
});

const with_keymap = (normal: Record<string, unknown>) => compile_config({ config: { ...empty_config(), settings: { item_navigator: true } as never, keymap: { normal } as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
const warnings_with_finder_off = (normal: Record<string, unknown>) => compile_config({ config: { ...empty_config(), keymap: { normal } as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} }).warnings;

test("a key the user unbound is not held, so the finder keeps it on a row page", async () => {
  const reply = await ask(with_keymap({ h: null }).compiled, "https://kagi.com/search?q=x");
  assert.equal(is_finder_step(step_of(reply, "h")), true);
  assert.equal(step_of(reply, "l").id, "scroll.pixels");
});

test("an h that waits for a key or has bad args adds no warning to the shipped rows", async () => {
  for (const entry of [{ id: "mark.jump" }, { id: "scroll.pixels", args: { dx: "far" } }, { id: "tab.prev", prompt: { param: "x" } }, { id: "no.such_command" }, [{ id: "tab.prev" }, { id: "mark.jump" }]]) {
    const result = with_keymap({ h: entry });
    assert.ok(result.warnings.length <= warnings_with_finder_off({ h: entry }).length, JSON.stringify(entry));
    assert.equal(is_finder_step(step_of(await ask(result.compiled, "https://kagi.com/search?q=x"), "h")), true, JSON.stringify(entry));
  }
});

test("an h bound to a list of plain steps is held on a row page", async () => {
  const reply = await ask(with_keymap({ h: [{ id: "tab.prev" }, { id: "tab.next" }] }).compiled, "https://kagi.com/search?q=x");
  assert.equal(step_of(reply, "h").id, "tab.prev");
});

// A site row's `item_navigator` value, per address.
const off_at_a = { site: "https://a.test/*", item_navigator: false };
const on_at_a = { site: "https://a.test/*", item_navigator: true };

test("a site row with item_navigator false keeps an unbound key, a prompt key and a capture key as the user set them", async () => {
  const keymap = { normal: { h: null, J: { id: "tab.prev", prompt: { param: "x" } }, l: { id: "mark.jump" } } } as never;
  const config = { ...empty_config(), settings: { item_navigator: true, site_rules: [off_at_a] } as never, keymap };
  const { compiled: stored } = compile_config({ config, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
  const root = (await ask(stored, "https://a.test/")).keymap.modes.normal as TreeBranch;
  assert.equal(root.children["h"], undefined);
  assert.equal(root.children["l"]?.kind, "branch");
  assert.equal(is_finder_step(step_of(await ask(stored, "https://a.test/"), "j")), false);
  assert.equal(is_finder_step(step_of(await ask(stored, "https://b.test/"), "j")), true);
  assert.equal(is_finder_step(step_of(await ask(stored, "https://b.test/"), "gg")), true);
  assert.equal(((await ask(stored, "https://b.test/")).keymap.modes.normal as TreeBranch).children["h"] !== undefined, true);
});

test("a site row with item_navigator false leaves gg and G the plain scroll while other sites keep the finder's", async () => {
  const stored = compiled({ item_navigator: true, site_rules: [off_at_a] }).compiled;
  const here = await ask(stored, "https://a.test/");
  assert.deepEqual([step_of(here, "gg").id, step_of(here, "G").id], ["scroll.to", "scroll.to"]);
  const elsewhere = await ask(stored, "https://b.test/");
  assert.deepEqual([step_of(elsewhere, "gg").args?.["direction"], step_of(elsewhere, "G").args?.["direction"]], ["first", "last"]);
});

test("item_navigator true on one site works with the global switch off, and no other site gets the finder", async () => {
  const result = compiled({ site_rules: [on_at_a] });
  assert.deepEqual(result.warnings, []);
  assert.equal(is_finder_step(step_of(await ask(result.compiled, "https://a.test/"), "j")), true);
  assert.equal(step_of(await ask(result.compiled, "https://b.test/"), "j").id, "scroll.lines");
  assert.equal(result.compiled.item_navigator, undefined);
});

test("a narrow true row ahead of a broad false row wins, and the first match decides", async () => {
  const narrow = { site: "https://www.a.test/feed*", item_navigator: true };
  const broad = { site: "https://*.a.test/*", item_navigator: false };
  const ordered = compiled({ item_navigator: true, site_rules: [narrow, broad] }).compiled;
  assert.equal(is_finder_step(step_of(await ask(ordered, "https://www.a.test/feed/1"), "j")), true);
  assert.equal(is_finder_step(step_of(await ask(ordered, "https://www.a.test/other"), "j")), false);
  const reversed = compiled({ item_navigator: true, site_rules: [broad, narrow] }).compiled;
  assert.equal(is_finder_step(step_of(await ask(reversed, "https://www.a.test/feed/1"), "j")), false);
});

test("a subframe resolves against its own address and the tab's", async () => {
  const stored = compiled({ item_navigator: true, site_rules: [off_at_a] }).compiled;
  const reply = async (addresses: string[]) => step_of((await page_keymap_for({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: stored }) } as never, addresses))!, "j");
  assert.equal(is_finder_step(await reply(["https://a.test/frame", "https://c.test/"])), false);
  assert.equal(is_finder_step(await reply(["https://c.test/frame", "https://a.test/"])), false);
  assert.equal(is_finder_step(await reply(["https://c.test/frame", "https://d.test/"])), true);
});

test("a compiled keymap with no global value reads as off, and the finder shows only where a site row says true", async () => {
  const { item_navigator: _, ...bare } = compiled({ item_navigator: true }).compiled;
  assert.equal(is_finder_step(step_of(await ask(bare as CompiledKeymap, "https://a.test/"), "j")), false);
  const with_row = { ...compiled({ item_navigator: true, site_rules: [on_at_a] }).compiled } as Partial<CompiledKeymap>;
  delete with_row.item_navigator;
  assert.equal(is_finder_step(step_of(await ask(with_row as CompiledKeymap, "https://a.test/"), "j")), true);
});

test("which-key, the site rules view and help agree with the page on a site where the finder is off", async () => {
  const stored = compiled({ item_navigator: true, site_rules: [off_at_a] }).compiled;
  const address = "https://a.test/";
  const page_tree = (await ask(stored, address)).keymap.modes.normal;
  const columns = site_columns_for(stored, [address]);
  assert.deepEqual(normal_tree_for(stored.modes.normal, columns).tree, stored.modes.normal);
  assert.equal(page_tree, stored.modes.normal);
  assert.equal(site_rules_view(stored, address).rows.some((row) => row.origin === "default" && row.name === "item_navigator"), false);
  assert.equal(key_command_id_on_page(stored, address, "j").id, "scroll.lines");
  assert.equal(key_command_id_on_page(stored, "https://b.test/", "j").id, "page.item");
});

test("toggling item_navigator flips the global value only", () => {
  assert.deepEqual(DEFAULT_KEYMAP.normal?.[",j"], { id: "settings.toggle", args: { name: "item_navigator" }, label: "Toggle the item navigator" });
  assert.equal(compiled({ item_navigator: true, site_rules: [off_at_a] }).compiled.item_navigator, true);
  assert.equal(compiled({ item_navigator: false, site_rules: [off_at_a] }).compiled.item_navigator, undefined);
});

// Everything the page and the views show for a row page, so a leftover finder row anywhere differs.
const row_page = async (settings: Record<string, unknown>, url: string) => {
  const stored = compiled({ ...settings, site_rules: [{ site: "https://kagi.com/*", bind: { hx: { id: "tab.next" } } }, ...((settings["site_rules"] as unknown[]) ?? [])] }).compiled;
  return { reply: await ask(stored, url), view: site_rules_view(stored, url).rows.filter(({ site }) => site !== "https://kagi.com/search*").map(({ origin, name, site }) => ({ origin, name, site })) };
};

test("a row page where the finder is off is the page compiled with no finder, with the finder switch on or off", async () => {
  const url = "https://kagi.com/search?q=x";
  const none = await row_page({}, url);
  assert.deepEqual(await row_page({ item_navigator: true, site_rules: [{ site: "https://kagi.com/search*", item_navigator: false }] }, url), none);
  assert.deepEqual(await row_page({ site_rules: [{ site: "https://a.test/*", item_navigator: true }] }, url), none);
});
