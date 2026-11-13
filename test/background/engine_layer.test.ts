import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { load_layers } from "../../src/background/edit_layers.ts";
import { create_engine_messages } from "../../src/background/engine_message.ts";
import { export_files } from "../../src/background/config_transfer.ts";
import { ENGINE_EDITS_STORAGE_KEY, LAYERED_CONFIG_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { load_effective_config } from "../../src/background/config_load.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap } from "../../src/shared/prefix_tree.ts";
import { readFileSync } from "node:fs";
import { install_fake_browser, type Files } from "./config_fake_browser.ts";

type Startup = typeof import("../../src/background/startup.ts");
const fresh_startup = async (tag: string) => (await import(`../../src/background/startup.ts?engines_${tag}`)) as Startup;

async function started(tag: string, files: Files = { "settings.toml": "" }) {
  const host = { files };
  const browser = install_fake_browser(host);
  const startup = await fresh_startup(tag);
  await startup.get_config();
  await startup.reload_config();
  const messages = create_engine_messages({
    read_engine_state: startup.read_engine_state,
    change_layers: startup.change_layers,
    read_starter: async () => readFileSync(new URL("../../examples/engines.toml", import.meta.url), "utf8"),
  });
  return { host, startup, messages, ...browser };
}

const wiki = { type: "change_engines", action: "set", name: "wiki", url: "https://w.test/?q={query}", keyword: "w", letter: "w" } as const;
const stored_keymap = (local: Record<string, unknown>) => local[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap;

test("an added engine is in the config and binds its key letter, and survives a reload, an import and a restart", async () => {
  const { startup, messages, local, host } = await started("add");
  const saved = await messages.change(wiki);
  assert.equal(saved.ok, true);
  assert.equal((await startup.get_config()).search_engines.wiki?.url, "https://w.test/?q={query}");
  assert.ok(stored_keymap(local).modes.normal?.children.s, "s is bound");
  assert.ok((await load_effective_config()).config.search_engines.wiki, "a page reads the engine");

  host.files = { "search_engines.toml": 'other = { url = "https://o.test/?q={query}" }\n' };
  await startup.reload_config();
  assert.ok((await startup.get_config()).search_engines.wiki);
  assert.ok((await startup.get_config()).search_engines.other);

  const restarted = await fresh_startup("add_restart");
  assert.ok((await restarted.get_config()).search_engines.wiki);
  assert.deepEqual((await load_layers()).engines?.letters, { w: "wiki" });
});

test("a refused engine keeps the old config and stores nothing", async () => {
  const { startup, messages, local } = await started("refuse", { "search_engines.toml": 'taken = { url = "https://t.test/?q={query}", keyword = "w" }\n' });
  const answer = await messages.change(wiki);
  assert.equal(answer.ok, false);
  assert.match(answer.message, /keyword/);
  assert.equal(local[ENGINE_EDITS_STORAGE_KEY] === undefined || Object.keys(local[ENGINE_EDITS_STORAGE_KEY] as object).length === 0, true);
  assert.equal((await startup.get_config()).search_engines.wiki, undefined);
  assert.equal(local[LAYERED_CONFIG_STORAGE_KEY] ?? null, null);
});

test("a file edit that now clashes drops the engine with a warning and the others stay", async () => {
  const { startup, messages, local } = await started("drop");
  await messages.change(wiki);
  await messages.change({ type: "change_engines", action: "set", name: "other", url: "https://o.test/?q={query}" });
  await startup.save_config_file("search_engines.toml", 'taken = { url = "https://t.test/?q={query}", keyword = "w" }\n', null);
  const config = await startup.get_config();
  assert.equal(config.search_engines.wiki, undefined);
  assert.ok(config.search_engines.other);
  assert.ok((local[WARNINGS_STORAGE_KEY] as string[]).some((warning) => warning.startsWith("engines: wiki left out")));
  const listed = await messages.list();
  assert.ok(listed.ok && listed.engines.find((row) => row.name === "wiki")?.left_out);
  assert.doesNotMatch(listed.ok ? (listed.engines.find((row) => row.name === "wiki")?.left_out ?? "") : "", /zz-saved-edits|search_engines\.d/);
  // The export leaves the broken engine out and keeps the other.
  const exported = export_files({}, {}, {}, (await startup.read_engine_state()).kept);
  assert.match(exported.config_files["search_engines.d/zz-saved-edits.toml"]!, /other/);
  assert.doesNotMatch(Object.values(exported.config_files).join("\n"), /wiki/);
  // The broken engine can still be removed.
  assert.equal((await messages.change({ type: "change_engines", action: "remove", name: "wiki" })).ok, true);
});

test("one broken engine can be removed while another stays broken", async () => {
  const { startup, messages } = await started("two_broken");
  await messages.change(wiki);
  await messages.change({ ...wiki, name: "wiki2", keyword: "x", letter: "x" });
  await startup.save_config_file("search_engines.toml", 'one = { url = "https://1.test/?q={query}", keyword = "w" }\ntwo = { url = "https://2.test/?q={query}", keyword = "x" }\n', null);
  assert.equal((await startup.read_engine_state()).dropped.length, 2);
  assert.equal((await messages.change({ type: "change_engines", action: "remove", name: "wiki" })).ok, true);
  assert.deepEqual((await startup.read_engine_state()).dropped.map((piece) => piece.name), ["wiki2"]);
  // A new engine that is fine still saves.
  assert.equal((await messages.change({ type: "change_engines", action: "set", name: "fresh", url: "https://f.test/?q={query}" })).ok, true);
});

test("editing a starter engine keeps its label, children and params, and youtube takes a key letter", async () => {
  const { startup, messages } = await started("edit_merge");
  await messages.change({ type: "change_engines", action: "starter" });
  assert.equal((await startup.get_config()).search_engines.google?.label, "Google");
  const google = await messages.change({ type: "change_engines", action: "set", name: "google", url: "https://www.google.com/search?q={query}&x=1", letter: "g" });
  assert.equal(google.ok, true, google.message);
  const config = await startup.get_config();
  assert.equal(config.search_engines.google?.label, "Google");
  assert.equal(config.search_engines.google?.keyword, undefined);
  const listed = await messages.list();
  const raw_youtube = listed.ok ? listed.engines.find((row) => row.name === "youtube")!.url : "";
  const before_children = Object.keys(config.search_engines).filter((name) => name.startsWith("youtube.")).length;
  assert.ok(before_children > 0);
  const youtube = await messages.change({ type: "change_engines", action: "set", name: "youtube", url: raw_youtube, letter: "y" });
  assert.equal(youtube.ok, true, youtube.message);
  const after = await startup.get_config();
  assert.equal(Object.keys(after.search_engines).filter((name) => name.startsWith("youtube.")).length, before_children);
  assert.equal(after.keymap.search_keys?.y, "youtube");
});

test("a refused engine writes nothing, not even for a moment", async () => {
  const { messages, local } = await started("refuse_clean", { "search_engines.toml": 'taken = { url = "https://t.test/?q={query}", keyword = "w" }\n' });
  const writes: unknown[] = [];
  const set = (browser as unknown as { storage: { local: { set: (values: Record<string, unknown>) => Promise<void> } } }).storage.local.set;
  (browser as unknown as { storage: { local: { set: unknown } } }).storage.local.set = async (values: Record<string, unknown>) => {
    writes.push(Object.keys(values));
    await set(values);
  };
  assert.equal((await messages.change(wiki)).ok, false);
  assert.deepEqual(writes, []);
  assert.equal(local[ENGINE_EDITS_STORAGE_KEY] === undefined || Object.keys(local[ENGINE_EDITS_STORAGE_KEY] as object).length === 0, true);
});

test("the starter set keeps a save that landed between its read and its turn", async () => {
  const { startup, messages } = await started("race");
  const racing = create_engine_messages({
    read_engine_state: async () => {
      const state = await startup.read_engine_state();
      // Another tab saves after this read and before the starter's turn.
      await messages.change({ type: "change_engines", action: "set", name: "late", url: "https://l.test/?q={query}" });
      return state;
    },
    change_layers: startup.change_layers,
    read_starter: async () => readFileSync(new URL("../../examples/engines.toml", import.meta.url), "utf8"),
  });
  assert.equal((await racing.change({ type: "change_engines", action: "starter" })).ok, true);
  const config = await startup.get_config();
  assert.ok(config.search_engines.late);
  assert.ok(config.search_engines.stackoverflow);
});

test("the starter set skips names that exist, replaces the built-in duck and leaves out a keyword clash", async () => {
  const { startup, messages } = await started("starter", { "search_engines.toml": 'arch = { url = "https://mine.test/?q={query}" }\nmine = { url = "https://m.test/?q={query}", keyword = "g" }\n' });
  const answer = await messages.change({ type: "change_engines", action: "starter" });
  assert.equal(answer.ok, true);
  assert.match(answer.message, /Skipped 1/);
  assert.match(answer.message, /starter duck replaces the built-in/);
  assert.match(answer.message, /Left out/);
  const config = await startup.get_config();
  assert.equal(config.search_engines.arch?.url, "https://mine.test/?q={query}");
  assert.equal(config.search_engines.google, undefined);
  assert.ok(config.search_engines["github.repo"]);
  assert.equal((await messages.change({ type: "change_engines", action: "starter" })).ok, true);
});

test("the export writes the engines as a search_engines.d file and the letters in keymap.d, and a key-only export is unchanged", () => {
  const exported = export_files({ "search_engines.toml": "" }, {}, { normal: { J: "tab.close" } }, { engines: { wiki: { url: "https://w.test/?q={query}" } }, letters: { w: "wiki" } });
  assert.deepEqual(Object.keys(exported.config_files).sort(), ["keymap.d/zz-saved-edits.toml", "search_engines.d/zz-saved-edits.toml", "search_engines.toml"]);
  assert.equal(exported.config_files["keymap.d/zz-saved-edits.toml"], '[normal]\nJ = "tab.close"\n\n[search_keys]\nw = "wiki"\n');
  assert.deepEqual(export_files({}, {}, { normal: { J: "tab.close" } }).config_files, { "keymap.d/zz-saved-edits.toml": '[normal]\nJ = "tab.close"\n' });
});

test("a stored engines layer keeps only checked tables and one-key letters", async () => {
  const { local } = install_fake_browser({ files: {} });
  local[ENGINE_EDITS_STORAGE_KEY] = { engines: { a: { url: "u" }, "b.c": { url: "u" }, d: "x" }, letters: { w: "a", "ab": "a", x: 1 } };
  assert.deepEqual((await load_layers()).engines, { engines: { a: { url: "u" } }, letters: { w: "a" } });
  local[ENGINE_EDITS_STORAGE_KEY] = "junk";
  assert.deepEqual(await load_layers(), { keymap: {} });
});
