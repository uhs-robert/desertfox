import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { answer_config_import, read_import_source, strip_top_folder } from "../../src/background/config_import.ts";
import type { ImportResult } from "../../src/background/config_import.ts";
import { ConfigRefusal } from "../../src/background/config_reload.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../../src/shared/prefix_tree.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import type { ConfigImportPreview, ImportSource } from "../../src/shared/messages/page.ts";
import { write_zip } from "../../src/shared/zip.ts";
import { FILES_CONFIG_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { install_fake_browser, until, type Files } from "./config_fake_browser.ts";
import { fresh_config_service, type ConfigService } from "./fresh_config_service.ts";

type Startup = ConfigService;

const snippet_file = (id: string, extra = "") => `// id: ${id}\n// label: Mine\n// intent: Run mine.\n// matches: https://a.test/*\n${extra}globalThis.ran_${id.replace(/\W/g, "_")} = true;\n`;
const zip_of = (files: Files): ImportSource => ({ kind: "zip", bytes: write_zip(files) });
const folder_of = (files: Files): ImportSource => ({ kind: "folder", entries: Object.entries(files).map(([path, text]) => ({ path, text })) });
// The stored files and their build, which one swap writes together.
const slot_of = (local: Record<string, unknown>) => ({ source: local[FILES_SOURCE_STORAGE_KEY] as { files: Files; dir_label: string }, config: local[FILES_CONFIG_STORAGE_KEY] });
const refusal_of = (promise: Promise<unknown>) =>
  promise.then(
    () => assert.fail("the import did not refuse"),
    (error: unknown) => {
      assert.ok(error instanceof ConfigRefusal, String(error));
      assert.match(error.message, /^Config not imported, the current one stays\./);
      return error.message;
    },
  );

// A start on host files with one installed snippet, so each test has a config and a snippet to keep or lose.
async function started(tag: string, host_files: Files = { "settings.toml": 'hint_letters = "ab"\n', "snippets/home.js": snippet_file(`${tag}.mine`) }) {
  const host: Parameters<typeof install_fake_browser>[0] = { files: host_files };
  const browser = install_fake_browser(host);
  const startup = fresh_config_service();
  await startup.get_config();
  await startup.reload_config();
  return { host, startup, ...browser };
}

test("strip_top_folder drops the one folder every path shares, and only that", () => {
  const strip = (paths: string[]) => [...strip_top_folder(new Map(paths.map((path) => [path, ""]))).keys()];
  assert.deepEqual(strip(["desertfox/settings.toml", "desertfox/keymap.d/a.toml"]), ["settings.toml", "keymap.d/a.toml"]);
  assert.deepEqual(strip(["cfg/desertfox/settings.toml"]), ["desertfox/settings.toml"]);
  assert.deepEqual(strip(["snippets/a.js", "snippets/b.js"]), ["snippets/a.js", "snippets/b.js"]);
  assert.deepEqual(strip(["themes/x.toml"]), ["themes/x.toml"]);
  assert.deepEqual(strip(["settings.toml", "desertfox/keymap.toml"]), ["settings.toml", "desertfox/keymap.toml"]);
  assert.deepEqual(strip(["a/settings.toml", "b/keymap.toml"]), ["a/settings.toml", "b/keymap.toml"]);
});

test("a zip of the config folder and a picked folder both read from the config root", async () => {
  const files = { "desertfox/settings.toml": "x = 1\n", "desertfox/snippets/a.js": "a" };
  const expected = { "settings.toml": "x = 1\n", "snippets/a.js": "a" };
  assert.deepEqual(await read_import_source(zip_of(files)), expected);
  assert.deepEqual(await read_import_source(folder_of(files)), expected);
});

test("a zip made from the home folder reads as nothing and is refused, not imported empty", async () => {
  const message = await refusal_of(read_import_source(zip_of({ ".config/desertfox/settings.toml": "x = 1\n" })));
  assert.match(message, /holds no config files.*desertfox config folder/);
  await refusal_of(read_import_source(folder_of({ "desertfox/.DS_Store": "junk" })));
});

test("the zip guards refuse a folder import too: paths, duplicates, sizes and counts", async () => {
  for (const [entries, expected] of [
    [[{ path: "desertfox/../../etc/passwd", text: "" }], /climbs out/],
    [[{ path: "/etc/passwd", text: "" }], /absolute path/],
    [[{ path: "desertfox\\settings.toml", text: "" }], /backslash/],
    [[{ path: "d/a.toml", text: "" }, { path: "d/./a.toml", text: "" }], /duplicate entry/],
    [[{ path: "d/a.toml", text: "x".repeat(1024 * 1024 + 1) }], /entry too large/],
    [[{ path: "d/a.toml", text: "x".repeat(700 * 1024) }, { path: "d/b.toml", text: "x".repeat(700 * 1024) }], /archive too large/],
    [Array.from({ length: 513 }, (_, index) => ({ path: `d/${index}.toml`, text: "" })), /too many entries/],
    [[{ path: "d/themes/", text: "" }], /not a file path/],
    [[{ path: 3, text: "" }], /not a path and a text/],
  ] as const) {
    const message = await refusal_of(read_import_source({ kind: "folder", entries: entries as unknown as { path: string; text: string }[] }));
    assert.match(message, expected);
  }
  assert.match(await refusal_of(read_import_source({ kind: "zip", bytes: new Uint8Array([1, 2, 3]) })), /The zip is refused: not a zip archive/);
  assert.match(await refusal_of(read_import_source({ kind: "url", href: "https://a.test/x.zip" })), /names no zip and no folder/);
});

test("the preview shows each snippet's code, sites and requires, and stores and registers nothing", async () => {
  const { startup, local } = await started("preview");
  const slot_before = structuredClone(slot_of(local));
  const code = snippet_file("preview.one", "// requires: repo\n");
  const preview = (await startup.preview_config_import(zip_of({ "desertfox/keymap.toml": '[normal]\n"zz" = "preview.one"\n', "desertfox/snippets/one.js": code, "desertfox/snippets/home.js": snippet_file("preview.mine") }))) as Extract<ConfigImportPreview, { ok: true }>;
  assert.equal(preview.replaces_config, true);
  assert.deepEqual(preview.config_files, ["keymap.toml"]);
  assert.deepEqual(preview.problems, []);
  const one = preview.snippets.find((snippet) => snippet.path === "snippets/one.js")!;
  assert.deepEqual({ ...one }, { path: "snippets/one.js", code, replaces: false, problems: [], id: "preview.one", label: "Mine", intent: "Run mine.", matches: ["https://a.test/*"], requires: ["repo"] });
  assert.equal(preview.snippets.find((snippet) => snippet.path === "snippets/home.js")!.replaces, true);
  assert.deepEqual(slot_of(local), slot_before);
  assert.equal(registry.get("preview.one"), undefined);
  assert.equal((globalThis as Record<string, unknown>).ran_preview_one, undefined);
});

test("the preview names the build problems and a snippet header that does not parse", async () => {
  const { startup } = await started("preview_problems");
  const preview = (await startup.preview_config_import(folder_of({ "d/settings.toml": "hint_letters = \n", "d/snippets/bad.js": "// id: bad.one\nreturn 1;\n" }))) as Extract<ConfigImportPreview, { ok: true }>;
  assert.ok(preview.problems.some((problem) => /^import\/settings\.toml:1/.test(problem)), preview.problems.join("\n"));
  const bad = preview.snippets[0]!;
  assert.equal(bad.id, undefined);
  assert.ok(bad.problems.some((problem) => /"label" is missing/.test(problem)));
});

test("a config import replaces the config files, keeps the installed snippets and leaves the saved edits on top", async () => {
  const { startup, local } = await started("replace");
  await startup.change_edits((current) => ({ ...current, saved: { which_key_delay_ms: 7 } }));
  await startup.import_config(zip_of({ "desertfox/keymap.toml": '[normal]\n"zz" = "tab.next"\n' }), {});
  const config = await startup.get_config();
  assert.deepEqual(config.settings, { which_key_delay_ms: 7 });
  assert.deepEqual(Object.keys(slot_of(local).source.files).sort(), ["keymap.toml", "snippets/home.js"]);
  assert.equal(slot_of(local).source.dir_label, "import");
  assert.ok(registry.get("replace.mine"));
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { which_key_delay_ms: 7 });

  // A restart runs on the import, with no host call.
  const after = fresh_config_service();
  assert.deepEqual((await after.get_config()).settings, { which_key_delay_ms: 7 });
});

