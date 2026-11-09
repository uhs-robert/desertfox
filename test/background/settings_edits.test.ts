import assert from "node:assert/strict";
import "../../src/background/command_modules.ts";
import { test } from "node:test";
import { build_config_status, checked_edit_layer, empty_config, with_edits } from "../../src/background/config_load.ts";
import { apply_edits, CONFIG_FORMAT_VERSION } from "../../src/shared/config.ts";
import type { SettingOverrides } from "../../src/shared/config.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../../src/shared/prefix_tree.ts";
import { CONFIG_STATUS_STORAGE_KEY, FILES_CONFIG_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, TEMP_SETTINGS_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "../../src/background/storage_keys.ts";

test("an edit wins over the config, a temp edit wins over a saved one, and the rest of the config stays", () => {
  const settings = apply_edits({ which_key_delay_ms: 100, hint_letters: "ab" }, { saved: { which_key_delay_ms: 500, light_intensity: 2 }, temp: { which_key_delay_ms: 900 } });
  assert.deepEqual(settings, { which_key_delay_ms: 900, hint_letters: "ab", light_intensity: 2 });
  const config = with_edits({ ...empty_config(), settings: { hint_letters: "ab" } }, { saved: { newtab_date: false }, temp: {} });
  assert.deepEqual(config.settings, { hint_letters: "ab", newtab_date: false });
});

test("a stored edit layer keeps only what the schema accepts", () => {
  const stored = { which_key_delay_ms: 5, light_intensity: 9, nope: 1, search_prefixes: { here: "s", tab: "S" }, next_patterns: ["a.com"] };
  assert.deepEqual(checked_edit_layer(stored), { which_key_delay_ms: 5, next_patterns: ["a.com"] });
  assert.deepEqual(checked_edit_layer(undefined), {});
  assert.deepEqual(checked_edit_layer([1]), {});
});

test("the status tells each edit layer from a config file value", () => {
  const status = build_config_status("files", { hint_letters: "ab", newtab_date: false }, { saved: { light_intensity: 2 }, temp: { newtab_date: true } });
  assert.equal(status.settings.newtab_date, true);
  assert.equal(status.settings.light_intensity, 2);
  assert.deepEqual(status.saved, ["light_intensity"]);
  assert.deepEqual(status.temp, ["newtab_date"]);
  assert.deepEqual(status.configured, ["hint_letters", "newtab_date"]);
});

// A browser that keeps storage in memory. `config_file` is the config the stored files slot holds, so a test can rewrite it between reloads.
function install_fake_browser(config_file: { value: unknown }) {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const area = (store: Record<string, unknown>, delay_ms = 0) => ({
    get: async (key?: string | string[]) => {
      const keys = key === undefined ? Object.keys(store) : [key].flat();
      return Object.fromEntries(keys.filter((name) => name in store).map((name) => [name, structuredClone(store[name])]));
    },
    set: async (values: Record<string, unknown>) => {
      if (delay_ms > 0) await new Promise((resolve) => setTimeout(resolve, delay_ms));
      Object.assign(store, structuredClone(values));
    },
  });
  const local_area = area(local);
  // Rewriting `config_file` models a `config.reload` that stored new files.
  const files_slot = (key?: string | string[]) => ([key].flat().includes(FILES_CONFIG_STORAGE_KEY) ? { [FILES_CONFIG_STORAGE_KEY]: { config: config_file.value, warnings: [] } } : {});
  const sets = { session_writes: 0 };
  const session_area = area(session, 2);
  Object.assign(globalThis, {
    browser: {
      runtime: { id: "test@desertfox" },
      // No native permission, so the autoconfig mirror stays quiet and writes nothing.
      permissions: { contains: async () => false },
      storage: {
        local: { ...local_area, get: async (key?: string | string[]) => ({ ...(await local_area.get(key)), ...files_slot(key) }) },
        session: { get: session_area.get, set: async (values: Record<string, unknown>) => (sets.session_writes++, session_area.set(values)) },
      },
      tabs: { query: async () => [], sendMessage: async () => undefined },
      contextualIdentities: { query: async () => [] },
      commands: { update: async () => undefined, reset: async () => undefined },
    },
  });
  return { local, session, sets };
}

const files_config = (settings: Record<string, unknown>) => ({ format_version: CONFIG_FORMAT_VERSION, settings });
const stored_status = (local: Record<string, unknown>) => local[CONFIG_STATUS_STORAGE_KEY] as ReturnType<typeof build_config_status>;

type Startup = typeof import("../../src/background/startup.ts");

// Most cases need one layer, so this runs `decide` on the temp edits and keeps the saved ones.
const change_temp = (startup: Startup, decide: (temp: SettingOverrides) => SettingOverrides | undefined) =>
  startup.change_edits((current) => {
    const temp = decide(current.temp);
    return temp && { ...current, temp };
  });

// One process holds one background, so a "reload" is a second copy of the startup module over the same storage.
const fresh_startup = async (tag: string) => (await import(`../../src/background/startup.ts?${tag}`)) as typeof import("../../src/background/startup.ts");

test("get_config follows each :set and :unset, and storage.local follows it", async () => {
  const file = { value: files_config({ hint_letters: "ab" }) };
  const { local } = install_fake_browser(file);
  const startup = await fresh_startup("memo");
  assert.equal((await startup.get_config()).settings.hint_letters, "ab");

  await change_temp(startup, (current) => ({ ...current, hint_letters: "xy", newtab_date: false }));
  const after_set = await startup.get_config();
  assert.deepEqual(after_set.settings, { hint_letters: "xy", newtab_date: false });
  assert.deepEqual(stored_status(local).temp, ["hint_letters", "newtab_date"]);
  assert.deepEqual(stored_status(local).configured, ["hint_letters"]);
  assert.equal(stored_status(local).settings.hint_letters, "xy");

  await change_temp(startup, ({ hint_letters: _dropped, ...rest }) => rest);
  assert.deepEqual((await startup.get_config()).settings, { hint_letters: "ab", newtab_date: false });

  await change_temp(startup, () => ({}));
  assert.deepEqual((await startup.get_config()).settings, { hint_letters: "ab" });
  assert.deepEqual(stored_status(local).temp, []);
  assert.ok(Array.isArray(local[WARNINGS_STORAGE_KEY]));
});

test("a decision that returns nothing writes and publishes nothing", async () => {
  const file = { value: files_config({}) };
  const { sets, local } = install_fake_browser(file);
  const startup = await fresh_startup("noop");
  await startup.get_config();
  const keymap_before = local[COMPILED_KEYMAP_STORAGE_KEY];
  await change_temp(startup, () => undefined);
  assert.equal(sets.session_writes, 0);
  assert.deepEqual(local[COMPILED_KEYMAP_STORAGE_KEY], keymap_before);
});

test("two changes started together both land: each reads what the other wrote", async () => {
  const file = { value: files_config({}) };
  const { session } = install_fake_browser(file);
  const startup = await fresh_startup("queue");
  await Promise.all([
    change_temp(startup, (current) => ({ ...current, hint_letters: "xy" })),
    change_temp(startup, (current) => ({ ...current, newtab_date: false })),
    change_temp(startup, (current) => ({ ...current, which_key_delay_ms: 7 })),
  ]);
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], { hint_letters: "xy", newtab_date: false, which_key_delay_ms: 7 });
  assert.deepEqual((await startup.get_config()).settings, { hint_letters: "xy", newtab_date: false, which_key_delay_ms: 7 });
});

