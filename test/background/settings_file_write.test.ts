import assert from "node:assert/strict";
import "../../src/background/command_modules.ts";
import { test } from "node:test";
import { load_effective_config } from "../../src/background/config_load.ts";
import { create_settings_messages } from "../../src/background/settings_message.ts";
import { FILES_SOURCE_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY, TEMP_SETTINGS_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import { install_fake_browser, type Files } from "./config_fake_browser.ts";

type Startup = typeof import("../../src/background/startup.ts");
let fresh_count = 0;
const fresh_startup = async () => (await import(`../../src/background/startup.ts?settings_file_${fresh_count++}`)) as Startup;

const MINE = '# My settings\n\nhint_letters = "abc" # home row\n\n# Rules\n[[site_rules]]\nsite = "*://x.test/*"\noff = true\n';
const with_theme = (theme: string) => MINE.replace('hint_letters = "abc" # home row\n', `hint_letters = "abc" # home row\ntheme = "${theme}"\n`);

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
  assert.equal(local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY], undefined);
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
  assert.equal(local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY], undefined);
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
  assert.equal(local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY], undefined);
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
  assert.equal(local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY], undefined);
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
  assert.deepEqual(local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY], { base: MINE });
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
  assert.equal(local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY], undefined);
  assert.deepEqual(sent, []);
});