test("only an accepted snippet is stored, and a declined one never reaches the registry", async () => {
  const { startup, local } = await started("consent");
  const source = zip_of({ "s/snippets/yes.js": snippet_file("consent.yes"), "s/snippets/no.js": snippet_file("consent.no") });
  await startup.import_config(source, { "snippets/yes.js": snippet_file("consent.yes") });
  assert.ok(registry.get("consent.yes"));
  assert.equal(registry.get("consent.no"), undefined);
  assert.deepEqual(Object.keys(slot_of(local).source.files).sort(), ["settings.toml", "snippets/home.js", "snippets/yes.js"]);
  // A snippet-only import keeps the config files and their label.
  assert.equal((await startup.get_config()).settings.hint_letters, "ab");
  assert.equal(slot_of(local).source.dir_label, "/home/u/.config/desertfox");
});

for (const [name, accepted, expected] of [
  ["code that differs from the import", { "snippets/one.js": "fetch('https://evil.test')" }, /differs from the one accepted/],
  ["a path the import does not hold", { "snippets/other.js": "x" }, /holds no snippet snippets\/other\.js/],
  ["a config file passed as a snippet", { "settings.toml": "x" }, /holds no snippet settings\.toml/],
  ["no list at all", ["snippets/one.js"], /not a list of paths and code/],
  ["nothing accepted from a snippet-only import", {}, /no config files and no snippet was accepted/],
] as const) {
  test(`an import with ${name} is refused and changes nothing`, async () => {
    const { startup, local } = await started(`refused_${name.replace(/\W/g, "_")}`);
    const slot_before = structuredClone(slot_of(local));
    const tree_before = structuredClone(local[COMPILED_KEYMAP_STORAGE_KEY]);
    assert.match(await refusal_of(startup.import_config(zip_of({ "snippets/one.js": snippet_file("refused.one") }), accepted)), expected);
    assert.deepEqual(slot_of(local), slot_before);
    assert.deepEqual(local[COMPILED_KEYMAP_STORAGE_KEY], tree_before);
    assert.equal(registry.get("refused.one"), undefined);
  });
}

