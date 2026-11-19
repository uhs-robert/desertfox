import assert from "node:assert/strict";
import "../../src/background/command_modules.ts";
import { test } from "node:test";
import { load_effective_config } from "../../src/background/config_load.ts";
import { create_settings_messages } from "../../src/background/settings_message.ts";
import { FILES_SOURCE_STORAGE_KEY, HOST_START_KEPT_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY, TEMP_SETTINGS_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import { load_theme } from "../../src/shared/theme/load.ts";
import { files_digest } from "../../src/background/host_start.ts";
import { install_fake_browser, type Files } from "./config_fake_browser.ts";

type Startup = typeof import("../../src/background/startup.ts");
let fresh_count = 0;
const fresh_startup = async () => (await import(`../../src/background/startup.ts?settings_file_${fresh_count++}`)) as Startup;

const MINE = '# My settings\n\nhint_letters = "abc" # home row\n\n# Rules\n[[site_rules]]\nsite = "*://x.test/*"\noff = true\n';
const with_theme = (theme: string) => MINE.replace('hint_letters = "abc" # home row\n', `hint_letters = "abc" # home row\ntheme = "${theme}"\n`);

// `apply_files` drops the record by storing null in its one storage write.
const unsynced_of = (local: Record<string, unknown>) => local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] ?? undefined;
const stored_settings = (local: Record<string, unknown>) => (local[FILES_SOURCE_STORAGE_KEY] as { files: Files }).files["settings.toml"];

// A profile that read the folder once through the host, as after `,r`.
async function reloaded(host: { files: Files; granted?: boolean; old_host?: boolean }) {
  const fake = install_fake_browser(host);
  const startup = await fresh_startup();
  await startup.get_config();
  await startup.reload_config();
  return { ...fake, startup };
}

test("a pick writes the browser copy and the folder, keeps every comment, and drops a saved and a temp theme", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, session, startup } = await reloaded(host);
  await startup.change_edits(() => ({ saved: { theme: "nord", which_key_delay_ms: 5 }, temp: { theme: "dracula" } }));

  assert.deepEqual(await startup.set_in_settings_file("theme", "oasis_night"), { kind: "written" });
  assert.equal(host.files["settings.toml"], with_theme("oasis_night"));
  assert.equal(stored_settings(local), with_theme("oasis_night"));
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { which_key_delay_ms: 5 });
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], {});
  assert.equal((await startup.get_config()).settings.theme, "oasis_night");
  assert.equal(unsynced_of(local), undefined);
});

test("after a written pick a restart asks nothing, and a hand edit after it applies at the next start", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, startup } = await reloaded(host);
  await startup.set_in_settings_file("theme", "oasis_night");

  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
  assert.equal((await restarted.get_config()).settings.theme, "oasis_night");

  // The applied digest moved with the write, so the copy still counts as unedited and a later folder edit applies at once.
  host.files = { "settings.toml": with_theme("nord") };
  const third = await fresh_startup();
  await third.reload_config_at_start();
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
  assert.equal((await third.get_config()).settings.theme, "nord");
});

test("`,r` after a written pick keeps the pick", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { startup } = await reloaded(host);
  await startup.set_in_settings_file("theme", "oasis_night");
  await startup.reload_config();
  assert.equal((await startup.get_config()).settings.theme, "oasis_night");
});

test("a hand edit since the last read is never overwritten: the folder stays, and the copies-differ question is stored", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, startup } = await reloaded(host);
  host.files = { "settings.toml": MINE.replace('"abc"', '"hand"') };

  assert.deepEqual(await startup.set_in_settings_file("theme", "oasis_night"), { kind: "conflict" });
  assert.equal(host.files["settings.toml"], MINE.replace('"abc"', '"hand"'));
  assert.equal(stored_settings(local), with_theme("oasis_night"));
  assert.notEqual(local[HOST_START_PENDING_STORAGE_KEY], undefined);
  assert.equal(unsynced_of(local), undefined);
});

