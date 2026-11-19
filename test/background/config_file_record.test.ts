import assert from "node:assert/strict";
import "../../src/background/command_modules.ts";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FILES_SOURCE_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { files_before_unsynced, unsynced_of_stored } from "../../src/background/settings_file.ts";
import { install_fake_browser, type Files } from "./config_fake_browser.ts";

// The record of files the folder lags, by path, with more than settings.toml in it.

type Startup = typeof import("../../src/background/startup.ts");
let fresh_count = 0;
const fresh_startup = async () => (await import(`../../src/background/startup.ts?config_file_record_${fresh_count++}`)) as Startup;

const MINE = '# My settings\n\nhint_letters = "abc" # home row\n';
const with_theme = (theme: string) => `${MINE}theme = "${theme}"\n`;
const HAND = MINE.replace('"abc"', '"hand"');
const THEME = "themes/frappe.toml";
const FRAPPE = readFileSync(new URL("../../themes/catppuccin_frappe.toml", import.meta.url), "utf8");
const EDITED = FRAPPE.replace('bg_core = "#303446"', 'bg_core = "#101010"');
const HAND_THEME = FRAPPE.replace('bg_core = "#303446"', 'bg_core = "#202020"');

const unsynced_of = (local: Record<string, unknown>) => local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] ?? undefined;
const copy_of = (local: Record<string, unknown>) => (local[FILES_SOURCE_STORAGE_KEY] as { files: Files }).files;

type Host = { files: Files; old_host?: boolean; refuse?: string[] };

// A profile that read `folder` and then changed the browser copy to `copy`, with the record a host that could not write yet leaves.
// The next start finds it as it is. `host.files` is set to what the folder holds by then.
async function lagging(folder: Files, copy: Files, record: Record<string, string | null>, host_after: Files, options: Omit<Host, "files"> = {}) {
  const host: Host = { files: folder };
  const fake = install_fake_browser(host);
  const startup = await fresh_startup();
  await startup.get_config();
  await startup.reload_config();
  fake.local[FILES_SOURCE_STORAGE_KEY] = { ...(fake.local[FILES_SOURCE_STORAGE_KEY] as object), files: copy };
  fake.local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] = record;
  Object.assign(host, { files: host_after, ...options });
  fake.sent.length = 0;
  return { ...fake, host };
}

const writes_sent = <T extends { cmd: string }>(sent: T[]) => sent.filter((message) => message.cmd === "write_config_file");

