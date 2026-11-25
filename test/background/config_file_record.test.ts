import assert from "node:assert/strict";
import "../../src/background/command_modules.ts";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FILES_SOURCE_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { PAGE_FILE_MARKER } from "../../src/background/engine_file.ts";
import { files_before_unsynced, text_sha256, unsynced_of_stored } from "../../src/background/settings_file.ts";
import { batches_sent, files_sent, install_fake_browser, until, type Files } from "./config_fake_browser.ts";
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

type Host = { files: Files; old_host?: boolean; refuse?: string[]; unrestored?: string[] };

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

test("two waiting files, the first refused as changed on disk: the batch writes neither, then the other is written alone and the refused one goes to the question", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const { local, host, sent } = await lagging(folder, { "settings.toml": with_theme("nord"), [THEME]: EDITED }, { [THEME]: FRAPPE, "settings.toml": MINE }, { ...folder, [THEME]: HAND_THEME });
  await (fresh_config_service()).reload_config_at_start();
  assert.deepEqual(batches_sent(sent), [[THEME, "settings.toml"], ["settings.toml"]]);
  assert.equal(host.files["settings.toml"], with_theme("nord"));
  assert.equal(host.files[THEME], HAND_THEME);
  assert.equal(unsynced_of(local), undefined);
  assert.notEqual(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a start whose batch the host fails on one file sends the others again without it, and a pick meanwhile is written alone and leaves that path alone", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const { local, host, sent } = await lagging(folder, { "settings.toml": with_theme("nord"), [THEME]: EDITED }, { [THEME]: FRAPPE, "settings.toml": MINE }, folder, { refuse: [THEME] });
  const restarted = fresh_config_service();
  await restarted.reload_config_at_start();
  assert.equal(host.files["settings.toml"], with_theme("nord"));
  assert.equal(host.files[THEME], FRAPPE);
  assert.deepEqual(unsynced_of(local), { [THEME]: FRAPPE });
  assert.deepEqual(batches_sent(sent), [[THEME, "settings.toml"], ["settings.toml"]]);

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
  assert.deepEqual(unsynced_of_stored({ "settings.toml": "a", [THEME]: null, "snippets/x.js": "x", "themes/../x.toml": "y", "themes/b.toml": 3 }), { "settings.toml": "a", [THEME]: null });
  assert.equal(unsynced_of_stored({ "snippets/x.js": "x" }), undefined);
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
  assert.deepEqual(files_sent(deleted.sent), [{ kind: "theme", name: "frappe", text: null, base_sha256: files_sent(deleted.sent)[0]!.base_sha256 }]);
  assert.equal(unsynced_of(deleted.local), undefined);
  assert.equal(deleted.local[HOST_START_PENDING_STORAGE_KEY], undefined);

  const kept = await lagging(folder, { "settings.toml": MINE }, { [THEME]: FRAPPE }, { ...folder, [THEME]: HAND_THEME });
  await (fresh_config_service()).reload_config_at_start();
  assert.equal(kept.host.files[THEME], HAND_THEME);
  assert.equal(unsynced_of(kept.local), undefined);
  assert.notEqual(kept.local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a refused settings.toml write is put onto the folder's text, and the start writes it without the theme file the host cannot write", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const { local, host } = await lagging(folder, { "settings.toml": with_theme("nord"), [THEME]: EDITED }, { "settings.toml": MINE, [THEME]: FRAPPE }, { ...folder, "settings.toml": HAND }, { refuse: [THEME] });
  await (fresh_config_service()).reload_config_at_start();
  assert.deepEqual(host.files, { "settings.toml": `${HAND}theme = "nord"\n`, [THEME]: FRAPPE });
  assert.deepEqual(copy_of(local), { "settings.toml": `${HAND}theme = "nord"\n`, [THEME]: EDITED });
  assert.deepEqual(unsynced_of(local), { [THEME]: FRAPPE });
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);

  host.refuse = [];
  await (fresh_config_service()).reload_config_at_start();
  assert.deepEqual(host.files, { "settings.toml": `${HAND}theme = "nord"\n`, [THEME]: EDITED });
  assert.equal(unsynced_of(local), undefined);
});

test("a start whose batch the gate holds over one file sends the others without it, and that file stays waiting", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const ghost = `${MINE}default_engine = "ghost"\n`;
  const { local, host, sent } = await lagging(folder, { "settings.toml": ghost, [THEME]: EDITED }, { "settings.toml": MINE, [THEME]: FRAPPE }, folder);
  await (fresh_config_service()).reload_config_at_start();
  assert.deepEqual(batches_sent(sent), [[THEME]]);
  assert.deepEqual(host.files, { "settings.toml": MINE, [THEME]: EDITED });
  assert.deepEqual(unsynced_of(local), { "settings.toml": MINE });
});