test("without the native host the browser copy changes, nothing throws, and the next start with the host writes the file", async () => {
  const host = { files: { "settings.toml": MINE }, granted: true };
  const { local, sent, startup } = await reloaded(host);
  host.granted = false;
  sent.length = 0;

  assert.deepEqual(await startup.set_in_settings_file("theme", "oasis_night"), { kind: "waiting" });
  assert.equal(stored_settings(local), with_theme("oasis_night"));
  assert.equal(host.files["settings.toml"], MINE);
  assert.deepEqual(sent, []);

  host.granted = true;
  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.equal(host.files["settings.toml"], with_theme("oasis_night"));
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
  assert.equal(unsynced_of(local), undefined);
  assert.equal((await restarted.get_config()).settings.theme, "oasis_night");
});

test("an older host without the verb keeps the pick, asks nothing at start, and the updated host writes it", async () => {
  const host = { files: { "settings.toml": MINE }, old_host: true };
  const { local, startup } = await reloaded(host);

  assert.deepEqual(await startup.set_in_settings_file("theme", "oasis_night"), { kind: "waiting" });
  assert.equal(host.files["settings.toml"], MINE);

  const still_old = await fresh_startup();
  await still_old.reload_config_at_start();
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
  assert.equal((await still_old.get_config()).settings.theme, "oasis_night");

  host.old_host = false;
  const updated = await fresh_startup();
  await updated.reload_config_at_start();
  assert.equal(host.files["settings.toml"], with_theme("oasis_night"));
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a waiting pick meets a hand edit at start: nothing is written and the start asks", async () => {
  const host = { files: { "settings.toml": MINE }, old_host: true };
  const { local, startup } = await reloaded(host);
  await startup.set_in_settings_file("theme", "oasis_night");

  host.old_host = false;
  host.files = { "settings.toml": MINE.replace('"abc"', '"hand"') };
  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.equal(host.files["settings.toml"], MINE.replace('"abc"', '"hand"'));
  assert.notEqual(local[HOST_START_PENDING_STORAGE_KEY], undefined);
  assert.equal((await restarted.get_config()).settings.theme, "oasis_night");
});

test("`,r` with a pick the old host cannot write lets the folder win, as `,r` always does", async () => {
  const host = { files: { "settings.toml": MINE }, old_host: true };
  const { local, startup } = await reloaded(host);
  await startup.set_in_settings_file("theme", "oasis_night");
  await startup.reload_config();
  assert.equal(stored_settings(local), MINE);
  assert.equal(unsynced_of(local), undefined);
});

test("two quick picks in a row: the last one wins in the browser copy and in the file", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, startup } = await reloaded(host);
  const first = startup.set_in_settings_file("theme", "nord");
  const second = startup.set_in_settings_file("theme", "oasis_night");
  assert.deepEqual(await Promise.all([first, second]), [{ kind: "written" }, { kind: "written" }]);
  assert.equal(host.files["settings.toml"], with_theme("oasis_night"));
  assert.equal(stored_settings(local), with_theme("oasis_night"));
});

test("two quick picks while the host is old: the later write starts from the folder's text and the last pick lands", async () => {
  const host = { files: { "settings.toml": MINE }, old_host: true };
  const { local, startup } = await reloaded(host);
  await Promise.all([startup.set_in_settings_file("theme", "nord"), startup.set_in_settings_file("theme", "oasis_night")]);
  assert.deepEqual(unsynced_of(local), { base: MINE });
  host.old_host = false;
  await (await fresh_startup()).reload_config_at_start();
  assert.equal(host.files["settings.toml"], with_theme("oasis_night"));
});

test("a folder without settings.toml gets one, and the pick builds", async () => {
  const host = { files: { "keymap.toml": "" } as Files };
  const { startup } = await reloaded(host);
  assert.deepEqual(await startup.set_in_settings_file("theme", "oasis_night"), { kind: "written" });
  assert.equal(host.files["settings.toml"], 'theme = "oasis_night"\n');
});

test("a theme set in settings.d is refused, and nothing changes", async () => {
  const host = { files: { "settings.toml": MINE, "settings.d/10-theme.toml": 'theme = "nord"\n' } };
  const { local, startup } = await reloaded(host);
  await assert.rejects(startup.set_in_settings_file("theme", "oasis_night"), (error: unknown) => error instanceof RuntimeRefusal && /settings\.d\/10-theme\.toml sets theme/.test(error.message));
  assert.equal(stored_settings(local), MINE);
  assert.equal(host.files["settings.toml"], MINE);
});

