import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import { list_keys } from "../../src/background/list_keys.ts";
import { create_quickmark_store } from "../../src/background/quickmark_store.ts";
import type { QuickmarkArea } from "../../src/background/quickmark_store.ts";
import { QUICKMARK_PRIVATE_STORAGE_KEY, QUICKMARK_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { wire_private_cleanup } from "../../src/background/store_turns.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../../src/shared/prefix_tree.ts";
import type { TreeNode } from "../../src/shared/prefix_tree.ts";
import { MAX_QUICKMARK_URL_CHARS } from "../../src/shared/quickmark_names.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

function fake_area(delay = false) {
  const values = new Map<string, unknown>();
  // A slow read lets a second write start before the first one ends, which only a queue keeps in order.
  const tick = () => (delay ? new Promise((resolve) => setTimeout(resolve, 1)) : Promise.resolve());
  const area = {
    get: async (key: string) => (await tick(), Object.fromEntries([key].filter((name) => values.has(name)).map((name) => [name, structuredClone(values.get(name))]))),
    set: async (items: Record<string, unknown>) => (await tick(), void Object.entries(items).forEach(([key, value]) => values.set(key, structuredClone(value)))),
    remove: async (key: string) => void values.delete(key),
  } as unknown as QuickmarkArea;
  return { area, values };
}

function make(delay = false) {
  const local = fake_area(delay);
  const session = fake_area(delay);
  return { local, session, store: create_quickmark_store({ local: () => local.area, session: () => session.area }) };
}

const CONFIGURED = { g: "https://github.com", w: "https://wiki.test" };

test("a saved quickmark wins over the config table for the same key and leaves the others", async () => {
  const { store } = make();
  assert.deepEqual(await store.table(CONFIGURED, false), CONFIGURED);
  await store.add("g", "https://git.test", false);
  await store.add("x", "https://x.test", false);
  assert.deepEqual(await store.table(CONFIGURED, false), { g: "https://git.test", w: "https://wiki.test", x: "https://x.test" });
});

test("a private window saves apart from the normal ones, reads both, and a normal window never sees a private entry", async () => {
  const { store, local, session } = make();
  await store.add("a", "https://normal.test", false);
  await store.add("b", "https://private.test", true);
  await store.add("a", "https://private-a.test", true);
  assert.deepEqual(await store.table({}, true), { a: "https://private-a.test", b: "https://private.test" });
  assert.deepEqual(await store.table({}, false), { a: "https://normal.test" });
  assert.equal(local.values.has(QUICKMARK_PRIVATE_STORAGE_KEY), false);
  assert.equal(session.values.has(QUICKMARK_STORAGE_KEY), false);
});

test("two saves that race both land", async () => {
  const { store } = make(true);
  await Promise.all([store.add("a", "https://a.test", false), store.add("b", "https://b.test", false)]);
  assert.deepEqual(await store.table({}, false), { a: "https://a.test", b: "https://b.test" });
});

test("a damaged value reads as none, and a damaged entry is dropped", async () => {
  const { store, local } = make();
  local.values.set(QUICKMARK_STORAGE_KEY, "garbage");
  assert.deepEqual(await store.table(CONFIGURED, false), CONFIGURED);
  local.values.set(QUICKMARK_STORAGE_KEY, { a: "https://a.test", b: 5, "!": "https://bang.test", c: "" });
  assert.deepEqual(await store.table({}, false), { a: "https://a.test" });
});

test("a save refuses a key outside a-z, A-Z and 0-9, and a long address", async () => {
  const { store } = make();
  await assert.rejects(store.add("!", "https://a.test", false), /Quickmarks use/);
  await assert.rejects(store.add("ab", "https://a.test", false), /Quickmarks use/);
  await assert.rejects(store.add("a", `https://a.test/${"x".repeat(MAX_QUICKMARK_URL_CHARS)}`, false), /too long/);
  assert.deepEqual(await store.table({}, false), {});
});

test("the private entries go when the last private window closes", async () => {
  const { store, session } = make();
  await store.add("a", "https://a.test", true);
  let on_removed = () => {};
  let private_open = true;
  wire_private_cleanup([store], { onRemoved: { addListener: (listener) => void (on_removed = listener) }, getAll: async () => [{ incognito: private_open }] });
  await store.clear_private_without_window(async () => true);
  assert.equal(session.values.size, 1);
  private_open = false;
  on_removed();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(session.values.size, 0);
});

function normal_keymap() {
  const { compiled } = compile_config({ config: empty_config(), default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["site"], containers: [] } });
  return { get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: compiled }) } as never;
}

