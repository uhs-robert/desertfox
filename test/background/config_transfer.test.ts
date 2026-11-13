import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { answer_config_transfer, export_files, installed_snippets } from "../../src/background/config_transfer.ts";
import { FILES_SOURCE_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { load_files_source } from "../../src/background/config_load.ts";
import { build_config, commands_of_registry } from "../../src/shared/config_build/build_config.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { load_layers } from "../../src/background/edit_layers.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../../src/shared/prefix_tree.ts";
import { write_zip } from "../../src/shared/zip.ts";
import { install_fake_browser, type Files } from "./config_fake_browser.ts";

type Startup = typeof import("../../src/background/startup.ts");

const snippet_file = (id: string) => `// id: ${id}\n// label: Mine\n// intent: Run mine.\n// matches: https://a.test/*\n// requires: repo\nglobalThis.ran = true;\n`;

test("an export holds the config files with the saved edits as settings.toml, and the snippets apart", () => {
  const files = { "keymap.toml": "x", "autoconfig.toml": "mirror", "snippets/a.js": "A" };
  assert.deepEqual(export_files(files, { hint_letters: "ab" }), { config_files: { "keymap.toml": "x", "settings.toml": 'hint_letters = "ab"\n' }, snippet_files: { "snippets/a.js": "A" } });
  assert.deepEqual(export_files(files, {}).config_files, { "keymap.toml": "x" });
});

test("a config that has a settings.toml keeps it, and the saved edits go in a later file of settings.d", () => {
  const { config_files } = export_files({ "settings.toml": "a = 1\n" }, { hint_letters: "ab" });
  assert.equal(config_files["settings.toml"], "a = 1\n");
  assert.equal(config_files["settings.d/zz-saved-edits.toml"], 'hint_letters = "ab"\n');
});

test("the installed snippet list shows each header and flags one that does not parse", () => {
  const [good, bad] = installed_snippets({ "snippets/a.js": snippet_file("user.mine"), "snippets/b.js": "no header", "settings.toml": "" });
  assert.deepEqual([good!.path, good!.id, good!.matches, good!.requires], ["snippets/a.js", "user.mine", ["https://a.test/*"], ["repo"]]);
  assert.equal(bad!.id, undefined);
  assert.ok(bad!.problems.length > 0);
});

test("removing a snippet rebuilds without it, and a key that binds it refuses the removal and keeps it", async () => {
  const host = { files: { "snippets/a.js": snippet_file("user.mine"), "snippets/b.js": snippet_file("user.other") } as Files };
  const fake = install_fake_browser(host);
  const startup = (await import(`../../src/background/startup.ts?transfer_${Math.random()}`)) as Startup;
  await startup.get_config();
  await startup.reload_config();
  const deps = { read_files: async () => (await load_files_source()).files, read_saved: async () => ({}), read_keymap_edits: async () => ({ edits: {}, skipped: [] }), remove: startup.remove_snippet };

  const removed = await answer_config_transfer({ type: "remove_snippet", path: "snippets/a.js" }, deps);
  assert.equal(removed.ok, true);
  assert.deepEqual(Object.keys((await load_files_source()).files), ["snippets/b.js"]);
  assert.equal(startup.snippets.is_snippet("user.mine"), false);
  assert.equal(startup.snippets.is_snippet("user.other"), true);

  const missing = await answer_config_transfer({ type: "remove_snippet", path: "snippets/zzz.js" }, deps);
  assert.deepEqual([missing.ok, (missing as { message: string }).message.startsWith("Snippet not removed, the current config stays.")], [false, true]);
  assert.ok(FILES_SOURCE_STORAGE_KEY in fake.local);

  host.files = { "snippets/b.js": snippet_file("user.other"), "keymap.toml": '[normal]\nzz = "user.other"\n' };
  await startup.reload_config();
  const before = JSON.stringify((await load_files_source()).files);
  const refused = await answer_config_transfer({ type: "remove_snippet", path: "snippets/b.js" }, deps);
  assert.equal(refused.ok, false);
  assert.equal(JSON.stringify((await load_files_source()).files), before);
  assert.equal(startup.snippets.is_snippet("user.other"), true);
});

// The exported config files, built, give the settings the source gave with the saved edits on top.
const settings_in_force = (files: Files, saved: Record<string, unknown>) => {
  const commands = commands_of_registry(registry);
  return { ...build_config(files, commands, [], { dir_label: "x" }).settings, ...saved };
};

test("the exported config builds to the settings in force, whatever settings files the source has", () => {
  const saved = { hint_letters: "ab", newtab_date: false };
  const sources: Files[] = [
    {},
    { "settings.toml": 'hint_letters = "xy"\nnewtab_recent_tabs = true\n' },
    { "settings.d/10-x.toml": 'hint_letters = "xy"\nnewtab_recent_tabs = true\n' },
    { "settings.d/zz-saved-edits.toml": 'hint_letters = "xy"\nnewtab_recent_tabs = true\n', "settings.d/10-x.toml": "newtab_date = true\n" },
    { "settings.d/zzz.toml": 'hint_letters = "xy"\n', "settings.d/~x.toml": "newtab_date = true\n" },
  ];
  for (const source of sources) {
    const { config_files } = export_files(source, saved);
    assert.deepEqual(settings_in_force(config_files, {}), settings_in_force(source, saved), JSON.stringify(source));
    for (const [path, text] of Object.entries(source)) assert.equal(config_files[path], text, `${path} was overwritten`);
  }
});

test("a saved site bind in each binding format survives export then import, as text and as invocations", () => {
  const resolved = { a: { id: "tab.next" }, b: [{ id: "tab.prev" }, { id: "tab.next" }], c: [{ id: "tab.next", label: "Next", intent: "Go on" }, { id: "tab.prev" }] };
  const typed = { a: "tab.next", b: ["tab.prev", "tab.next"], c: { run: ["tab.next", "tab.prev"], label: "Next", intent: "Go on" } };
  for (const bind of [typed, resolved]) {
    const { config_files } = export_files({}, { site_rules: [{ site: "https://a.test/*", bind }] });
    assert.deepEqual(settings_in_force(config_files, {}).site_rules, [{ site: "https://a.test/*", bind: resolved }]);
  }
});

test("the key edits export as a keymap.d file that sorts after every one there", () => {
  const edits = { normal: { J: "tab.close", K: "" }, browser: { "<A-x>": "tab.next" } };
  assert.deepEqual(export_files({}, {}, edits).config_files, { "keymap.d/zz-saved-edits.toml": '[normal]\nJ = "tab.close"\nK = ""\n\n[browser]\n"<A-x>" = "tab.next"\n' });
  const { config_files } = export_files({ "keymap.toml": "a", "keymap.d/zzz.toml": "b" }, {}, edits);
  assert.deepEqual(Object.keys(config_files).sort(), ["keymap.d/zzz.toml", "keymap.d/zzz.toml-zz-saved-edits.toml", "keymap.toml"]);
  assert.equal(config_files["keymap.d/zzz.toml"], "b");
  assert.deepEqual(Object.keys(export_files({ "keymap.toml": "a" }, {}, {}).config_files), ["keymap.toml"]);
});

test("an export with key edits imports on a fresh profile to the same compiled keymap", async () => {
  const files: Files = { "keymap.toml": '[normal]\nJ = "tab.prev"\n', "keymap.d/zzz.toml": '[normal]\nK = "tab.goto"\n' };
  const source = install_fake_browser({ files });
  const startup = (await import(`../../src/background/startup.ts?transfer_${Math.random()}`)) as Startup;
  await startup.get_config();
  await startup.reload_config();
  await startup.change_layers("keymap", () => ({ normal: { J: "tab.close", K: "", Jx: "tab.next" }, browser: { "<A-x>": "tab.next" } }));
  const exported = await answer_config_transfer({ type: "export_config" }, { read_files: async () => (await load_files_source()).files, read_saved: async () => ({}), read_keymap_edits: async () => ({ edits: (await load_layers()).keymap, skipped: [] }), remove: startup.remove_snippet });
  assert.equal(exported.ok, true);
  const compiled_before = source.local[COMPILED_KEYMAP_STORAGE_KEY];

  const fresh = install_fake_browser({ files: {} });
  const restored = (await import(`../../src/background/startup.ts?transfer_${Math.random()}`)) as Startup;
  await restored.get_config();
  await restored.import_config({ kind: "zip", bytes: write_zip((exported as { config_files: Files }).config_files) }, {});
  assert.deepEqual(fresh.local[COMPILED_KEYMAP_STORAGE_KEY], compiled_before);
});

test("a key edit that runs a snippet refuses its removal, and the export answer names an edit that no longer reads", async () => {
  const host = { files: { "snippets/b.js": snippet_file("keyed.snippet") } as Files };
  install_fake_browser(host);
  const startup = (await import(`../../src/background/startup.ts?transfer_${Math.random()}`)) as Startup;
  await startup.get_config();
  await startup.reload_config();
  await startup.change_layers("keymap", () => ({ normal: { zz: "keyed.snippet" } }));
  await assert.rejects(startup.remove_snippet("snippets/b.js"), /Snippet not removed, the current config stays\. The key edit normal "zz" runs keyed\.snippet/);
  assert.ok(Object.hasOwn((await load_files_source()).files, "snippets/b.js"));

  const exported = await answer_config_transfer({ type: "export_config" }, { read_files: async () => ({}), read_saved: async () => ({}), read_keymap_edits: async () => ({ edits: { normal: { J: "tab.close" } }, skipped: ['normal "x": unknown command "user.gone"'] }), remove: startup.remove_snippet });
  assert.deepEqual(exported, { ok: true, config_files: { "keymap.d/zz-saved-edits.toml": '[normal]\nJ = "tab.close"\n' }, snippet_files: {}, skipped_key_edits: ['normal "x": unknown command "user.gone"'] });
});