test("the settings message takes layer file for theme only and says where the value went", async () => {
  const host = { files: { "settings.toml": MINE }, granted: true };
  const { startup } = await reloaded(host);
  const messages = create_settings_messages({ change_edits: startup.change_edits, read_layers: load_effective_config, read_theme_names: async () => [], set_in_file: startup.set_in_settings_file });

  const written = await messages.change({ type: "change_setting", name: "theme", action: "set", value: "oasis_night", layer: "file" });
  assert.ok(written.ok, written.message);
  assert.equal(written.message, 'theme = "oasis_night", saved to settings.toml');
  assert.equal(written.setting.top_layer, "settings.toml");

  host.granted = false;
  const waiting = await messages.change({ type: "change_setting", name: "theme", action: "set", value: "nord", layer: "file" });
  assert.ok(waiting.ok);
  assert.equal(waiting.message, 'theme = "nord". settings.toml updates when the native host connects');

  const other = await messages.change({ type: "change_setting", name: "hint_letters", action: "set", value: "qw", layer: "file" });
  assert.deepEqual(other, { ok: false, message: "hint_letters is not written to settings.toml yet" });
});

test("a theme name the files build does not know is refused before anything is stored or sent", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, sent, startup } = await reloaded(host);
  sent.length = 0;
  await assert.rejects(startup.set_in_settings_file("theme", "only_in_the_browser"), /no theme named "only_in_the_browser"/);
  assert.equal(stored_settings(local), MINE);
  assert.equal(unsynced_of(local), undefined);
  assert.deepEqual(sent, []);
});

// An import of the nord colors under a name of its own, as the settings page's importer stores it.
const imported_theme = () => load_theme("nord", 3)!;

test("an imported theme, which the files cannot name, goes to the saved edits and the file stays as it was", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, session, sent, startup } = await reloaded(host);
  await startup.change_layers("themes", () => ({ my_import: imported_theme() }));
  await startup.change_edits((current) => ({ ...current, temp: { theme: "dracula" } }));
  sent.length = 0;

  assert.deepEqual(await startup.set_in_settings_file("theme", "my_import"), { kind: "saved_in_browser" });
  assert.equal(host.files["settings.toml"], MINE);
  assert.equal(stored_settings(local), MINE);
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { theme: "my_import" });
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], {});
  assert.equal(unsynced_of(local), undefined);
  assert.ok(!sent.some((message) => message.cmd === "write_settings"));
  assert.equal((await startup.get_config()).settings.theme, "my_import");

  // A theme the files know goes to the file again and drops that saved edit.
  assert.deepEqual(await startup.set_in_settings_file("theme", "nord"), { kind: "written" });
  assert.equal(host.files["settings.toml"], with_theme("nord"));
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
});

test("an import that shares its name with a theme file goes to the file, which the build knows", async () => {
  const host = { files: { "settings.toml": MINE, "themes/shared.toml": '[dark]\nbg_core = "#101010"\nfg_core = "#eeeeee"\nprimary = "#88aaff"\naccent = "#ffcc66"\n' } };
  const { local, startup } = await reloaded(host);
  await startup.change_layers("themes", () => ({ shared: imported_theme() }));
  assert.deepEqual(await startup.set_in_settings_file("theme", "shared"), { kind: "written" });
  assert.equal(host.files["settings.toml"], with_theme("shared"));
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
});

test("the settings message says an imported theme is saved in the browser", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { startup } = await reloaded(host);
  await startup.change_layers("themes", () => ({ my_import: imported_theme() }));
  const messages = create_settings_messages({ change_edits: startup.change_edits, read_layers: load_effective_config, read_theme_names: async () => Object.keys(await startup.read_theme_edits()), set_in_file: startup.set_in_settings_file });
  const answer = await messages.change({ type: "change_setting", name: "theme", action: "set", value: "my_import", layer: "file" });
  assert.ok(answer.ok, answer.message);
  assert.equal(answer.message, 'theme = "my_import", saved in the browser because the theme is not in your files');
  assert.equal(answer.setting.top_layer, "saved");
});

