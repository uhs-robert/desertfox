import assert from "node:assert/strict";
import "../../src/background/command_modules.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { test } from "node:test";
import { registry } from "../../src/shared/registry/builtin.ts";
import { CONFIG_FORMAT_VERSION } from "../../src/shared/config.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../../src/shared/prefix_tree.ts";
import { CONFIG_STATUS_STORAGE_KEY, FILES_CONFIG_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, TEMP_SETTINGS_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { ConfigRefusal } from "../../src/background/config_reload.ts";
import { create_autoconfig_mirror } from "../../src/background/autoconfig_mirror.ts";
import { NativeHostError } from "../../src/background/native_client.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import { install_fake_browser, type Files } from "./config_fake_browser.ts";

type Startup = typeof import("../../src/background/startup.ts");
const fresh_startup = async (tag: string) => (await import(`../../src/background/startup.ts?reload_${tag}`)) as Startup;

const settings_file = (body: string): Files => ({ "settings.toml": body });
const snippet_file = (id: string) => `// id: ${id}\n// label: Mine\n// intent: Run mine.\n// matches: https://a.test/*\nreturn 1;\n`;
const status_of = (local: Record<string, unknown>) => local[CONFIG_STATUS_STORAGE_KEY] as { source: string; temp: string[] };
const set_temp = (startup: Startup, name: string, value: unknown) => startup.change_edits((current) => ({ ...current, temp: { ...current.temp, [name]: value } }));

test("a reload applies the files in place, and a temp edit stays on top", async () => {
  const host = { files: settings_file('hint_letters = "ab"\n') };
  const { local } = install_fake_browser(host);
  const startup = await fresh_startup("in_place");
  await startup.get_config();
  await set_temp(startup, "which_key_delay_ms", 7);

  const reloaded = await startup.reload_config();
  assert.deepEqual(reloaded, { config_dir: "/home/u/.config/desertfox", warnings: 0 });
  assert.deepEqual((await startup.get_config()).settings, { hint_letters: "ab", which_key_delay_ms: 7 });
  assert.equal(status_of(local).source, "files");
  assert.deepEqual(status_of(local).temp, ["which_key_delay_ms"]);

  // A restart picks the stored files config, with no host call.
  const after_restart = await fresh_startup("in_place_restart");
  assert.equal((await after_restart.get_config()).settings.hint_letters, "ab");
});

test("a :set already in the queue lands before the reload, and the reload keeps it", async () => {
  const host = { files: settings_file('hint_letters = "ab"\n') };
  const { session } = install_fake_browser(host);
  const startup = await fresh_startup("set_then_reload");
  await startup.get_config();
  const set = set_temp(startup, "hint_letters", "xy");
  const reload = startup.reload_config();
  const later_set = set_temp(startup, "which_key_delay_ms", 9);
  await Promise.all([set, reload, later_set]);
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], { hint_letters: "xy", which_key_delay_ms: 9 });
  assert.deepEqual((await startup.get_config()).settings, { hint_letters: "xy", which_key_delay_ms: 9 });
});

