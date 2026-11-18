import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";
import { page_keymap_for } from "../src/background/page_keymap.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch, TreeLeaf } from "../src/shared/prefix_tree.ts";

const compiled = (settings: Record<string, unknown> = {}) =>
  compile_config({ config: { ...empty_config(), settings: settings as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
const ask = async (keymap: CompiledKeymap, url: string) => (await page_keymap_for({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: keymap }) } as never, [url]))!;
const step_of = (reply: Awaited<ReturnType<typeof ask>>, key: string) => ((reply.keymap.modes.normal as TreeBranch).children[key] as TreeLeaf).steps[0]!.invocation;

test("the setting is off by default, so j and k stay the plain scroll on every page", async () => {
  const result = compiled();
  assert.deepEqual(result.warnings, []);
  assert.equal(step_of(await ask(result.compiled, "https://a.test/"), "j").id, "scroll.lines");
  assert.equal(step_of(await ask(result.compiled, "https://a.test/"), "k").id, "scroll.lines");
});

test("with item_finder on, j and k walk the finder's items on a page with no row", async () => {
  const result = compiled({ item_finder: true });
  assert.deepEqual(result.warnings, []);
  const reply = await ask(result.compiled, "https://a.test/");
  for (const [key, direction] of [["j", "down"], ["k", "up"]] as const) {
    const invocation = step_of(reply, key);
    assert.deepEqual([invocation.id, invocation.args?.["direction"], invocation.args?.["selector"]], ["page.item", direction, ""]);
  }
});

test("a shipped row that binds j and k decides them before the finder, and a user row wins over both", async () => {
  const reply = await ask(compiled({ item_finder: true }).compiled, "https://duckduckgo.com/?q=x");
  assert.equal(step_of(reply, "j").args!["selector"], 'article[data-testid="result"]');
  const mine = { site: "https://a.test/*", bind: { j: { id: "tab.next" } } };
  assert.equal(step_of(await ask(compiled({ item_finder: true, site_rules: [mine] }).compiled, "https://a.test/"), "j").id, "tab.next");
});

test("a shipped grid row keeps h, j, k and l on its pages, ahead of the finder", async () => {
  const reply = await ask(compiled({ item_finder: true }).compiled, "https://www.amazon.com/s?k=keyboard");
  for (const key of ["h", "j", "k", "l"]) assert.notEqual(step_of(reply, key).args!["selector"], "", key);
});

test("turning a shipped row off hands its site to the finder", async () => {
  const reply = await ask(compiled({ item_finder: true, default_site_rows_off: ["ddg"] }).compiled, "https://duckduckgo.com/?q=x");
  assert.equal(step_of(reply, "j").args!["selector"], "");
});

test("the finder binds h and l too, for a grid, and leaves G to its key", async () => {
  const reply = await ask(compiled({ item_finder: true }).compiled, "https://a.test/");
  for (const [key, direction] of [["h", "left"], ["l", "right"]] as const) {
    const invocation = step_of(reply, key);
    assert.deepEqual([invocation.id, invocation.args?.["direction"], invocation.args?.["selector"]], ["page.item", direction, ""]);
  }
  assert.notEqual(step_of(reply, "G").id, "page.item");
});

const plain_h = (reply: Awaited<ReturnType<typeof ask>>) => step_of(reply, "h").id;
const is_finder_step = (invocation: ReturnType<typeof step_of>) => invocation.id === "page.item" && invocation.args?.["selector"] === "";
const claims_j_or_k = (row: (typeof DEFAULT_SITE_ROWS)[number]["row"]) => row.bind?.["j"] !== undefined || row.bind?.["k"] !== undefined || /(^|\s)[jk](\s|$)/.test(row.pass ?? "");

test("no shipped row that binds or passes j or k leaves h or l to the finder", async () => {
  const { compiled: keymap } = compiled({ item_finder: true });
  const rows = DEFAULT_SITE_ROWS.filter(({ row }) => claims_j_or_k(row));
  assert.ok(rows.length > 20);
  for (const { name, row } of rows) {
    const reply = await ask(keymap, row.site.replaceAll("*", "x"));
    for (const key of ["h", "l"]) assert.equal(is_finder_step(step_of(reply, key)), false, `${name} ${row.site} ${key}`);
  }
});

test("kagi passes j and k and keeps the plain h and l, and brave binds only j and k", async () => {
  const { compiled: keymap } = compiled({ item_finder: true });
  for (const url of ["https://kagi.com/search?q=x", "https://search.brave.com/search?q=x"]) {
    const reply = await ask(keymap, url);
    assert.deepEqual([step_of(reply, "h").id, step_of(reply, "l").id], ["scroll.pixels", "scroll.pixels"], url);
  }
  assert.equal(step_of(await ask(keymap, "https://search.brave.com/search?q=x"), "j").id, "page.send_key");
});

test("a user row that binds only k keeps the plain j, h and l on its pages", async () => {
  const mine = { site: "https://a.test/*", bind: { k: { id: "tab.next" } } };
  const reply = await ask(compiled({ item_finder: true, site_rules: [mine] }).compiled, "https://a.test/");
  assert.equal(step_of(reply, "k").id, "tab.next");
  assert.deepEqual([step_of(reply, "j").id, step_of(reply, "h").id, step_of(reply, "l").id], ["scroll.lines", "scroll.pixels", "scroll.pixels"]);
});

test("a row that binds h itself keeps it, and the hold-back leaves h alone", async () => {
  const mine = { site: "https://a.test/*", bind: { j: { id: "tab.next" }, h: { id: "tab.prev" } } };
  const result = compiled({ item_finder: true, site_rules: [mine] });
  const reply = await ask(result.compiled, "https://a.test/");
  assert.equal(plain_h(reply), "tab.prev");
  assert.equal(step_of(reply, "l").id, "scroll.pixels");
});

test("a user remap of h shows on a row page and wins over the default h", async () => {
  const config = { ...empty_config(), settings: { item_finder: true } as never, keymap: { normal: { h: { id: "tab.prev" } } } };
  const result = compile_config({ config, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
  const reply = await ask(result.compiled, "https://kagi.com/search?q=x");
  assert.equal(plain_h(reply), "tab.prev");
  assert.equal(step_of(reply, "l").id, "scroll.pixels");
});

test("j and k moved to other keys leave the row's own j and k, and h stays plain", async () => {
  const config = { ...empty_config(), settings: { item_finder: true } as never, keymap: { normal: { j: null, k: null, J: { id: "scroll.lines", args: { count: 3 } } } } };
  const result = compile_config({ config, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
  assert.equal(step_of(await ask(result.compiled, "https://search.brave.com/search?q=x"), "j").id, "page.send_key");
  assert.equal(step_of(await ask(result.compiled, "https://search.brave.com/search?q=x"), "h").id, "scroll.pixels");
});

test("with the setting off no hold-back row is compiled, and with it on each site pattern gets one", () => {
  const off = compiled().compiled.site_rules!;
  const on = compiled({ item_finder: true }).compiled.site_rules!;
  assert.deepEqual(off.filter((rule) => (rule as { name?: string }).name === "item_finder"), []);
  // A row that binds h and l itself needs no hold.
  const held = new Set(DEFAULT_SITE_ROWS.filter(({ row }) => claims_j_or_k(row) && !(row.bind?.["h"] && row.bind["l"])).map(({ row }) => row.site));
  assert.equal(on.length - off.length, held.size + 1);
});

test("two rows at one site share one hold-back row", () => {
  const rows = [{ site: "https://a.test/*", bind: { j: { id: "tab.next" } } }, { site: "https://a.test/*", pass: "k" }];
  const holds = compiled({ item_finder: true, site_rules: rows }).compiled.site_rules!.filter((rule) => (rule as { name?: string }).name === "item_finder" && rule.site === "https://a.test/*");
  assert.equal(holds.length, 1);
});

const with_keymap = (normal: Record<string, unknown>) => compile_config({ config: { ...empty_config(), settings: { item_finder: true } as never, keymap: { normal } as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
const warnings_with_finder_off = (normal: Record<string, unknown>) => compile_config({ config: { ...empty_config(), keymap: { normal } as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} }).warnings;

test("a key the user unbound is not held, so the finder keeps it on a row page", async () => {
  const reply = await ask(with_keymap({ h: null }).compiled, "https://kagi.com/search?q=x");
  assert.equal(is_finder_step(step_of(reply, "h")), true);
  assert.equal(step_of(reply, "l").id, "scroll.pixels");
});

test("an h that waits for a key or has bad args adds no warning to the shipped rows", async () => {
  for (const entry of [{ id: "mark.jump" }, { id: "scroll.pixels", args: { dx: "far" } }, { id: "tab.prev", prompt: { param: "x" } }, [{ id: "tab.prev" }, { id: "tab.next" }]]) {
    const result = with_keymap({ h: entry });
    assert.ok(result.warnings.length <= warnings_with_finder_off({ h: entry }).length, JSON.stringify(entry));
    assert.equal(is_finder_step(step_of(await ask(result.compiled, "https://kagi.com/search?q=x"), "h")), true, JSON.stringify(entry));
  }
});