test("an import with build problems keeps the current config, snippets and stored files", async () => {
  const { startup, local } = await started("bad_build");
  const slot_before = structuredClone(slot_of(local));
  // The keymap binds a snippet the user declines, so the build fails on the binding.
  const source = zip_of({ "d/keymap.toml": '[normal]\n"zz" = "bad.declined"\n', "d/snippets/x.js": snippet_file("bad.declined") });
  assert.match(await refusal_of(startup.import_config(source, {})), /Fix the files and import again\. 1 problem\(s\): import\/keymap\.toml/);
  assert.deepEqual(slot_of(local), slot_before);
  assert.equal((await startup.get_config()).settings.hint_letters, "ab");
  assert.ok(registry.get("bad_build.mine"));
});

test("an import that fails half way puts the old config, snippets, tree and stored files back", async () => {
  const { startup, local, fake } = await started("half_way");
  const slot_before = structuredClone(slot_of(local));
  const tree_before = structuredClone(local[COMPILED_KEYMAP_STORAGE_KEY]);
  const working = fake.storage.local.set;
  fake.storage.local.set = async (values) => {
    if (FILES_CONFIG_STORAGE_KEY in values) throw new Error("disk full");
    return working(values);
  };
  const answer = await answer_config_import(
    { type: "commit_config_import", source: zip_of({ "d/settings.toml": 'hint_letters = "cd"\n', "d/snippets/new.js": snippet_file("half.new") }), accepted: { "snippets/new.js": snippet_file("half.new") } },
    { preview: startup.preview_config_import, commit: startup.import_config },
  );
  fake.storage.local.set = working;
  assert.deepEqual(answer, { ok: false, message: "Config not imported, the current one stays: disk full" });
  assert.deepEqual(slot_of(local), slot_before);
  assert.deepEqual(local[COMPILED_KEYMAP_STORAGE_KEY], tree_before);
  assert.equal((await startup.get_config()).settings.hint_letters, "ab");
  assert.equal(registry.get("half.new"), undefined);
  assert.ok(registry.get("half_way.mine"));
});

test("an import queued behind a reload builds on the reloaded files", async () => {
  const { startup, host, local } = await started("reload_then_import");
  host.files = { "settings.toml": 'hint_letters = "rt"\n', "snippets/later.js": snippet_file("rti.later") };
  const reload = startup.reload_config();
  const imported = startup.import_config(zip_of({ "d/keymap.toml": '[normal]\n"zz" = "tab.next"\n' }), {});
  await Promise.all([reload, imported]);
  // The import replaced the reloaded config files and kept the reloaded snippets.
  assert.deepEqual(Object.keys(slot_of(local).source.files).sort(), ["keymap.toml", "snippets/later.js"]);
  assert.equal((await startup.get_config()).settings.hint_letters, undefined);
  assert.ok(registry.get("rti.later"));
  assert.equal(registry.get("reload_then_import.mine"), undefined);
});

