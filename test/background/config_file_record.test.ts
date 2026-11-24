import assert from "node:assert/strict";
import "../../src/background/command_modules.ts";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FILES_SOURCE_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { PAGE_FILE_MARKER } from "../../src/background/engine_file.ts";
import { files_before_unsynced, unsynced_of_stored } from "../../src/background/settings_file.ts";
import { install_fake_browser, until, type Files } from "./config_fake_browser.ts";
import { fresh_config_service, type ConfigService } from "./fresh_config_service.ts";

// The record of files the folder lags, by path, with more than settings.toml in it.

type Startup = ConfigService;

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
  const startup = fresh_config_service();
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
  await (fresh_config_service()).reload_config_at_start();
  assert.equal(host.files["settings.toml"], with_theme("nord"));
  assert.equal(host.files[THEME], HAND_THEME);
  assert.equal(unsynced_of(local), undefined);
  assert.notEqual(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a theme write the host fails keeps its path waiting, and a pick meanwhile is written and leaves that path alone", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const { local, host, sent } = await lagging(folder, { "settings.toml": with_theme("nord"), [THEME]: EDITED }, { [THEME]: FRAPPE, "settings.toml": MINE }, folder, { refuse: [THEME] });
  const restarted = fresh_config_service();
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
  await (fresh_config_service()).reload_config_at_start();
  assert.equal(host.files[THEME], EDITED);
  assert.equal(unsynced_of(local), undefined);
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a record of the old `{ base }` shape is written as settings.toml's base, and the next store writes the map", async () => {
  const folder = { "settings.toml": MINE };
  const written = await lagging(folder, { "settings.toml": with_theme("nord") }, {}, folder);
  written.local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] = { base: MINE };
  await (fresh_config_service()).reload_config_at_start();
  assert.equal(written.host.files["settings.toml"], with_theme("nord"));
  assert.equal(unsynced_of(written.local), undefined);

  const waiting = await lagging(folder, { "settings.toml": with_theme("nord") }, {}, folder, { old_host: true });
  waiting.local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] = { base: MINE };
  const restarted = fresh_config_service();
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
  await (fresh_config_service()).reload_config_at_start();
  assert.deepEqual(deleted.host.files, { "settings.toml": MINE });
  assert.deepEqual(writes_sent(deleted.sent), [{ cmd: "write_config_file", kind: "theme", name: "frappe", text: null, base_sha256: writes_sent(deleted.sent)[0]!.base_sha256 }]);
  assert.equal(unsynced_of(deleted.local), undefined);
  assert.equal(deleted.local[HOST_START_PENDING_STORAGE_KEY], undefined);

  const kept = await lagging(folder, { "settings.toml": MINE }, { [THEME]: FRAPPE }, { ...folder, [THEME]: HAND_THEME });
  await (fresh_config_service()).reload_config_at_start();
  assert.equal(kept.host.files[THEME], HAND_THEME);
  assert.equal(unsynced_of(kept.local), undefined);
  assert.notEqual(kept.local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a refused settings.toml write is put onto the folder's text and keeps the theme file that still waits", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const { local, host } = await lagging(folder, { "settings.toml": with_theme("nord"), [THEME]: EDITED }, { "settings.toml": MINE, [THEME]: FRAPPE }, { ...folder, "settings.toml": HAND }, { refuse: [THEME] });
  await (fresh_config_service()).reload_config_at_start();
  assert.equal(host.files["settings.toml"], `${HAND}theme = "nord"\n`);
  assert.equal(host.files[THEME], FRAPPE);
  assert.deepEqual(copy_of(local), { "settings.toml": `${HAND}theme = "nord"\n`, [THEME]: EDITED });
  assert.deepEqual(unsynced_of(local), { [THEME]: FRAPPE });
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a refused settings.toml write is not put onto a folder whose waiting theme file was also edited by hand: both go to the question", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const { local, host } = await lagging(folder, { "settings.toml": with_theme("nord"), [THEME]: EDITED }, { "settings.toml": MINE, [THEME]: FRAPPE }, { "settings.toml": HAND, [THEME]: HAND_THEME });
  await (fresh_config_service()).reload_config_at_start();
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

test("an editor save of a file whose write is out drops only that path: the other file is still written", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const lag = await lagging(folder, { "settings.toml": with_theme("nord"), [THEME]: EDITED }, { [THEME]: FRAPPE, "settings.toml": MINE }, folder);
  const held = hold_writes(lag.fake);
  const restarted = fresh_config_service();
  await restarted.get_config();
  const start = restarted.reload_config_at_start();
  await until(() => held.length === 1, "the theme write did not go out");
  await restarted.save_config_file(THEME, HAND_THEME, EDITED);
  assert.deepEqual(unsynced_of(lag.local), { "settings.toml": MINE });
  held.shift()!();
  await until(() => held.length === 1, "the settings.toml write did not follow");
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
  const restarted = fresh_config_service();
  await restarted.get_config();
  const start = restarted.reload_config_at_start();
  await until(() => held.length === 1, "the theme write did not go out");
  const pick = restarted.set_in_settings_file("theme", "nord");
  await until(() => held.length === 2, "the pick waited on the theme write");
  held.pop()!();
  assert.deepEqual(await pick, { kind: "written" });
  held.shift()!();
  await start;
  assert.equal(lag.host.files["settings.toml"], with_theme("nord"));
  assert.equal(lag.host.files[THEME], HAND_THEME);
  assert.equal(unsynced_of(lag.local), undefined);
  assert.notEqual(lag.local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a settings.toml refusal whose folder read predates a theme write that lands first reads the folder again, so the copy keeps the written theme", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const lag = await lagging(folder, { "settings.toml": MINE, [THEME]: EDITED }, { [THEME]: FRAPPE }, { ...folder, "settings.toml": HAND });
  const held = hold_writes(lag.fake);
  // The first folder read after the refusal answers what the folder held when it was asked, but only when the test says so. The reads of the write gate before it pass.
  const send = lag.fake.runtime.sendNativeMessage;
  const held_reads: (() => void)[] = [];
  let refusal_sent = false;
  lag.fake.runtime.sendNativeMessage = (name: string, message: { cmd: string }) => {
    if (message.cmd !== "read_config" || !refusal_sent || held_reads.length > 0) return send(name, message);
    const answer = send(name, message);
    return new Promise((resolve) => held_reads.push(() => resolve(answer)));
  };
  const restarted = fresh_config_service();
  await restarted.get_config();
  const start = restarted.reload_config_at_start();
  await until(() => held.length === 1, "the theme write did not go out");
  const pick = restarted.set_in_settings_file("theme", "nord");
  await until(() => held.length === 2, "the pick's write did not go out");
  refusal_sent = true;
  held.pop()!();
  await until(() => held_reads.length === 1, "the folder was not read after the refusal");
  held.shift()!();
  await until(() => lag.host.files[THEME] === EDITED && unsynced_of(lag.local) !== undefined && !Object.hasOwn(unsynced_of(lag.local) as object, THEME), "the theme write did not settle");
  held_reads[0]!();
  // Sent again from the same base, refused again, then put onto the fresh read and written.
  for (const what of ["the refused write was not sent again", "the merged write did not go out"]) {
    await until(() => held.length === 1, what);
    held.shift()!();
  }
  assert.deepEqual(await pick, { kind: "written" });
  await start;
  assert.equal(lag.host.files["settings.toml"], `${HAND}theme = "nord"\n`);
  assert.deepEqual(copy_of(lag.local), { "settings.toml": `${HAND}theme = "nord"\n`, [THEME]: EDITED });
  assert.equal(unsynced_of(lag.local), undefined);
});

// settings.toml waits at the gate, since it names an engine no file defines, while the theme write of the start is out. Then `,r` runs and holds the change queue.
const GHOST = `${MINE}default_engine = "ghost"\n`;
const ENGINE_FILE = "search_engines.d/zz-desertfox.toml";
const GHOST_ENGINE = `${PAGE_FILE_MARKER}\n[ghost]\nurl = "https://g.test/?q={query}"\n`;
async function reload_during_held_gate() {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const lag = await lagging(folder, { "settings.toml": GHOST, [THEME]: EDITED }, { "settings.toml": MINE, [THEME]: FRAPPE }, folder);
  const held = hold_writes(lag.fake);
  const restarted = fresh_config_service();
  await restarted.get_config();
  const start = restarted.reload_config_at_start();
  await until(() => held.length === 1, "the theme write did not go out");
  const { reload } = await reload_at_gate(lag.sent, restarted);
  return { ...lag, held, restarted, start, reload };
}

// Starts `,r` and returns it, wrapped so the caller does not wait on it, once it has read the folder for the gate of settings.toml, so a write answered after that is one the reload waits on.
async function reload_at_gate(sent: { cmd: string }[], service: ConfigService) {
  const reads_of = () => sent.filter((message) => message.cmd === "read_config").length;
  const reads_before = reads_of();
  const reload = service.reload_config();
  await until(() => reads_of() > reads_before, "the reload did not read the folder for the gate");
  return { reload };
}

test("`,r` while a gated settings.toml waits and another file's write is out finishes once that write answers", { timeout: 5000 }, async () => {
  const { held, host, local, start, reload } = await reload_during_held_gate();
  held.shift()!();
  await reload;
  await start;
  assert.equal(host.files[THEME], EDITED);
  assert.equal(host.files["settings.toml"], MINE);
  assert.equal(unsynced_of(local), undefined);
});

test("`,r` writes a gated settings.toml once the folder builds with it after the other file's write lands", { timeout: 5000 }, async () => {
  const { held, host, start, reload } = await reload_during_held_gate();
  host.files = { ...host.files, "search_engines.d/hand.toml": '[ghost]\nurl = "https://g.test/?q={query}"\n' };
  held.shift()!();
  await until(() => held.length === 1, "settings.toml did not go out after the theme write landed");
  held.shift()!();
  await reload;
  await start;
  assert.equal(host.files[THEME], EDITED);
  assert.equal(host.files["settings.toml"], GHOST);
});

test("`,r` settles another file's write that the host refuses as changed on disk, and its own swap drops the question", { timeout: 5000 }, async () => {
  const { held, host, local, start, reload } = await reload_during_held_gate();
  host.files = { ...host.files, [THEME]: HAND_THEME };
  held.shift()!();
  await reload;
  await start;
  assert.equal(host.files[THEME], HAND_THEME);
  assert.equal(copy_of(local)[THEME], HAND_THEME);
  assert.equal(unsynced_of(local), undefined);
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a `:set` made during `,r` runs after it and reaches the folder", { timeout: 5000 }, async () => {
  const { held, host, local, restarted, start, reload } = await reload_during_held_gate();
  const pick = restarted.set_in_settings_file("hint_letters", "xyz");
  held.shift()!();
  await reload;
  await until(() => held.length === 1, "the pick's write did not go out");
  held.shift()!();
  assert.deepEqual(await pick, { kind: "written" });
  await start;
  assert.equal(host.files["settings.toml"], MINE.replace('"abc"', '"xyz"'));
  assert.equal(copy_of(local)["settings.toml"], MINE.replace('"abc"', '"xyz"'));
  assert.equal(unsynced_of(local), undefined);
});

test("`,r` settles two other files' writes one after the other, so the record loses neither path", { timeout: 5000 }, async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  // The page's engine file defines `ghost` in the copy only, so the copy builds and the theme save goes through, while the folder still lacks it.
  const lag = await lagging(folder, { "settings.toml": GHOST, [THEME]: EDITED, [ENGINE_FILE]: GHOST_ENGINE }, { "settings.toml": MINE, [THEME]: FRAPPE }, folder);
  const held = hold_writes(lag.fake);
  const restarted = fresh_config_service();
  await restarted.get_config();
  const start = restarted.reload_config_at_start();
  await until(() => held.length === 1, "the theme write did not go out");
  const dusk = restarted.set_theme_file("dusk", FRAPPE, false);
  await until(() => held.length === 2, "the dusk theme write did not go out");
  const { reload } = await reload_at_gate(lag.sent, restarted);
  held.shift()!();
  held.shift()!();
  await reload;
  assert.deepEqual(writes_sent(lag.sent).map((message) => (message as { name?: string }).name), ["frappe", "dusk"]);
  assert.equal(lag.host.files[THEME], EDITED);
  assert.equal(lag.host.files["themes/dusk.toml"], FRAPPE);
  assert.equal(unsynced_of(lag.local), undefined);
  await dusk;
  await start;
});