test("a batch whose rollback could not put a file back keeps every path waiting, and the next start finds that file changed on disk", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const { local, host } = await lagging(folder, { "settings.toml": with_theme("nord"), [THEME]: EDITED }, { [THEME]: FRAPPE, "settings.toml": MINE }, folder, { refuse: ["settings.toml"], unrestored: [THEME] });
  await (fresh_config_service()).reload_config_at_start();
  assert.deepEqual(host.files, { "settings.toml": MINE, [THEME]: EDITED });
  assert.deepEqual(unsynced_of(local), { [THEME]: FRAPPE, "settings.toml": MINE });
  // The start's own read finds the theme file at neither the base nor nothing the copy explains, so it asks.
  assert.notEqual(local[HOST_START_PENDING_STORAGE_KEY], undefined);

  Object.assign(host, { refuse: [], unrestored: [] });
  await (fresh_config_service()).reload_config_at_start();
  assert.equal(host.files["settings.toml"], with_theme("nord"));
  assert.equal(host.files[THEME], EDITED);
  assert.equal(unsynced_of(local), undefined);
  // The file left behind held the copy's text, so once settings.toml lands the folder matches the copy and the start settles the question.
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
    if (message.cmd !== "write_config_files") return send(name, message);
    return new Promise((resolve) => held.push(() => resolve(send(name, message))));
  };
  return held;
}

test("an editor save of a file whose batch is out drops only that path: the other file of the batch settles as written", async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const lag = await lagging(folder, { "settings.toml": with_theme("nord"), [THEME]: EDITED }, { [THEME]: FRAPPE, "settings.toml": MINE }, folder);
  const held = hold_writes(lag.fake);
  const restarted = fresh_config_service();
  await restarted.get_config();
  const start = restarted.reload_config_at_start();
  await until(() => held.length === 1, "the batch did not go out");
  await restarted.save_config_file(THEME, HAND_THEME, EDITED);
  assert.deepEqual(unsynced_of(lag.local), { "settings.toml": MINE });
  held.shift()!();
  await start;
  assert.deepEqual(batches_sent(lag.sent), [[THEME, "settings.toml"]]);
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

// settings.toml waits at the gate, since it names an engine no file defines, while a theme save's write is out. Then `,r` runs and holds the change queue.
const GHOST = `${MINE}default_engine = "ghost"\n`;
const ENGINE_FILE = "search_engines.d/zz-desertfox.toml";
const GHOST_ENGINE = `${PAGE_FILE_MARKER}\n[ghost]\nurl = "https://g.test/?q={query}"\n`;
async function reload_during_held_gate() {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  // The page's engine file defines `ghost` in the copy only, so the copy builds, while the folder still lacks it.
  const lag = await lagging(folder, { "settings.toml": GHOST, [THEME]: FRAPPE, [ENGINE_FILE]: GHOST_ENGINE }, { "settings.toml": MINE }, folder);
  const held = hold_writes(lag.fake);
  const restarted = fresh_config_service();
  await restarted.get_config();
  await restarted.reload_config_at_start();
  assert.deepEqual(batches_sent(lag.sent), []);
  const theme = restarted.set_theme_file("frappe", EDITED, true);
  await until(() => held.length === 1, "the theme write did not go out");
  const { reload } = await reload_at_gate(lag.sent, restarted);
  return { ...lag, held, restarted, theme, reload };
}

// Starts `,r` and returns it, wrapped so the caller does not wait on it, once it has read the folder for the gate of its batch, so a write answered after that is one the reload waits on.
async function reload_at_gate(sent: { cmd: string }[], service: ConfigService) {
  const reads_of = () => sent.filter((message) => message.cmd === "read_config").length;
  const reads_before = reads_of();
  const reload = service.reload_config();
  await until(() => reads_of() > reads_before, "the reload did not read the folder for the gate");
  return { reload };
}

test("`,r` while a gated settings.toml waits and another file's write is out finishes once that write answers", { timeout: 5000 }, async () => {
  const { held, host, local, theme, reload, sent } = await reload_during_held_gate();
  held.shift()!();
  await reload;
  await theme;
  assert.deepEqual(batches_sent(sent), [[THEME]]);
  assert.equal(host.files[THEME], EDITED);
  assert.equal(host.files["settings.toml"], MINE);
  assert.equal(unsynced_of(local), undefined);
});

test("`,r` writes a gated settings.toml once the folder builds with it after the other file's write lands", { timeout: 5000 }, async () => {
  const { held, host, theme, reload } = await reload_during_held_gate();
  host.files = { ...host.files, "search_engines.d/hand.toml": '[ghost]\nurl = "https://g.test/?q={query}"\n' };
  held.shift()!();
  await until(() => held.length === 1, "settings.toml did not go out after the theme write landed");
  held.shift()!();
  await reload;
  await theme;
  assert.equal(host.files[THEME], EDITED);
  assert.equal(host.files["settings.toml"], GHOST);
});

test("`,r` settles another file's write that the host refuses as changed on disk, and its own swap drops the question", { timeout: 5000 }, async () => {
  const { held, host, local, theme, reload } = await reload_during_held_gate();
  host.files = { ...host.files, [THEME]: HAND_THEME };
  held.shift()!();
  await reload;
  await theme;
  assert.equal(host.files[THEME], HAND_THEME);
  assert.equal(copy_of(local)[THEME], HAND_THEME);
  assert.equal(unsynced_of(local), undefined);
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a `:set` made during `,r` runs after it and reaches the folder", { timeout: 5000 }, async () => {
  const { held, host, local, restarted, theme, reload } = await reload_during_held_gate();
  const pick = restarted.set_in_settings_file("hint_letters", "xyz");
  held.shift()!();
  await reload;
  await until(() => held.length === 1, "the pick's write did not go out");
  held.shift()!();
  assert.deepEqual(await pick, { kind: "written" });
  await theme;
  assert.equal(host.files["settings.toml"], MINE.replace('"abc"', '"xyz"'));
  assert.equal(copy_of(local)["settings.toml"], MINE.replace('"abc"', '"xyz"'));
  assert.equal(unsynced_of(local), undefined);
});

test("`,r` settles two other batches one after the other, so the record loses neither path", { timeout: 5000 }, async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const lag = await lagging(folder, folder, {}, folder);
  const held = hold_writes(lag.fake);
  const restarted = fresh_config_service();
  await restarted.get_config();
  const frappe = restarted.set_theme_file("frappe", EDITED, true);
  await until(() => held.length === 1, "the frappe theme write did not go out");
  const dusk = restarted.set_theme_file("dusk", FRAPPE, false);
  await until(() => held.length === 2, "the dusk theme write did not go out");
  const { reload } = await reload_at_gate(lag.sent, restarted);
  held.shift()!();
  held.shift()!();
  await reload;
  assert.deepEqual(batches_sent(lag.sent), [[THEME], ["themes/dusk.toml"]]);
  assert.equal(lag.host.files[THEME], EDITED);
  assert.equal(lag.host.files["themes/dusk.toml"], FRAPPE);
  assert.equal(unsynced_of(lag.local), undefined);
  await dusk;
  await frappe;
});