test("a :set started while a reload publishes waits for it, so the reload cannot overwrite the edit", async () => {
  const host = { files: settings_file('hint_letters = "ab"\n') };
  const { fake, local } = install_fake_browser(host);
  const startup = await fresh_startup("set_during_reload");
  await startup.get_config();
  const working = fake.tabs.query;
  let slow_next = true;
  // Only the reload's publish is slow, so without the queue the :set would finish inside it.
  fake.tabs.query = async () => {
    if (slow_next) {
      slow_next = false;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return working();
  };
  const reload = startup.reload_config();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await Promise.all([reload, set_temp(startup, "which_key_delay_ms", 9)]);
  assert.deepEqual((await startup.get_config()).settings, { hint_letters: "ab", which_key_delay_ms: 9 });
  assert.deepEqual(status_of(local).temp, ["which_key_delay_ms"]);
});

test("a start on defaults, then a reload and a restart, ends on the stored files", async () => {
  const host = { files: settings_file('hint_letters = "ab"\n') };
  const { local } = install_fake_browser(host);
  const before = await fresh_startup("files_slot");
  await before.get_config();
  assert.equal(status_of(local).source, "defaults");
  await before.reload_config();
  const after = await fresh_startup("files_slot_restart");
  assert.equal((await after.get_config()).settings.hint_letters, "ab");
  assert.equal(status_of(local).source, "files");
});

test("a first start with no files slot runs on defaults, with no snippets or engines of its own", async () => {
  const { local } = install_fake_browser({ files: {} });
  const startup = await fresh_startup("neither");
  const config = await startup.get_config();
  assert.equal(status_of(local).source, "defaults");
  assert.deepEqual(config.snippets, []);
  assert.deepEqual(Object.keys(config.search_engines), Object.keys(empty_config().search_engines));
});

test("a stale managed source in storage.local is replaced by the first publish", async () => {
  const { local } = install_fake_browser({ files: {} });
  local[CONFIG_STATUS_STORAGE_KEY] = { source: "managed", settings: {}, managed_file_hint: "x", saved: [], temp: [], configured: [] };
  const startup = await fresh_startup("stale_managed");
  await startup.get_config();
  assert.equal(status_of(local).source, "defaults");
  assert.equal("managed_file_hint" in status_of(local), false);
});

test("two reloads at once run one after the other and the second one's files win", async () => {
  const host = { files: { ...settings_file('hint_letters = "ab"\n'), "snippets/one.js": snippet_file("twice.one") } };
  const { sent } = install_fake_browser(host);
  const startup = await fresh_startup("two_reloads");
  await startup.get_config();
  let replies = 0;
  // The first host read waits, so the second reload is queued while the first is still running.
  const files_by_call = [host.files, { ...settings_file('hint_letters = "cd"\n'), "snippets/one.js": snippet_file("twice.one") }];
  (globalThis as unknown as { browser: { runtime: { sendNativeMessage: unknown } } }).browser.runtime.sendNativeMessage = async () => {
    const files = files_by_call[replies++]!;
    if (replies === 1) await new Promise((resolve) => setTimeout(resolve, 20));
    return { ok: true, config_dir: "/c", config_dir_exists: true, files };
  };
  const [first, second] = await Promise.all([startup.reload_config(), startup.reload_config()]);
  assert.equal(sent.length, 0);
  assert.equal(replies, 2);
  // The same snippet twice in a row registers once: no "already defined" warning.
  assert.equal(first.warnings, 0);
  assert.equal(second.warnings, 0);
  assert.equal((await startup.get_config()).settings.hint_letters, "cd");
  assert.ok(registry.get("twice.one"));
});

test("a reload replaces the snippets: a removed one is gone and a kept one is not defined twice", async () => {
  const host = { files: { "snippets/a.js": snippet_file("swap.first"), "snippets/b.js": snippet_file("swap.kept") } as Files };
  install_fake_browser(host);
  const startup = await fresh_startup("snippet_swap");
  await startup.get_config();
  await startup.reload_config();
  assert.ok(registry.get("swap.first"));
  host.files = { "snippets/b.js": snippet_file("swap.kept"), "snippets/c.js": snippet_file("swap.second") };
  const reloaded = await startup.reload_config();
  assert.equal(reloaded.warnings, 0);
  assert.equal(registry.get("swap.first"), undefined);
  assert.equal(registry.find("swap.first"), undefined);
  assert.ok(registry.get("swap.kept"));
  assert.ok(registry.get("swap.second"));
});

test("a reload that fails while it publishes leaves the old config, snippets, tree and stored files whole", async () => {
  const host = { files: { ...settings_file('hint_letters = "ab"\n'), "snippets/a.js": snippet_file("half.old") } as Files };
  const { local, fake } = install_fake_browser(host);
  const startup = await fresh_startup("half_way");
  await startup.get_config();
  await startup.reload_config();
  const tree_before = structuredClone(local[COMPILED_KEYMAP_STORAGE_KEY]);
  const stored_before = structuredClone(local[FILES_CONFIG_STORAGE_KEY]);

  host.files = { ...settings_file('hint_letters = "cd"\n'), "snippets/b.js": snippet_file("half.new") };
  const working = fake.tabs.query;
  let calls = 0;
  // The new publish fails when it tells the tabs. The rollback publish works again.
  fake.tabs.query = async () => {
    if (calls++ === 0) throw new Error("tabs down");
    return working();
  };
  await assert.rejects(startup.reload_config(), /tabs down/);
  fake.tabs.query = working;

  assert.equal((await startup.get_config()).settings.hint_letters, "ab");
  assert.ok(registry.get("half.old"));
  assert.equal(registry.get("half.new"), undefined);
  assert.deepEqual(local[COMPILED_KEYMAP_STORAGE_KEY], tree_before);
  assert.deepEqual(local[FILES_CONFIG_STORAGE_KEY], stored_before);
  // A later :set publishes on the old step, so the old config is still the one in force.
  await set_temp(startup, "which_key_delay_ms", 5);
  assert.deepEqual((await startup.get_config()).settings, { hint_letters: "ab", which_key_delay_ms: 5 });
});

test("a failed store of the files config rolls the publish back", async () => {
  const host = { files: settings_file('hint_letters = "ab"\n') };
  const { local, fake } = install_fake_browser(host);
  const startup = await fresh_startup("store_fails");
  await startup.get_config();
  const tree_before = structuredClone(local[COMPILED_KEYMAP_STORAGE_KEY]);
  const working = fake.storage.local.set;
  fake.storage.local.set = async (values) => {
    if (FILES_CONFIG_STORAGE_KEY in values) throw new Error("disk full");
    return working(values);
  };
  await assert.rejects(startup.reload_config(), /disk full/);
  fake.storage.local.set = working;
  assert.equal((await startup.get_config()).settings.hint_letters, undefined);
  assert.deepEqual(local[COMPILED_KEYMAP_STORAGE_KEY], tree_before);
  assert.equal(status_of(local).source, "defaults");
});

test("a tab opened while the reload runs is told about the new tree", async () => {
  const host: { files: Files; reply?: () => Promise<unknown> } = { files: settings_file('hint_letters = "ab"\n') };
  const { tabs, told } = install_fake_browser(host);
  const startup = await fresh_startup("tab_opens");
  await startup.get_config();
  host.reply = async () => {
    tabs.push({ id: 42 });
    return { ok: true, config_dir: "/c", config_dir_exists: true, files: host.files };
  };
  await startup.reload_config();
  assert.ok(told.includes(42));
});

for (const [name, host_setup, expected] of [
  ["the host is missing", { reply: async () => Promise.reject(new Error("No such native application desertfox_host")) }, /not installed.*:native\.install/],
  ["the permission is not granted", { granted: false }, /no permission.*:native\.install/],
  ["the host refuses", { reply: async () => ({ ok: false, error: "reply too large" }) }, /refused: reply too large/],
  ["the config folder is missing", { reply: async () => ({ ok: true, config_dir: "/nope", config_dir_exists: false, files: {} }) }, /no config folder at \/nope/],
] as const) {
  test(`a reload where ${name} keeps the current config and says why`, async () => {
    const host = { files: settings_file('hint_letters = "ab"\n'), ...host_setup };
    const { local } = install_fake_browser(host);
    const startup = await fresh_startup(`refused_${name}`);
    await startup.get_config();
    const tree_before = structuredClone(local[COMPILED_KEYMAP_STORAGE_KEY]);
    const refusal = await startup.reload_config().then(
      () => assert.fail("the reload did not refuse"),
      (error: unknown) => error,
    );
    assert.ok(refusal instanceof ConfigRefusal, String(refusal));
    assert.match(refusal.message, /^Config not reloaded, the current one stays\./);
    assert.match(refusal.message, expected);
    assert.equal(local[FILES_CONFIG_STORAGE_KEY], undefined);
    assert.deepEqual(local[COMPILED_KEYMAP_STORAGE_KEY], tree_before);
  });
}

test("a reload with problems in the files keeps the current config and names the problems", async () => {
  const host = { files: settings_file('hint_letters = "ab"\n') };
  const { local } = install_fake_browser(host);
  const startup = await fresh_startup("problems");
  await startup.get_config();
  await startup.reload_config();
  host.files = { "settings.toml": "hint_letters = \n", "notes.txt": "" };
  await assert.rejects(startup.reload_config(), (error: Error) => {
    assert.ok(error instanceof ConfigRefusal);
    assert.match(error.message, /Fix the files and reload again\. 2 problem\(s\)/);
    assert.match(error.message, /settings\.toml:1/);
    assert.match(error.message, /notes\.txt: unknown file/);
    return true;
  });
  assert.equal((await startup.get_config()).settings.hint_letters, "ab");
  assert.equal(status_of(local).source, "files");
});

test("the build skips autoconfig.toml, which the host writes beside the files", async () => {
  const host = { files: { ...settings_file('hint_letters = "ab"\n'), "autoconfig.toml": "hint_letters = 1\n" } };
  install_fake_browser(host);
  const startup = await fresh_startup("autoconfig_skipped");
  await startup.get_config();
  await startup.reload_config();
  assert.equal((await startup.get_config()).settings.hint_letters, "ab");
});

test("a change to the saved edits writes autoconfig.toml, and a temp change does not", async () => {
  const host = { files: {} };
  const { sent, local } = install_fake_browser(host);
  const startup = await fresh_startup("mirror_on_save");
  await startup.get_config();
  await startup.change_edits((current) => ({ ...current, saved: { hint_letters: "xy" } }));
  await set_temp(startup, "which_key_delay_ms", 3);
  // The mirror runs after the edit returns, so wait for its turn.
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(sent, [{ cmd: "write_autoconfig", toml: 'hint_letters = "xy"\n' }]);
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { hint_letters: "xy" });
});