test("the record of a lagging folder goes into the same storage write as the browser copy", async () => {
  const host = { files: { "settings.toml": MINE }, old_host: true };
  const { fake, startup } = await reloaded(host);
  const writes: string[][] = [];
  const set = fake.storage.local.set;
  fake.storage.local.set = async (values: Record<string, unknown>) => {
    writes.push(Object.keys(values));
    return set(values);
  };
  await startup.set_in_settings_file("theme", "oasis_night");
  const files_write = writes.find((keys) => keys.includes(FILES_SOURCE_STORAGE_KEY));
  assert.ok(files_write?.includes(SETTINGS_FILE_UNSYNCED_STORAGE_KEY) && files_write.includes(SAVED_SETTINGS_STORAGE_KEY), `the files went alone: ${JSON.stringify(writes)}`);
});

test("a failed edits write puts back the browser copy, the saved edits and the record", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, fake, startup } = await reloaded(host);
  await startup.change_edits(() => ({ saved: { theme: "nord" }, temp: {} }));
  const set = fake.storage.session.set;
  let failures = 1;
  fake.storage.session.set = async (values: Record<string, unknown>) => {
    if (failures-- > 0) throw new Error("session storage down");
    return set(values);
  };
  await assert.rejects(startup.set_in_settings_file("theme", "oasis_night"), /session storage down/);
  assert.equal(stored_settings(local), MINE);
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { theme: "nord" });
  assert.equal(unsynced_of(local), undefined);
  assert.equal(host.files["settings.toml"], MINE);
});

test("a refused write whose folder cannot be read again keeps the record and says it tries again", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, fake, startup } = await reloaded(host);
  host.files = { "settings.toml": MINE.replace('"abc"', '"hand"') };
  const send = fake.runtime.sendNativeMessage;
  fake.runtime.sendNativeMessage = async (name: string, message: { cmd: string }) => {
    if (message.cmd === "read_config") throw new Error("Native application exited");
    return send(name, message);
  };
  const outcome = await startup.set_in_settings_file("theme", "oasis_night");
  assert.equal(outcome.kind, "failed");
  assert.deepEqual(unsynced_of(local), { base: MINE });
  assert.equal(host.files["settings.toml"], MINE.replace('"abc"', '"hand"'));
});

test("an editor save of another file keeps the record, and a save of settings.toml drops it", async () => {
  const host = { files: { "settings.toml": MINE, "keymap.toml": "" }, old_host: true };
  const { local, startup } = await reloaded(host);
  await startup.set_in_settings_file("theme", "oasis_night");
  await startup.save_config_file("keymap.toml", '[normal]\n"zz" = "tab.next"\n', "");
  assert.deepEqual(unsynced_of(local), { base: MINE });
  await startup.save_config_file("settings.toml", 'theme = "nord"\n', with_theme("oasis_night"));
  assert.equal(unsynced_of(local), undefined);
});

test("a written pick keeps the copies-differ question while the folder still differs in another file", async () => {
  const host = { files: { "settings.toml": MINE, "keymap.toml": "" } };
  const { local, startup } = await reloaded(host);
  await startup.save_config_file("keymap.toml", '[normal]\n"zz" = "tab.next"\n', "");
  host.files = { ...host.files, "keymap.toml": '[normal]\n"zx" = "tab.next"\n' };
  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.notEqual(local[HOST_START_PENDING_STORAGE_KEY], undefined);

  assert.deepEqual(await restarted.set_in_settings_file("theme", "oasis_night"), { kind: "written" });
  assert.equal(host.files["settings.toml"], with_theme("oasis_night"));
  const pending = local[HOST_START_PENDING_STORAGE_KEY] as { changes: { path: string }[] } | undefined;
  assert.deepEqual(pending?.changes.map((change) => change.path), ["keymap.toml"]);
});

test("a browser copy that did not come from the folder changes alone, and nothing is sent", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, sent, startup } = await reloaded(host);
  await startup.import_config({ kind: "folder", entries: [{ path: "keymap.toml", text: "" }] }, {});
  sent.length = 0;
  assert.deepEqual(await startup.set_in_settings_file("theme", "oasis_night"), { kind: "browser_copy" });
  assert.ok(!sent.some((message) => message.cmd === "write_settings"));
  assert.equal(unsynced_of(local), undefined);
  assert.equal(host.files["settings.toml"], MINE);
});