test("a pick of a file whose batch is out waits for the whole batch, then writes from the text the batch left", { timeout: 5000 }, async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const lag = await lagging(folder, { "settings.toml": with_theme("nord"), [THEME]: EDITED }, { [THEME]: FRAPPE, "settings.toml": MINE }, folder);
  const held = hold_writes(lag.fake);
  const restarted = fresh_config_service();
  await restarted.get_config();
  const start = restarted.reload_config_at_start();
  await until(() => held.length === 1, "the batch did not go out");
  const pick = restarted.set_in_settings_file("hint_letters", "xyz");
  // The batch holds the slot of settings.toml, so the pick sends nothing while it is out.
  await until(() => lag.sent.filter((message) => message.cmd === "read_config").length >= 2, "the pick did not read the folder for its gate");
  assert.equal(held.length, 1);
  held.shift()!();
  await until(() => held.length === 1, "the pick's write did not follow the batch");
  held.shift()!();
  assert.deepEqual(await pick, { kind: "written" });
  await start;
  const picked = with_theme("nord").replace('"abc"', '"xyz"');
  assert.deepEqual(batches_sent(lag.sent), [[THEME, "settings.toml"], ["settings.toml"]]);
  assert.equal(files_sent(lag.sent)[2]!.base_sha256, await text_sha256(with_theme("nord")));
  assert.deepEqual(lag.host.files, { "settings.toml": picked, [THEME]: EDITED });
  assert.equal(unsynced_of(lag.local), undefined);
});