test("a host failure on the autoconfig write keeps the edit and warns once", async () => {
  const host = { files: {}, reply: async () => Promise.reject(new Error("No such native application desertfox_host")) };
  const { local } = install_fake_browser(host);
  const warnings: unknown[] = [];
  const original_warn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
  try {
    const startup = await fresh_startup("mirror_fails");
    await startup.get_config();
    await startup.change_edits((current) => ({ ...current, saved: { hint_letters: "xy" } }));
    await startup.change_edits((current) => ({ ...current, saved: { hint_letters: "zz" } }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { hint_letters: "zz" });
    assert.equal((await startup.get_config()).settings.hint_letters, "zz");
    assert.equal(warnings.filter((line) => /autoconfig\.toml not written/.test(String(line))).length, 1);
  } finally {
    console.warn = original_warn;
  }
});

test("the mirror writes in order, keeps quiet without the permission, and warns once per kind of failure", async () => {
  const written: string[] = [];
  const warned: string[] = [];
  let fail_with: Error | undefined;
  const mirror = create_autoconfig_mirror({
    write_autoconfig: async (toml) => {
      // An early write that takes longer must still land before a later one.
      if (toml.includes("slow")) await new Promise((resolve) => setTimeout(resolve, 15));
      if (fail_with) throw fail_with;
      written.push(toml);
    },
    warn: (message) => void warned.push(message),
  });
  await Promise.all([mirror.mirror({ hint_letters: "slow" }), mirror.mirror({ hint_letters: "fast" })]);
  assert.deepEqual(written, ['hint_letters = "slow"\n', 'hint_letters = "fast"\n']);

  fail_with = new NativeHostError("no_permission", "no permission");
  await mirror.mirror({});
  assert.deepEqual(warned, []);
  fail_with = new NativeHostError("host_missing", "not installed");
  await mirror.mirror({});
  await mirror.mirror({});
  fail_with = new Error("odd");
  await mirror.mirror({});
  assert.equal(warned.length, 2);
  fail_with = undefined;
  await mirror.mirror({ hint_letters: "back" });
  assert.equal(written.at(-1), 'hint_letters = "back"\n');
});

test("a reader during the swap waits for the commit and sees the config that matches the registry", async () => {
  const host = { files: { "snippets/a.js": snippet_file("gap.old") } as Files };
  const { fake } = install_fake_browser(host);
  const startup = await fresh_startup("swap_gap");
  await startup.get_config();
  await startup.reload_config();
  host.files = { "snippets/b.js": snippet_file("gap.new") };
  const working = fake.tabs.query;
  let slow_next = true;
  fake.tabs.query = async () => {
    if (slow_next) {
      slow_next = false;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return working();
  };
  const reload = startup.reload_config();
  // The reload is now inside its slow publish: the registry already holds gap.new and not gap.old.
  await new Promise((resolve) => setTimeout(resolve, 10));
  const read = await startup.get_config();
  const snippet_ids = read.snippets.map((snippet) => snippet.id);
  assert.deepEqual(snippet_ids, ["gap.new"]);
  assert.ok(registry.get("gap.new"));
  await reload;
});

test("a reader during a swap that fails gets the old config back", async () => {
  const host = { files: settings_file('hint_letters = "ab"\n') };
  const { fake } = install_fake_browser(host);
  const startup = await fresh_startup("swap_gap_fails");
  await startup.get_config();
  await startup.reload_config();
  host.files = settings_file('hint_letters = "cd"\n');
  const working = fake.tabs.query;
  let calls = 0;
  fake.tabs.query = async () => {
    if (calls++ === 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error("tabs down");
    }
    return working();
  };
  const reload = startup.reload_config().catch((error: Error) => error);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await startup.get_config()).settings.hint_letters, "ab");
  assert.match(String(await reload), /tabs down/);
});

