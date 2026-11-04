import assert from "node:assert/strict";
import "../../src/background/command_modules.ts";
import { test } from "node:test";
import { build_config_status, checked_overrides, empty_config, with_overrides } from "../../src/background/config_load.ts";
import { apply_overrides, CONFIG_FORMAT_VERSION } from "../../src/shared/config.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../../src/shared/prefix_tree.ts";
import { CONFIG_STATUS_STORAGE_KEY, SETTING_OVERRIDES_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "../../src/background/storage_keys.ts";

test("an override wins over the config, and the rest of the config stays", () => {
  const settings = apply_overrides({ which_key_delay_ms: 100, hint_letters: "ab" }, { which_key_delay_ms: 900 });
  assert.deepEqual(settings, { which_key_delay_ms: 900, hint_letters: "ab" });
  const config = with_overrides({ ...empty_config(), settings: { hint_letters: "ab" } }, { newtab_date: false });
  assert.deepEqual(config.settings, { hint_letters: "ab", newtab_date: false });
});

test("stored overrides keep only what the schema accepts", () => {
  const stored = { which_key_delay_ms: 5, light_intensity: 9, nope: 1, search_prefixes: { here: "s", tab: "S" }, ignore_sites: ["a.com"] };
  assert.deepEqual(checked_overrides(stored), { which_key_delay_ms: 5, ignore_sites: ["a.com"] });
  assert.deepEqual(checked_overrides(undefined), {});
  assert.deepEqual(checked_overrides([1]), {});
});

test("the status tells a live change from a config file value", () => {
  const status = build_config_status("managed", { hint_letters: "ab", newtab_date: false }, { newtab_date: true, light_intensity: 2 }, "hint");
  assert.equal(status.settings.newtab_date, true);
  assert.equal(status.settings.light_intensity, 2);
  assert.deepEqual(status.overrides, ["newtab_date", "light_intensity"]);
  assert.deepEqual(status.configured, ["hint_letters", "newtab_date"]);
});

// A browser that keeps storage in memory. `config_file` is what the managed file holds, so a test can rewrite it between reloads.
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
  const sets = { session_writes: 0 };
  const session_area = area(session, 2);
  Object.assign(globalThis, {
    browser: {
      runtime: { id: "test@oasisfox" },
      storage: {
        local: area(local),
        managed: { get: async () => config_file.value },
        session: { get: session_area.get, set: async (values: Record<string, unknown>) => (sets.session_writes++, session_area.set(values)) },
      },
      tabs: { query: async () => [], sendMessage: async () => undefined },
      contextualIdentities: { query: async () => [] },
      commands: { update: async () => undefined, reset: async () => undefined },
    },
  });
  return { local, session, sets };
}

const managed = (settings: Record<string, unknown>) => ({ format_version: CONFIG_FORMAT_VERSION, settings });
const stored_status = (local: Record<string, unknown>) => local[CONFIG_STATUS_STORAGE_KEY] as ReturnType<typeof build_config_status>;

// One process holds one background, so a "reload" is a second copy of the startup module over the same storage.
const fresh_startup = async (tag: string) => (await import(`../../src/background/startup.ts?${tag}`)) as typeof import("../../src/background/startup.ts");

test("get_config follows each :set and :unset, and storage.local follows it", async () => {
  const file = { value: managed({ hint_letters: "ab" }) };
  const { local } = install_fake_browser(file);
  const startup = await fresh_startup("memo");
  assert.equal((await startup.get_config()).settings.hint_letters, "ab");

  await startup.change_overrides((current) => ({ ...current, hint_letters: "xy", newtab_date: false }));
  const after_set = await startup.get_config();
  assert.deepEqual(after_set.settings, { hint_letters: "xy", newtab_date: false });
  assert.deepEqual(stored_status(local).overrides, ["hint_letters", "newtab_date"]);
  assert.deepEqual(stored_status(local).configured, ["hint_letters"]);
  assert.equal(stored_status(local).settings.hint_letters, "xy");

  await startup.change_overrides(({ hint_letters: _dropped, ...rest }) => rest);
  assert.deepEqual((await startup.get_config()).settings, { hint_letters: "ab", newtab_date: false });

  await startup.change_overrides(() => ({}));
  assert.deepEqual((await startup.get_config()).settings, { hint_letters: "ab" });
  assert.deepEqual(stored_status(local).overrides, []);
  assert.ok(Array.isArray(local[WARNINGS_STORAGE_KEY]));
});