test("two batches that share a file go out one after the other: the second waits for the first, then sends every file it still lags", { timeout: 5000 }, async () => {
  const folder = { "settings.toml": with_theme("frappe"), [THEME]: FRAPPE };
  const lag = await lagging(folder, { "settings.toml": with_theme("frappe"), [THEME]: EDITED }, { [THEME]: FRAPPE }, folder);
  const held = hold_writes(lag.fake);
  const restarted = fresh_config_service();
  await restarted.get_config();
  const start = restarted.reload_config_at_start();
  await until(() => held.length === 1, "the first batch did not go out");
  // A remove of the theme settings.toml names: settings.toml and the theme file in one batch, which shares the theme file with the batch out.
  const removed = restarted.set_theme_file("frappe", null, false);
  await until(() => lag.sent.filter((message) => message.cmd === "read_config").length >= 2, "the remove did not read the folder for its gate");
  assert.equal(held.length, 1);
  held.shift()!();
  await until(() => held.length === 1, "the second batch did not follow the first");
  held.shift()!();
  const outcome = await removed;
  assert.equal(outcome.kind === "changed" && outcome.file.kind, "written");
  assert.equal(outcome.kind === "changed" && outcome.settings?.kind, "written");
  await start;
  assert.deepEqual(batches_sent(lag.sent), [[THEME], ["settings.toml", THEME]]);
  assert.deepEqual(lag.host.files, { "settings.toml": MINE });
  assert.equal(unsynced_of(lag.local), undefined);
});

test("a gate read taken while a batch is out is read again once its files land, so the next batch builds on them", { timeout: 5000 }, async () => {
  const folder = { "settings.toml": MINE };
  const lag = await lagging(folder, folder, {}, folder);
  const restarted = fresh_config_service();
  await restarted.get_config();
  // Editor saves put both themes in the copy's build, and the record then sends them to the folder in one batch.
  for (const path of ["themes/dusk.toml", "themes/dawn.toml"]) await restarted.save_config_file(path, FRAPPE, null);
  lag.local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] = { "themes/dusk.toml": null, "themes/dawn.toml": null };
  const held = hold_writes(lag.fake);
  // The next folder read answers what the folder held when it was asked, but only when the test says so.
  const send = lag.fake.runtime.sendNativeMessage;
  let hold_next_read = false;
  const held_reads: (() => void)[] = [];
  lag.fake.runtime.sendNativeMessage = (name: string, message: { cmd: string }) => {
    if (message.cmd !== "read_config" || !hold_next_read) return send(name, message);
    hold_next_read = false;
    const answer = send(name, message);
    return new Promise((resolve) => held_reads.push(() => resolve(answer)));
  };
  const start = restarted.reload_config_at_start();
  await until(() => held.length === 1, "the batch of both themes did not go out");
  hold_next_read = true;
  const pick = restarted.set_in_settings_file("theme", "dusk");
  await until(() => held_reads.length === 1, "the pick did not read the folder for its gate");
  held.shift()!();
  await until(() => !Object.hasOwn((unsynced_of(lag.local) ?? {}) as object, "themes/dusk.toml"), "the batch did not settle");
  // The pick's read holds neither theme file, and no write of them is out any more: only a read taken after they landed lets settings.toml name dusk.
  held_reads[0]!();
  await until(() => held.length === 1, "the pick's write did not go out");
  held.shift()!();
  assert.deepEqual(await pick, { kind: "written" });
  await start;
  assert.deepEqual(batches_sent(lag.sent), [["themes/dusk.toml", "themes/dawn.toml"], ["settings.toml"]]);
  assert.equal(lag.host.files["settings.toml"], with_theme("dusk"));
});

test("a refused batch that left a file it could not put back makes a gate read taken before it stale", { timeout: 5000 }, async () => {
  const folder = { "settings.toml": MINE, [THEME]: FRAPPE };
  const lag = await lagging(folder, { "settings.toml": MINE, [THEME]: EDITED, "keymap.toml": "" }, { [THEME]: FRAPPE, "keymap.toml": null }, folder, { refuse: ["keymap.toml"], unrestored: [THEME] });
  const held = hold_writes(lag.fake);
  const send = lag.fake.runtime.sendNativeMessage;
  let reads = 0;
  let hold_next_read = false;
  const held_reads: (() => void)[] = [];
  lag.fake.runtime.sendNativeMessage = (name: string, message: { cmd: string }) => {
    if (message.cmd !== "read_config") return send(name, message);
    reads += 1;
    if (!hold_next_read) return send(name, message);
    hold_next_read = false;
    const answer = send(name, message);
    return new Promise((resolve) => held_reads.push(() => resolve(answer)));
  };
  const restarted = fresh_config_service();
  await restarted.get_config();
  const start = restarted.reload_config_at_start();
  await until(() => held.length === 1, "the batch did not go out");
  hold_next_read = true;
  const pick = restarted.set_in_settings_file("hint_letters", "xyz");
  await until(() => held_reads.length === 1, "the pick did not read the folder for its gate");
  held.shift()!();
  await start;
  assert.equal(lag.host.files[THEME], EDITED);
  const reads_before = reads;
  held_reads[0]!();
  await until(() => held.length === 1, "the pick's write did not go out");
  // The theme file changed on disk though the batch failed, so the pick's gate reads the folder again.
  assert.equal(reads, reads_before + 1);
  held.shift()!();
  assert.deepEqual(await pick, { kind: "written" });
});