test("a reload queued behind an import writes the import's settings.toml first and keeps it, but drops the imported snippets", async () => {
  const { startup, host, local } = await started("import_then_reload");
  host.files = { "settings.toml": 'hint_letters = "rt"\n' };
  const imported = startup.import_config(zip_of({ "d/settings.toml": 'hint_letters = "ij"\n', "d/snippets/i.js": snippet_file("itr.imported") }), { "snippets/i.js": snippet_file("itr.imported") });
  const reload = startup.reload_config();
  await Promise.all([imported, reload]);
  assert.deepEqual(host.files, { "settings.toml": 'hint_letters = "ij"\n' });
  assert.deepEqual(slot_of(local).source.files, { "settings.toml": 'hint_letters = "ij"\n' });
  assert.equal((await startup.get_config()).settings.hint_letters, "ij");
  assert.equal(registry.get("itr.imported"), undefined);
  assert.equal(unsynced_of(local), undefined);
});

test("a :set queued behind an import lands on the imported config", async () => {
  const { startup } = await started("import_then_set");
  const imported = startup.import_config(folder_of({ "d/settings.toml": 'hint_letters = "ij"\n' }), {});
  const set = startup.change_edits((current) => ({ ...current, temp: { which_key_delay_ms: 3 } }));
  await Promise.all([imported, set]);
  assert.deepEqual((await startup.get_config()).settings, { hint_letters: "ij", which_key_delay_ms: 3 });
});

test("the answer names what the import changed, and a preview failure is an answer too", async () => {
  const deps = (result: ImportResult) => ({
    preview: async () => {
      throw new ConfigRefusal("Config not imported, the current one stays. Bad zip.");
    },
    commit: async () => result,
  });
  const commit = { type: "commit_config_import", source: folder_of({}), accepted: {} } as const;
  assert.deepEqual(await answer_config_import(commit, deps({ warnings: 0, replaces_config: true, snippets: 2, folder_writes: [] })), { ok: true, message: "Imported the config files and 2 snippet(s)" });
  const folder_writes = [{ path: "settings.toml", outcome: { kind: "written" } }, { path: "themes/a.toml", outcome: { kind: "written" } }, { path: "keymap.d/zz-desertfox.toml", outcome: { kind: "waiting", host_outdated: true } }] as const;
  assert.deepEqual(await answer_config_import(commit, deps({ warnings: 0, replaces_config: true, snippets: 0, folder_writes: [...folder_writes] })), {
    ok: true,
    message: "Imported the config files. Wrote settings.toml, themes/a.toml to the config folder. keymap.d/zz-desertfox.toml updates once the native host is updated",
  });
  assert.deepEqual(await answer_config_import(commit, deps({ warnings: 1, replaces_config: false, snippets: 1 })), { ok: true, message: "Imported 1 snippet(s), with 1 warning(s) on the Help page" });
  assert.deepEqual(await answer_config_import({ type: "preview_config_import", source: folder_of({}) }, deps({ warnings: 0, replaces_config: true, snippets: 0 })), { ok: false, message: "Config not imported, the current one stays. Bad zip." });
});

test("autoconfig.toml alone is not a config import, and an import never stores it", async () => {
  const { startup, local } = await started("autoconfig_only");
  assert.match(await refusal_of(startup.import_config(zip_of({ "d/autoconfig.toml": 'hint_letters = "zx"\n' }), {})), /holds no config files and no snippet was accepted/);
  assert.equal((await startup.get_config()).settings.hint_letters, "ab");
  const preview = (await startup.preview_config_import(zip_of({ "d/autoconfig.toml": "", "d/snippets/a.js": snippet_file("autoconfig_only.a") }))) as Extract<ConfigImportPreview, { ok: true }>;
  assert.equal(preview.replaces_config, false);
  await startup.import_config(zip_of({ "d/autoconfig.toml": "", "d/snippets/a.js": snippet_file("autoconfig_only.a") }), { "snippets/a.js": snippet_file("autoconfig_only.a") });
  assert.deepEqual(Object.keys(slot_of(local).source.files).sort(), ["settings.toml", "snippets/a.js", "snippets/home.js"]);
});