test("two waiting files, the first refused as changed on disk: the other is written and the refused one goes to the question", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const { local, host } = await lagging(folder, { "settings.toml": with_theme("nord"), [THEME]: EDITED }, { [THEME]: FRAPPE, "settings.toml": MINE }, { ...folder, [THEME]: HAND_THEME });
  await (await fresh_startup()).reload_config_at_start();
  assert.equal(host.files["settings.toml"], with_theme("nord"));
  assert.equal(host.files[THEME], HAND_THEME);
  assert.equal(unsynced_of(local), undefined);
  assert.notEqual(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a theme write the host fails keeps its path waiting, and a pick meanwhile is written and leaves that path alone", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const { local, host, sent } = await lagging(folder, { "settings.toml": with_theme("nord"), [THEME]: EDITED }, { [THEME]: FRAPPE, "settings.toml": MINE }, folder, { refuse: [THEME] });
  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.equal(host.files["settings.toml"], with_theme("nord"));
  assert.equal(host.files[THEME], FRAPPE);
  assert.deepEqual(unsynced_of(local), { [THEME]: FRAPPE });
  assert.deepEqual(writes_sent(sent).map((message) => (message as { kind?: string }).kind), ["theme", "settings"]);

  assert.deepEqual(await restarted.set_in_settings_file("theme", "dracula"), { kind: "written" });
  assert.equal(host.files["settings.toml"], with_theme("dracula"));
  assert.deepEqual(unsynced_of(local), { [THEME]: FRAPPE });
  assert.equal(copy_of(local)[THEME], EDITED);

  host.refuse = [];
  await (await fresh_startup()).reload_config_at_start();
  assert.equal(host.files[THEME], EDITED);
  assert.equal(unsynced_of(local), undefined);
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a record of the old `{ base }` shape is written as settings.toml's base, and the next store writes the map", async () => {
  const folder = { "settings.toml": MINE };
  const written = await lagging(folder, { "settings.toml": with_theme("nord") }, {}, folder);
  written.local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] = { base: MINE };
  await (await fresh_startup()).reload_config_at_start();
  assert.equal(written.host.files["settings.toml"], with_theme("nord"));
  assert.equal(unsynced_of(written.local), undefined);

  const waiting = await lagging(folder, { "settings.toml": with_theme("nord") }, {}, folder, { old_host: true });
  waiting.local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] = { base: MINE };
  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.deepEqual(await restarted.set_in_settings_file("theme", "dracula"), { kind: "waiting", host_outdated: true });
  assert.deepEqual(unsynced_of(waiting.local), { "settings.toml": MINE });
  assert.equal(waiting.local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("the stored record keeps only paths the host can write, and a file the copy lacks goes back to its base", () => {
  assert.deepEqual(unsynced_of_stored({ base: null }), { "settings.toml": null });
  assert.deepEqual(unsynced_of_stored({ "settings.toml": "a", [THEME]: null, "keymap.toml": "x", "themes/../x.toml": "y", "themes/b.toml": 3 }), { "settings.toml": "a", [THEME]: null });
  assert.equal(unsynced_of_stored({ "keymap.toml": "x" }), undefined);
  assert.equal(unsynced_of_stored({}), undefined);
  assert.equal(unsynced_of_stored(null), undefined);
  assert.deepEqual(files_before_unsynced({ "settings.toml": "b", [THEME]: "new", "keymap.toml": "k" }, { "settings.toml": "a", [THEME]: null }), { "settings.toml": "a", "keymap.toml": "k" });
  assert.deepEqual(files_before_unsynced({ "keymap.toml": "k" }, { [THEME]: "old" }), { "keymap.toml": "k", [THEME]: "old" });
});

test("a file the copy no longer has is deleted only while the folder still holds its base", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const deleted = await lagging(folder, { "settings.toml": MINE }, { [THEME]: FRAPPE }, folder);
  await (await fresh_startup()).reload_config_at_start();
  assert.deepEqual(deleted.host.files, { "settings.toml": MINE });
  assert.deepEqual(writes_sent(deleted.sent), [{ cmd: "write_config_file", kind: "theme", name: "frappe", text: null, base_sha256: writes_sent(deleted.sent)[0]!.base_sha256 }]);
  assert.equal(unsynced_of(deleted.local), undefined);
  assert.equal(deleted.local[HOST_START_PENDING_STORAGE_KEY], undefined);

  const kept = await lagging(folder, { "settings.toml": MINE }, { [THEME]: FRAPPE }, { ...folder, [THEME]: HAND_THEME });
  await (await fresh_startup()).reload_config_at_start();
  assert.equal(kept.host.files[THEME], HAND_THEME);
  assert.equal(unsynced_of(kept.local), undefined);
  assert.notEqual(kept.local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a refused settings.toml write is put onto the folder's text and keeps the theme file that still waits", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const { local, host } = await lagging(folder, { "settings.toml": with_theme("nord"), [THEME]: EDITED }, { "settings.toml": MINE, [THEME]: FRAPPE }, { ...folder, "settings.toml": HAND }, { refuse: [THEME] });
  await (await fresh_startup()).reload_config_at_start();
  assert.equal(host.files["settings.toml"], `${HAND}theme = "nord"\n`);
  assert.equal(host.files[THEME], FRAPPE);
  assert.deepEqual(copy_of(local), { "settings.toml": `${HAND}theme = "nord"\n`, [THEME]: EDITED });
  assert.deepEqual(unsynced_of(local), { [THEME]: FRAPPE });
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a refused settings.toml write is not put onto a folder whose waiting theme file was also edited by hand: both go to the question", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const { local, host } = await lagging(folder, { "settings.toml": with_theme("nord"), [THEME]: EDITED }, { "settings.toml": MINE, [THEME]: FRAPPE }, { "settings.toml": HAND, [THEME]: HAND_THEME });
  await (await fresh_startup()).reload_config_at_start();
  assert.deepEqual(host.files, { "settings.toml": HAND, [THEME]: HAND_THEME });
  assert.deepEqual(copy_of(local), { "settings.toml": with_theme("nord"), [THEME]: EDITED });
  assert.equal(unsynced_of(local), undefined);
  assert.notEqual(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

// A host whose writes answer only when the test says so.
function hold_writes(fake: ReturnType<typeof install_fake_browser>["fake"]) {
  const send = fake.runtime.sendNativeMessage;
  const held: (() => void)[] = [];
  fake.runtime.sendNativeMessage = (name: string, message: { cmd: string }) => {
    if (message.cmd !== "write_config_file") return send(name, message);
    return new Promise((resolve) => held.push(() => resolve(send(name, message))));
  };
  return held;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

test("an editor save of a file whose write is out drops only that path: the other file is still written", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const lag = await lagging(folder, { "settings.toml": with_theme("nord"), [THEME]: EDITED }, { [THEME]: FRAPPE, "settings.toml": MINE }, folder);
  const held = hold_writes(lag.fake);
  const restarted = await fresh_startup();
  await restarted.get_config();
  const start = restarted.reload_config_at_start();
  await tick();
  assert.equal(held.length, 1, "the theme write is not out alone");
  await restarted.save_config_file(THEME, HAND_THEME, EDITED);
  assert.deepEqual(unsynced_of(lag.local), { "settings.toml": MINE });
  held.shift()!();
  await tick();
  assert.equal(held.length, 1, "the settings.toml write did not follow");
  held.shift()!();
  await start;
  assert.equal(lag.host.files["settings.toml"], with_theme("nord"));
  assert.equal(unsynced_of(lag.local), undefined);
  assert.equal(copy_of(lag.local)[THEME], HAND_THEME);
});

test("a pick while another file's write is out goes out at once and gets its own outcome", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const lag = await lagging(folder, { "settings.toml": MINE, [THEME]: EDITED }, { [THEME]: FRAPPE }, { ...folder, [THEME]: HAND_THEME });
  const held = hold_writes(lag.fake);
  const restarted = await fresh_startup();
  await restarted.get_config();
  const start = restarted.reload_config_at_start();
  await tick();
  assert.equal(held.length, 1);
  const pick = restarted.set_in_settings_file("theme", "nord");
  await tick();
  assert.equal(held.length, 2, "the pick waited on the theme write");
  held.pop()!();
  assert.deepEqual(await pick, { kind: "written" });
  held.shift()!();
  await start;
  assert.equal(lag.host.files["settings.toml"], with_theme("nord"));
  assert.equal(lag.host.files[THEME], HAND_THEME);
  assert.equal(unsynced_of(lag.local), undefined);
  assert.notEqual(lag.local[HOST_START_PENDING_STORAGE_KEY], undefined);
});
