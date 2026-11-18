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