test("a refused write over a folder the user kept the copy over says the pick stays in the browser copy", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, startup } = await reloaded(host);
  await startup.save_config_file("settings.toml", MINE.replace('"abc"', '"typed"'), MINE);
  host.files = { "settings.toml": MINE.replace('"abc"', '"hand"') };
  local[HOST_START_KEPT_STORAGE_KEY] = await files_digest(host.files);
  assert.deepEqual(await startup.set_in_settings_file("theme", "oasis_night"), { kind: "conflict_kept" });
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
  assert.equal(host.files["settings.toml"], MINE.replace('"abc"', '"hand"'));
});

test("an edited import never reaches the folder: a pick after an editor save changes the browser copy alone", async () => {
  const host = { files: { "keymap.toml": "" } as Files };
  const { local, sent, startup } = await reloaded(host);
  await startup.import_config({ kind: "folder", entries: [{ path: "keymap.toml", text: "" }] }, {});
  await startup.save_config_file("keymap.toml", '[normal]\n"zz" = "tab.next"\n', "");
  sent.length = 0;
  assert.deepEqual(await startup.set_in_settings_file("theme", "oasis_night"), { kind: "browser_copy" });
  assert.ok(!sent.some((message) => message.cmd === "write_settings"));
  assert.equal(host.files["settings.toml"], undefined);
  assert.equal(unsynced_of(local), undefined);

  // A folder read replaces the import, and picks reach the folder again.
  await startup.reload_config();
  assert.deepEqual(await startup.set_in_settings_file("theme", "nord"), { kind: "written" });
  assert.equal(host.files["settings.toml"], 'theme = "nord"\n');
});

// A host whose `write_settings` answers only when the test says so.
function hold_writes(fake: ReturnType<typeof install_fake_browser>["fake"]) {
  const send = fake.runtime.sendNativeMessage;
  const held: (() => void)[] = [];
  fake.runtime.sendNativeMessage = (name: string, message: { cmd: string }) => {
    if (message.cmd !== "write_settings") return send(name, message);
    return new Promise((resolve) => held.push(() => resolve(send(name, message))));
  };
  return held;
}

const settles_soon = (promise: Promise<unknown>) => Promise.race([promise.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 500))]);

test("a host that never answers a write blocks no other change, at start or after a pick", async () => {
  const host = { files: { "settings.toml": MINE }, old_host: true };
  const { fake, startup } = await reloaded(host);
  await startup.set_in_settings_file("theme", "oasis_night");
  host.old_host = false;
  hold_writes(fake);

  const restarted = await fresh_startup();
  await restarted.get_config();
  void restarted.reload_config_at_start();
  assert.ok(await settles_soon(restarted.change_edits((current) => ({ ...current, saved: { which_key_delay_ms: 5 } }))), "a :set waited on the start's host write");

  void restarted.set_in_settings_file("theme", "nord");
  assert.ok(await settles_soon(restarted.change_edits((current) => ({ ...current, saved: { which_key_delay_ms: 6 } }))), "a :set waited on the pick's host write");
  assert.equal((await restarted.get_config()).settings.theme, "nord");
});

test("a pick during a write lands after it, from the text the first one left", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, fake, startup } = await reloaded(host);
  const held = hold_writes(fake);
  const first = startup.set_in_settings_file("theme", "nord");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = startup.set_in_settings_file("theme", "oasis_night");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(held.length, 1, "a second write went out while the first was out");
  held.shift()!();
  await new Promise((resolve) => setTimeout(resolve, 50));
  held.shift()!();
  assert.deepEqual(await Promise.all([first, second]), [{ kind: "written" }, { kind: "written" }]);
  assert.equal(host.files["settings.toml"], with_theme("oasis_night"));
  assert.equal(unsynced_of(local), undefined);

  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("`,r` while a write is out waits for it and keeps the pick", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, fake, startup } = await reloaded(host);
  const held = hold_writes(fake);
  const pick = startup.set_in_settings_file("theme", "oasis_night");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const reload = startup.reload_config();
  await new Promise((resolve) => setTimeout(resolve, 50));
  held.shift()!();
  await reload;
  assert.deepEqual(await pick, { kind: "written" });
  assert.equal(host.files["settings.toml"], with_theme("oasis_night"));
  assert.equal(stored_settings(local), with_theme("oasis_night"));
  assert.equal(unsynced_of(local), undefined);
});