test("a change that throws leaves the edits and the later changes alone", async () => {
  const file = { value: files_config({}) };
  const { session } = install_fake_browser(file);
  const startup = await fresh_startup("throws");
  const refused = change_temp(startup, () => {
    throw new Error("refused");
  });
  const accepted = change_temp(startup, (current) => ({ ...current, newtab_date: false }));
  await assert.rejects(refused, /refused/);
  await accepted;
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], { newtab_date: false });
});

// Only a model of a restart that keeps `storage.session`. `config.reload` clears it in Firefox, by design, so a live change does not survive a reload.
test("a background restart that keeps session storage re-reads the file and the temp edit still wins", async () => {
  const file = { value: files_config({ hint_letters: "ab", which_key_delay_ms: 100 }) };
  const { local } = install_fake_browser(file);
  const before = await fresh_startup("reload_before");
  await change_temp(before, (current) => ({ ...current, hint_letters: "xy" }));

  // settings.toml changes on disk, then the reload starts a new background over the same session storage.
  file.value = files_config({ hint_letters: "cd", which_key_delay_ms: 200 });
  const after = await fresh_startup("reload_after");
  const settings = (await after.get_config()).settings;
  assert.equal(settings.hint_letters, "xy");
  assert.equal(settings.which_key_delay_ms, 200);
  assert.deepEqual(stored_status(local).temp, ["hint_letters"]);

  await change_temp(after, ({ hint_letters: _dropped, ...rest }) => rest);
  assert.equal((await after.get_config()).settings.hint_letters, "cd");
});

test("a :set that is still writing when the reload starts leaves one consistent value", async () => {
  const file = { value: files_config({ hint_letters: "ab" }) };
  const { session } = install_fake_browser(file);
  const old_background = await fresh_startup("race_before");
  await old_background.get_config();
  // Imported first: the new load must then run on microtasks alone, before the old write's timer fires.
  const new_background = await fresh_startup("race_after");
  const pending = change_temp(old_background, (current) => ({ ...current, hint_letters: "xy" }));
  file.value = files_config({ hint_letters: "cd" });
  const first_read = (await new_background.get_config()).settings.hint_letters;
  await pending;
  // The new load started before the write landed, so it shows the file value. The stored value and a later load show the edit.
  assert.equal(first_read, "cd");
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], { hint_letters: "xy" });
  const later = await fresh_startup("race_later");
  assert.equal((await later.get_config()).settings.hint_letters, "xy");
});