test("the reload counts every warning the help page shows, not only the load warnings", async () => {
  // Eleven browser chords for ten shortcut slots: the slot plan warns, the build does not.
  const chords = Array.from({ length: 11 }, (_, index) => `"<A-F${index + 1}>" = "tab.next"`).join("\n");
  const host = { files: { "keymap.toml": `[browser]\n${chords}\n` } as Files };
  const { local } = install_fake_browser(host);
  const startup = await fresh_startup("all_warnings");
  await startup.get_config();
  const reloaded = await startup.reload_config();
  const shown = local[WARNINGS_STORAGE_KEY] as string[];
  assert.ok(shown.length > 0, "the case needs a warning from the publish");
  assert.equal(reloaded.warnings, shown.length);
});

test("the build warnings of a reload survive a restart", async () => {
  const host = { files: { "search_engines.toml": '[-dash]\nurl = "https://a.test/?q={query}"\n' } as Files };
  const { local } = install_fake_browser(host);
  const startup = await fresh_startup("warnings_restart");
  await startup.get_config();
  const reloaded = await startup.reload_config();
  assert.ok(reloaded.warnings >= 1);
  const after = await fresh_startup("warnings_restart_after");
  await after.get_config();
  const shown = local[WARNINGS_STORAGE_KEY] as string[];
  assert.ok(shown.some((warning) => /starts with "-"/.test(warning)), shown.join("\n"));
});