test("an import drops the consent settings, says so in the review, and keeps the other settings", async () => {
  const { startup, local } = await started("consent_settings");
  const source = zip_of({ "settings.toml": 'hint_letters = "xy"\nbridge = true\nbridge_share_tabs = true\nhost_auto_update = true\n', "settings.d/50-more.toml": "bridge = true\n", "settings.d/60-table.toml": "[host_auto_update]\nx = 1\n" });
  const preview = (await startup.preview_config_import(source)) as Extract<ConfigImportPreview, { ok: true }>;
  assert.deepEqual(preview.warnings, [
    "settings.toml: bridge is not imported. Set it on this machine.",
    "settings.toml: bridge_share_tabs is not imported. Set it on this machine.",
    "settings.toml: host_auto_update is not imported. Set it on this machine.",
    "settings.d/50-more.toml: bridge is not imported. Set it on this machine.",
    "settings.d/60-table.toml: host_auto_update is not imported. Set it on this machine.",
  ]);
  await startup.import_config(source, {});
  const files = slot_of(local).source.files;
  assert.match(files["settings.toml"]!, /hint_letters = "xy"/);
  assert.doesNotMatch(files["settings.toml"]!, /bridge|host_auto_update/);
  assert.doesNotMatch(files["settings.d/50-more.toml"]!, /bridge/);
  assert.doesNotMatch(files["settings.d/60-table.toml"]!, /host_auto_update/);
  const built = (await startup.get_config()).settings;
  assert.equal(built.hint_letters, "xy");
  assert.notEqual(built.bridge, true);
  assert.notEqual(built.bridge_share_tabs, true);
  assert.notEqual(built.host_auto_update, true);
});

// The import writes the files the host can write, so the folder and the browser copy agree on them.

const IMPORTED_SETTINGS = 'hint_letters = "xyz"\n';
const unsynced_of = (local: Record<string, unknown>) => local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] ?? undefined;
const commit_answer = (startup: Startup, source: ImportSource, accepted: Record<string, string> = {}) =>
  answer_config_import({ type: "commit_config_import", source, accepted }, { preview: startup.preview_config_import, commit: startup.import_config });

test("an import writes the files the host can write, leaves the folder's others, and `,r` keeps it", async () => {
  const theme = readFileSync(new URL("../../themes/catppuccin_frappe.toml", import.meta.url), "utf8");
  const { startup, host, local } = await started("writes_folder", { "settings.toml": 'hint_letters = "ab"\n', "themes/old.toml": theme, "keymap.toml": "" });
  const source = zip_of({ "d/settings.toml": IMPORTED_SETTINGS, "d/themes/mine.toml": theme, "d/keymap.toml": '[normal]\n"zz" = "tab.next"\n', "d/snippets/s.js": snippet_file("writes_folder.s") });
  const preview = (await startup.preview_config_import(source)) as Extract<ConfigImportPreview, { ok: true }>;
  assert.deepEqual(preview.folder_files, ["settings.toml", "themes/mine.toml"]);
  const answer = await commit_answer(startup, source, { "snippets/s.js": snippet_file("writes_folder.s") });
  assert.deepEqual(answer, { ok: true, message: "Imported the config files and 1 snippet(s). Wrote settings.toml, themes/mine.toml to the config folder" });
  assert.deepEqual(host.files, { "settings.toml": IMPORTED_SETTINGS, "themes/old.toml": theme, "themes/mine.toml": theme, "keymap.toml": "" });
  assert.equal(unsynced_of(local), undefined);
  await startup.reload_config();
  assert.equal((await startup.get_config()).settings.hint_letters, "xyz");
});