test("the default keys capture one key after go, gn and M, and ge and gE keep the address prompt", () => {
  const { compiled, warnings } = compile_config({ config: empty_config(), default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["site"], containers: [] } });
  assert.deepEqual(warnings, []);
  const normal = compiled.modes.normal!.children;
  assert.equal(normal["M"]?.kind, "branch");
  for (const key of ["g"]) assert.equal(normal[key]?.kind, "branch");
  const g = normal["g"]!;
  if (g.kind !== "branch") throw new Error("g is a branch");
  for (const key of ["go", "gn"]) assert.equal(g.children[key[1]!]?.kind, "branch", key);
  for (const key of ["e", "E"]) {
    const found: TreeNode | undefined = g.children[key];
    assert.equal(found?.kind, "leaf");
    if (found?.kind === "leaf") assert.equal(found.steps[0]?.invocation.id, "open.url");
  }
});

test("which-key lists the quickmarks under go and gn with their addresses, and keeps the <key> row with none", async () => {
  const table = async (): Promise<Record<string, string>> => ({ w: "https://wiki.test/a/very/long/path/that/goes/on/and/on/and/on", G: "https://github.com", 3: "http://x.test" });
  const rows = async (prefix: string[], quickmarks: () => Promise<Record<string, string>> = table) => (await list_keys(normal_keymap(), () => undefined, { mode: "normal", prefix }, { quickmarks })).rows;
  assert.deepEqual((await rows(["g", "o"])).map((row) => row.keys), ["G", "w", "3"]);
  assert.equal((await rows(["g", "n"]))[0]!.command, "github.com");
  assert.equal((await rows(["g", "o"]))[1]!.command, "wiki.test/a/very/long/path/that/goe…");
  assert.deepEqual((await rows(["M"])).map((row) => row.keys), ["G", "w", "3"]);
  assert.deepEqual((await rows(["g", "o"], async () => ({}))).map((row) => row.keys), ["<key>"]);
  assert.deepEqual((await rows(["g", "o"], async () => Promise.reject(new Error("x")))).map((row) => row.keys), ["<key>"]);
  assert.ok((await rows(["g"])).length > 3);
});

test("remove drops the saved entry, and the config entry of that key shows again", async () => {
  const { store } = make();
  await store.add("g", "https://git.test", false);
  await store.remove("g", false);
  assert.deepEqual(await store.table(CONFIGURED, false), CONFIGURED);
});

test("remove refuses a key with no saved entry, and a normal window leaves private entries alone", async () => {
  const { store } = make();
  await assert.rejects(store.remove("g", false), /Quickmark g is not saved/);
  await store.add("b", "https://private.test", true);
  await assert.rejects(store.remove("b", false), /Quickmark b is not saved/);
});

test("a private window deletes only private entries, and a normal entry refuses with where to delete it", async () => {
  const { store, local } = make();
  await store.add("a", "https://normal.test", false);
  await store.add("b", "https://private.test", true);
  assert.deepEqual(await store.saved(true), { b: "https://private.test" });
  assert.deepEqual(await store.saved(false), { a: "https://normal.test" });
  await assert.rejects(store.remove("a", true), /saved in a normal window, delete it there/);
  await store.remove("b", true);
  assert.deepEqual(await store.table({}, false), { a: "https://normal.test" });
  assert.deepEqual(local.values.get(QUICKMARK_STORAGE_KEY), { a: "https://normal.test" });
});