test("a stored edit that no longer passes is ignored at load", async () => {
  const file = { value: files_config({}) };
  const { session } = install_fake_browser(file);
  session[TEMP_SETTINGS_STORAGE_KEY] = { light_intensity: 9, newtab_date: false };
  const startup = await fresh_startup("stale");
  assert.deepEqual((await startup.get_config()).settings, { newtab_date: false });
});

test("a failed publish puts the stored edits back", async () => {
  const file = { value: files_config({}) };
  const { session, local } = install_fake_browser(file);
  const startup = await fresh_startup("rollback");
  await change_temp(startup, () => ({ newtab_date: false }));
  const browser_stub = (globalThis as unknown as { browser: { tabs: { query: () => Promise<never> } } }).browser;
  const working = browser_stub.tabs.query;
  browser_stub.tabs.query = async () => {
    throw new Error("tabs down");
  };
  await assert.rejects(change_temp(startup, (current) => ({ ...current, hint_letters: "xy" })), /tabs down/);
  browser_stub.tabs.query = working;
  assert.deepEqual(stored_status(local).temp, ["newtab_date"]);
  assert.equal(stored_status(local).settings.hint_letters, "asdfghjkl");
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], { newtab_date: false });
  assert.deepEqual((await startup.get_config()).settings, { newtab_date: false });
});

test("a saved edit lands in storage.local, survives a restart that clears session storage, and loses to a temp edit", async () => {
  const file = { value: files_config({ hint_letters: "ab" }) };
  const { local, session } = install_fake_browser(file);
  const before = await fresh_startup("saved_before");
  await before.change_edits((current) => ({ ...current, saved: { hint_letters: "xy" } }));
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { hint_letters: "xy" });
  await change_temp(before, () => ({ hint_letters: "qw" }));
  assert.equal((await before.get_config()).settings.hint_letters, "qw");
  assert.deepEqual(stored_status(local).saved, ["hint_letters"]);

  // A browser restart clears storage.session and keeps storage.local.
  for (const key of Object.keys(session)) delete session[key];
  const after = await fresh_startup("saved_after");
  assert.equal((await after.get_config()).settings.hint_letters, "xy");
  assert.deepEqual(stored_status(local).temp, []);
});

test("a bad setting in the config file is dropped with a warning, so the default applies", async () => {
  const file = { value: files_config({ newtab_recent_tabs_max: null, light_intensity: 9, nope: 1, hint_letters: "ab" }) };
  const { local } = install_fake_browser(file);
  const startup = await fresh_startup("bad_file_setting");
  assert.deepEqual((await startup.get_config()).settings, { hint_letters: "ab" });
  const warnings = local[WARNINGS_STORAGE_KEY] as string[];
  assert.ok(warnings.some((warning) => /setting newtab_recent_tabs_max skipped, expected/.test(warning)), warnings.join("\n"));
  assert.ok(warnings.some((warning) => /setting light_intensity skipped, expected a whole number from 1 to 5/.test(warning)));
  assert.ok(warnings.some((warning) => /setting nope skipped, no setting has that name/.test(warning)));
});

test("a failed write of one layer puts both layers back", async () => {
  const file = { value: files_config({}) };
  const { local, session } = install_fake_browser(file);
  const startup = await fresh_startup("half_write");
  await change_temp(startup, () => ({ newtab_date: false }));
  const local_area = (globalThis as unknown as { browser: { storage: { local: { set: (values: Record<string, unknown>) => Promise<void> } } } }).browser.storage.local;
  const working = local_area.set;
  local_area.set = async (values) => {
    if (SAVED_SETTINGS_STORAGE_KEY in values && (values[SAVED_SETTINGS_STORAGE_KEY] as Record<string, unknown>).hint_letters === "xy") throw new Error("disk full");
    return working(values);
  };
  await assert.rejects(startup.change_edits(() => ({ saved: { hint_letters: "xy" }, temp: { which_key_delay_ms: 7 } })), /disk full/);
  local_area.set = working;
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], { newtab_date: false });
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  assert.deepEqual((await startup.get_config()).settings, { newtab_date: false });
});

test("a saved site rule list survives the load, since the popup saves it", () => {
  const rules = [{ site: "*://*.a.test/*" }, { site: "*://b.test/*", pass: "j" }];
  assert.deepEqual(checked_edit_layer({ site_rules: rules }), { site_rules: rules });
  assert.deepEqual(checked_edit_layer({ site_rules: [{ site: "*://b.test/*", pass: "j", only: "k" }] }), {});
});