test("a saved value TOML cannot hold only warns, and the edit stays", async () => {
  const warned: string[] = [];
  const mirror = create_autoconfig_mirror({ write_autoconfig: async () => undefined, warn: (message) => void warned.push(message) });
  assert.doesNotThrow(() => mirror.mirror({ next_patterns: [, "a.com"] as unknown as string[] }));
  await mirror.mirror({ next_patterns: [, "a.com"] as unknown as string[] });
  assert.equal(warned.length, 1);
});

test("config.reload turns any other failure into a refusal that keeps the config and names the fix", async () => {
  const host = { files: settings_file('hint_letters = "ab"\n') };
  const { fake } = install_fake_browser(host);
  const working = fake.storage.local.set;
  fake.storage.local.set = async (values) => {
    if (FILES_CONFIG_STORAGE_KEY in values) throw new Error("disk full");
    return working(values);
  };
  const command = registry.get("config.reload")!;
  await assert.rejects(Promise.resolve(command.run!({ tab_id: undefined, window_id: 1, frame_id: 0, mode: "normal" }, {})), (error: Error) => {
    assert.ok(error instanceof RuntimeRefusal, String(error));
    assert.match(error.message, /^Config not reloaded, the current one stays: disk full\. Run config\.reload again, and debug\.restart if it keeps failing\.$/);
    return true;
  });
});