test("an import whose write the folder refuses as changed on disk stays, and the copies-differ question takes the file", async () => {
  const { startup, host, local, fake } = await started("refused_write");
  const send = fake.runtime.sendNativeMessage;
  fake.runtime.sendNativeMessage = async (name, message) => {
    if (message.cmd === "write_config_file") host.files = { ...host.files, "settings.toml": 'hint_letters = "hand"\n' };
    return send(name, message);
  };
  const answer = await commit_answer(startup, zip_of({ "d/settings.toml": IMPORTED_SETTINGS }));
  assert.deepEqual(answer, { ok: true, message: "Imported the config files. settings.toml changed on disk, so it stays as it is. Open the Settings page to choose" });
  assert.equal((await startup.get_config()).settings.hint_letters, "xyz");
  assert.equal(host.files["settings.toml"], 'hint_letters = "hand"\n');
  assert.equal(unsynced_of(local), undefined);
  assert.notEqual(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

for (const [name, host_state] of [["no permission", { granted: false }], ["no config folder", { no_folder: true }]] as const) {
  test(`an import with ${name} stays in the browser and says the folder was not updated`, async () => {
    const { startup, host, local, sent } = await started(`no_folder_${name.replace(/ /g, "_")}`);
    Object.assign(host, host_state);
    sent.length = 0;
    const answer = await commit_answer(startup, zip_of({ "d/settings.toml": IMPORTED_SETTINGS }));
    assert.deepEqual(answer, { ok: true, message: "Imported the config files. The config folder was not updated" });
    assert.equal((await startup.get_config()).settings.hint_letters, "xyz");
    assert.deepEqual(sent.filter((message) => message.cmd === "write_config_file"), []);
    assert.equal(unsynced_of(local), undefined);
  });
}

test("a `:set` after an import keeps the record of the files still waiting, and the next `,r` writes them", async () => {
  const { startup, host, local } = await started("set_after_import");
  host.refuse = ["settings.toml"];
  const answer = await commit_answer(startup, zip_of({ "d/settings.toml": IMPORTED_SETTINGS }));
  assert.match(answer.message, /settings\.toml was not written/);
  assert.deepEqual(unsynced_of(local), { "settings.toml": 'hint_letters = "ab"\n' });
  assert.deepEqual(await startup.set_in_settings_file("which_key_delay_ms", 7), { kind: "browser_copy" });
  assert.deepEqual(unsynced_of(local), { "settings.toml": 'hint_letters = "ab"\n' });
  host.refuse = [];
  await startup.reload_config();
  assert.deepEqual((await startup.get_config()).settings, { hint_letters: "xyz", which_key_delay_ms: 7 });
  assert.equal(unsynced_of(local), undefined);
});

test("a stop between the import's commit and its write leaves the record, and the next start writes it", async () => {
  const { startup, host, local, fake } = await started("stop_before_write");
  const send = fake.runtime.sendNativeMessage;
  let write_out = false;
  // The write never answers, as when the browser stops while it is out.
  fake.runtime.sendNativeMessage = async (name, message) => (message.cmd === "write_config_file" ? ((write_out = true), new Promise<never>(() => {})) : send(name, message));
  void startup.import_config(zip_of({ "d/settings.toml": IMPORTED_SETTINGS }), {});
  await until(() => write_out, "the import's write did not go out");
  assert.deepEqual(unsynced_of(local), { "settings.toml": 'hint_letters = "ab"\n' });
  fake.runtime.sendNativeMessage = send;
  const restarted = fresh_config_service();
  await restarted.reload_config_at_start();
  assert.equal(host.files["settings.toml"], IMPORTED_SETTINGS);
  assert.equal(unsynced_of(local), undefined);
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
  assert.equal((await restarted.get_config()).settings.hint_letters, "xyz");
});

test("an import keeps the folder's consent keys in the settings.toml it writes, and never writes its own", async () => {
  const { startup, host, local, sent } = await started("folder_consent", { "settings.toml": 'hint_letters = "ab"\nbridge = true\n' });
  sent.length = 0;
  const source = zip_of({ "d/settings.toml": 'hint_letters = "xyz"\nhost_auto_update = true\n' });
  const preview = (await startup.preview_config_import(source)) as Extract<ConfigImportPreview, { ok: true }>;
  assert.deepEqual(preview.folder_files, ["settings.toml"]);
  await startup.import_config(source, {});
  const written = 'hint_letters = "xyz"\nbridge = true\n';
  assert.equal(host.files["settings.toml"], written);
  assert.equal(slot_of(local).source.files["settings.toml"], written);
  assert.equal(unsynced_of(local), undefined);
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
  await startup.reload_config();
  const settings = (await startup.get_config()).settings;
  assert.equal(settings.bridge, true);
  assert.notEqual(settings.host_auto_update, true);
});

test("a folder settings.toml without consent keys gets none from an import", async () => {
  const { startup, host } = await started("no_folder_consent");
  await startup.import_config(zip_of({ "d/settings.toml": 'hint_letters = "xyz"\nbridge = true\n' }), {});
  assert.equal(host.files["settings.toml"], 'hint_letters = "xyz"\n');
});