test("a decision that returns nothing writes and publishes nothing", async () => {
  const file = { value: managed({}) };
  const { sets, local } = install_fake_browser(file);
  const startup = await fresh_startup("noop");
  await startup.get_config();
  const keymap_before = local[COMPILED_KEYMAP_STORAGE_KEY];
  await startup.change_overrides(() => undefined);
  assert.equal(sets.session_writes, 0);
  assert.deepEqual(local[COMPILED_KEYMAP_STORAGE_KEY], keymap_before);
});

test("two changes started together both land: each reads what the other wrote", async () => {
  const file = { value: managed({}) };
  const { session } = install_fake_browser(file);
  const startup = await fresh_startup("queue");
  await Promise.all([
    startup.change_overrides((current) => ({ ...current, hint_letters: "xy" })),
    startup.change_overrides((current) => ({ ...current, newtab_date: false })),
    startup.change_overrides((current) => ({ ...current, which_key_delay_ms: 7 })),
  ]);
  assert.deepEqual(session[SETTING_OVERRIDES_STORAGE_KEY], { hint_letters: "xy", newtab_date: false, which_key_delay_ms: 7 });
  assert.deepEqual((await startup.get_config()).settings, { hint_letters: "xy", newtab_date: false, which_key_delay_ms: 7 });
});

test("a change that throws leaves the overrides and the later changes alone", async () => {
  const file = { value: managed({}) };
  const { session } = install_fake_browser(file);
  const startup = await fresh_startup("throws");
  const refused = startup.change_overrides(() => {
    throw new Error("refused");
  });
  const accepted = startup.change_overrides((current) => ({ ...current, newtab_date: false }));
  await assert.rejects(refused, /refused/);
  await accepted;
  assert.deepEqual(session[SETTING_OVERRIDES_STORAGE_KEY], { newtab_date: false });
});

test("a reload with an override set: the new load reads the file again and the override still wins", async () => {
  const file = { value: managed({ hint_letters: "ab", which_key_delay_ms: 100 }) };
  const { local } = install_fake_browser(file);
  const before = await fresh_startup("reload_before");
  await before.change_overrides((current) => ({ ...current, hint_letters: "xy" }));

  // settings.toml changes on disk, then the reload starts a new background over the same session storage.
  file.value = managed({ hint_letters: "cd", which_key_delay_ms: 200 });
  const after = await fresh_startup("reload_after");
  const settings = (await after.get_config()).settings;
  assert.equal(settings.hint_letters, "xy");
  assert.equal(settings.which_key_delay_ms, 200);
  assert.deepEqual(stored_status(local).overrides, ["hint_letters"]);

  await after.change_overrides(({ hint_letters: _dropped, ...rest }) => rest);
  assert.equal((await after.get_config()).settings.hint_letters, "cd");
});

test("a :set that is still writing when the reload starts leaves one consistent value", async () => {
  const file = { value: managed({ hint_letters: "ab" }) };
  const { session } = install_fake_browser(file);
  const old_background = await fresh_startup("race_before");
  await old_background.get_config();
  const pending = old_background.change_overrides((current) => ({ ...current, hint_letters: "xy" }));
  file.value = managed({ hint_letters: "cd" });
  const new_background = await fresh_startup("race_after");
  const first_read = (await new_background.get_config()).settings.hint_letters;
  await pending;
  // Whether the new load saw the write or not, the stored value and a later load agree.
  assert.ok(first_read === "xy" || first_read === "cd");
  assert.deepEqual(session[SETTING_OVERRIDES_STORAGE_KEY], { hint_letters: "xy" });
  const later = await fresh_startup("race_later");
  assert.equal((await later.get_config()).settings.hint_letters, "xy");
});

test("a stored override that no longer passes is ignored at load", async () => {
  const file = { value: managed({}) };
  const { session } = install_fake_browser(file);
  session[SETTING_OVERRIDES_STORAGE_KEY] = { light_intensity: 9, newtab_date: false };
  const startup = await fresh_startup("stale");
  assert.deepEqual((await startup.get_config()).settings, { newtab_date: false });
});
