import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import "../../src/background/command_modules.ts";
import { load_layers } from "../../src/background/edit_layers.ts";
import { holds_engine, PAGE_FILE_MARKER, page_path_is_hand_file } from "../../src/background/engine_file.ts";
import { KEYS_FILE_MARKER } from "../../src/background/engine_keys_file.ts";
import { create_engine_messages } from "../../src/background/engine_message.ts";
import { ENGINE_EDITS_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { build_files_config } from "../../src/background/config_reload.ts";
import { install_fake_browser, until, type FileEntry, type Files } from "./config_fake_browser.ts";
import { fresh_config_service, type ConfigService } from "./fresh_config_service.ts";

type Startup = ConfigService;

// The kinds of each `write_config_files` request in `sent`, one list per request.
const kinds_sent = (sent: { cmd: string; files?: FileEntry[] }[]) => sent.filter((message) => message.cmd === "write_config_files").map((message) => (message.files ?? []).map((file) => file.kind));

const FILE = "search_engines.d/zz-desertfox.toml";
const KEYS = "keymap.d/zz-desertfox.toml";
// The first lines of a page file and a keys file the page wrote.
const MARK = `${PAGE_FILE_MARKER}\n\n`;
const KEYS_MARK = `${KEYS_FILE_MARKER}\n\n`;
type Host = { files: Files; granted?: boolean; no_engines_kind?: boolean; no_keys_kind?: boolean; refuse?: string[] };

const messages_of = (startup: Startup) =>
  create_engine_messages({ read_engine_state: startup.read_engine_state, change_engine_file: startup.change_engine_file, read_starter: async () => readFileSync(new URL("../../examples/engines.toml", import.meta.url), "utf8") });

// A profile that read the folder once through the host, as after `,r`, so its changes go to the folder.
async function started(files: Files = { "settings.toml": "" }, host: Host = { files }, layer?: Record<string, unknown>) {
  const browser = install_fake_browser(host);
  if (layer) browser.local[ENGINE_EDITS_STORAGE_KEY] = layer;
  const startup = fresh_config_service();
  await startup.get_config();
  await startup.reload_config();
  return { host, startup, messages: messages_of(startup), ...browser };
}

const set = (name: string, url: string, extra: { keyword?: string; letter?: string } = {}) => ({ type: "change_engines", action: "set", name, url, ...extra }) as const;
const remove = (name: string) => ({ type: "change_engines", action: "remove", name }) as const;
const stored_files = (local: Record<string, unknown>) => (local[FILES_SOURCE_STORAGE_KEY] as { files: Files }).files;
const unsynced_of = (local: Record<string, unknown>) => local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] ?? undefined;

// A host whose `write_config_files` answers only when the test says so.
function hold_writes(fake: ReturnType<typeof install_fake_browser>["fake"]) {
  const send = fake.runtime.sendNativeMessage;
  const held: (() => void)[] = [];
  fake.runtime.sendNativeMessage = (name: string, message: { cmd: string }) => {
    if (message.cmd !== "write_config_files") return send(name, message);
    return new Promise((resolve) => held.push(() => resolve(send(name, message))));
  };
  return held;
}

test("a saved engine goes into the page's file in the copy and the folder, and the last remove deletes the file", async () => {
  const { host, messages, local } = await started();
  assert.equal((await messages.change(set("wiki", "https://w.test/?q={query}", { keyword: "w" }))).ok, true);
  const second = await messages.change(set("docs", "https://d.test/?q={query}"));
  assert.deepEqual(second, { ok: true, message: `Saved the engine docs to ${FILE}.` });
  assert.equal(host.files[FILE], MARK + '[wiki]\nurl = "https://w.test/?q={query}"\nkeyword = "w"\n\n[docs]\nurl = "https://d.test/?q={query}"\n');
  assert.equal(stored_files(local)[FILE], host.files[FILE]);
  assert.equal(unsynced_of(local), undefined);
  assert.deepEqual(await messages.list(), { ok: true, engines: [{ name: "wiki", url: "https://w.test/?q={query}", label: "wiki", keyword: "w", children: 0 }, { name: "docs", url: "https://d.test/?q={query}", label: "docs", children: 0 }] });

  assert.deepEqual(await messages.change(remove("wiki")), { ok: true, message: `Removed the engine wiki from ${FILE}.` });
  assert.deepEqual(await messages.change(remove("docs")), { ok: true, message: `Removed the engine docs. ${FILE} held no other engine, so it is deleted.` });
  assert.equal(host.files[FILE], undefined);
  assert.equal(stored_files(local)[FILE], undefined);
  assert.deepEqual(await messages.change(remove("docs")), { ok: false, message: "No engine docs was added on this page.", problems: [] });
});

test("an engine a hand file defines is refused by name for a save and a remove, and the starter set skips it", async () => {
  const files = { "settings.toml": "", "search_engines.toml": 'mine = { url = "https://m.test/?q={query}" }\n', "search_engines.d/10-more.toml": '[arch]\nurl = "https://a.test/?q={query}"\n' };
  const { host, messages, sent } = await started(files);
  sent.length = 0;
  const saved = await messages.change(set("mine", "https://x.test/?q={query}"));
  assert.deepEqual(saved, { ok: false, message: "The engine mine is in search_engines.toml, which this page does not change. Change it there.", problems: [] });
  const removed = await messages.change(remove("arch"));
  assert.deepEqual(removed, { ok: false, message: "The engine arch is in search_engines.d/10-more.toml, which this page does not change. Remove it there.", problems: [] });
  assert.ok(!sent.some((message) => message.cmd === "write_config_files"));
  const starter = await messages.change({ type: "change_engines", action: "starter" });
  assert.ok(starter.ok && /Skipped 1/.test(starter.message) && starter.message.includes(`to ${FILE}`), starter.ok ? starter.message : "");
  assert.doesNotMatch(host.files[FILE]!, /^\[arch\]/m);
  assert.equal(host.files["search_engines.toml"], files["search_engines.toml"]);
});

test("a save of an engine the old browser layer holds moves it into the file with its label and children, and its letter into the keys file", async () => {
  const layer = { engines: { gh: { url: "https://github.com/search?q={query}", label: "GitHub", keyword: "g", repo: { url: "https://github.com/{repo}/search?q={query}", label: "Repo" } }, other: { url: "https://o.test/?q={query}" } }, letters: { g: "gh" } };
  const { host, startup, messages } = await started(undefined, undefined, layer);
  const answer = await messages.change(set("gh", "https://github.com/search?q={query}&type=code", { letter: "g" }));
  assert.equal(answer.ok, true, answer.message);
  assert.equal(host.files[FILE], MARK + '[gh]\nurl = "https://github.com/search?q={query}&type=code"\nlabel = "GitHub"\n\n[gh.repo]\nurl = "https://github.com/{repo}/search?q={query}"\nlabel = "Repo"\n');
  assert.equal(host.files[KEYS], KEYS_MARK + '[search_keys]\ng = "gh"\n');
  assert.deepEqual((await load_layers()).engines, { engines: { other: { url: "https://o.test/?q={query}" } } });
  const config = await startup.get_config();
  assert.equal(config.search_engines.gh?.keyword, undefined);
  assert.ok(config.search_engines["gh.repo"]);
  assert.equal(config.keymap.search_keys?.g, "gh");
  const listed = await messages.list();
  assert.deepEqual(listed.ok && listed.engines.map((row) => [row.name, row.letter ?? ""]), [["gh", "g"], ["other", ""]]);
  // A remove of an engine still in the layer changes no file.
  assert.deepEqual(await messages.change(remove("other")), { ok: true, message: "Removed the engine other." });
  assert.equal((await load_layers()).engines, undefined);
});

test("a remove of an engine whose old layer letter names it takes the letter in the same storage write as the file", async () => {
  const { messages, startup, local, fake } = await started({ "settings.toml": "", [FILE]: MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n' }, undefined, { letters: { w: "wiki" } });
  assert.equal((await startup.get_config()).keymap.search_keys?.w, "wiki");
  const writes: string[][] = [];
  const store_set = fake.storage.local.set;
  fake.storage.local.set = async (values: Record<string, unknown>) => {
    writes.push(Object.keys(values));
    await store_set(values);
  };
  assert.equal((await messages.change(remove("wiki"))).ok, true);
  const together = writes.find((keys) => keys.includes(ENGINE_EDITS_STORAGE_KEY));
  assert.ok(together?.includes(FILES_SOURCE_STORAGE_KEY), JSON.stringify(writes));
  assert.deepEqual(local[ENGINE_EDITS_STORAGE_KEY], { engines: {}, letters: {} });
  assert.equal((await startup.get_config()).keymap.search_keys?.w, undefined);
});

test("two saves sent while the first write is out reach the folder in order, and neither is lost", async () => {
  const { host, messages, fake, local } = await started();
  const held = hold_writes(fake);
  const first = messages.change(set("one", "https://1.test/?q={query}"));
  await until(() => held.length === 1, "the first write did not go out");
  const second = messages.change(set("two", "https://2.test/?q={query}"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(held.length, 1, "a second write went out while the first was out");
  held.shift()!();
  await until(() => held.length === 1, "the second write did not go out after the first");
  assert.match(host.files[FILE]!, /\[one\]/);
  held.shift()!();
  const answers = await Promise.all([first, second]);
  assert.deepEqual(answers.map((answer) => answer.message), [`Saved the engine one to ${FILE}.`, `Saved the engine two to ${FILE}.`]);
  assert.equal(host.files[FILE], MARK + '[one]\nurl = "https://1.test/?q={query}"\n\n[two]\nurl = "https://2.test/?q={query}"\n');
  assert.equal(unsynced_of(local), undefined);
});

test("a page's file made by hand since the last read is never overwritten, and the question is asked", async () => {
  const { host, messages, local } = await started();
  host.files = { ...host.files, [FILE]: "# mine\n[hand]\nurl = \"https://h.test/?q={query}\"\n" };
  const answer = await messages.change(set("wiki", "https://w.test/?q={query}"));
  assert.ok(answer.ok);
  assert.match(answer.message, /search_engines\.d\/zz-desertfox\.toml changed on disk, so it stays as it is/);
  assert.equal(host.files[FILE], "# mine\n[hand]\nurl = \"https://h.test/?q={query}\"\n");
  assert.notEqual(local[HOST_START_PENDING_STORAGE_KEY], undefined);
  assert.equal(unsynced_of(local), undefined);
});

test("a host without the engines kind leaves the file in the copy with the record pending, and the updated host writes it", async () => {
  const files = { "settings.toml": "" };
  const host: Host = { files, no_engines_kind: true };
  const { messages, startup, local } = await started(files, host);
  const answer = await messages.change(set("wiki", "https://w.test/?q={query}"));
  assert.deepEqual(answer, { ok: true, message: `Saved the engine wiki. ${FILE} updates once the native host is updated.` });
  assert.ok((await startup.get_config()).search_engines.wiki);
  assert.deepEqual(unsynced_of(local), { [FILE]: null });
  assert.equal(host.files[FILE], undefined);

  host.no_engines_kind = false;
  const updated = fresh_config_service();
  await updated.reload_config_at_start();
  assert.equal(host.files[FILE], MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n');
  assert.equal(unsynced_of(local), undefined);
});

test("without the host a save waits, and the next start writes the file", async () => {
  const files = { "settings.toml": "" };
  const host: Host = { files };
  const { messages, local } = await started(files, host);
  host.granted = false;
  const answer = await messages.change(set("wiki", "https://w.test/?q={query}"));
  assert.deepEqual(answer, { ok: true, message: `Saved the engine wiki. ${FILE} updates when the native host connects.` });
  assert.deepEqual(unsynced_of(local), { [FILE]: null });
  host.granted = true;
  const restarted = fresh_config_service();
  await restarted.reload_config_at_start();
  assert.equal(host.files[FILE], MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n');
  assert.equal(unsynced_of(local), undefined);
});

test("a settings.toml that names a page engine the folder lacks takes the waiting page's file into its batch, even when its own edit came first", async () => {
  const files = { "settings.toml": "" };
  const host: Host = { files, no_engines_kind: true };
  const { messages, startup, local, sent } = await started(files, host);
  host.granted = false;
  await startup.set_in_settings_file("default_engine", "duck");
  host.granted = true;
  // settings.toml is in the record before the page's file.
  await messages.change(set("wiki", "https://w.test/?q={query}"));
  // settings.toml alone names an engine the folder lacks, so the gate holds it and the batch takes the waiting page's file too.
  assert.deepEqual(await startup.set_in_settings_file("default_engine", "wiki"), { kind: "waiting", host_outdated: true });
  assert.deepEqual(Object.keys(unsynced_of(local) as object), ["settings.toml", FILE]);
  assert.equal(host.files["settings.toml"], "");

  host.no_engines_kind = false;
  sent.length = 0;
  const updated = fresh_config_service();
  await updated.reload_config_at_start();
  assert.deepEqual(kinds_sent(sent), [["settings", "engines"]]);
  assert.equal(host.files["settings.toml"], 'default_engine = "wiki"\n');
  assert.equal(unsynced_of(local), undefined);
  await updated.reload_config();
});

test("removing the default engine is refused and names settings.toml", async () => {
  const { messages, startup, host } = await started();
  await messages.change(set("wiki", "https://w.test/?q={query}"));
  await startup.set_in_settings_file("default_engine", "wiki");
  const answer = await messages.change(remove("wiki"));
  assert.equal(answer.ok, false);
  assert.match(answer.message, /settings\.toml: default_engine: unknown search engine "wiki"/);
  assert.match(host.files[FILE]!, /\[wiki\]/);
});

test("with no config folder, a save changes only the browser copy and says so", async () => {
  const browser = install_fake_browser({ files: {}, granted: false });
  const startup = fresh_config_service();
  await startup.get_config();
  const answer = await messages_of(startup).change(set("wiki", "https://w.test/?q={query}"));
  assert.deepEqual(answer, { ok: true, message: `Saved the engine wiki, saved in the browser copy. It did not come from a config folder, so no ${FILE} is written.` });
  assert.match(stored_files(browser.local)[FILE]!, /\[wiki\]/);
  assert.equal(unsynced_of(browser.local), undefined);
});

// Every folder state the host leaves after a write: the `default_engine` of settings.toml, and whether the page's file or a built-in engine has it.
function watch_folder_states(fake: ReturnType<typeof install_fake_browser>["fake"], host: Host) {
  const states: { kinds: string; named?: string; defined: boolean }[] = [];
  const send = fake.runtime.sendNativeMessage;
  fake.runtime.sendNativeMessage = async (name: string, message: { cmd: string }) => {
    const reply = await send(name, message);
    if (message.cmd === "write_config_files" && (reply as { ok: boolean }).ok) {
      const named = /default_engine = "([^"]+)"/.exec(host.files["settings.toml"] ?? "")?.[1];
      states.push({ kinds: ((message as { files?: FileEntry[] }).files ?? []).map((file) => file.kind).join(","), ...(named !== undefined && { named }), defined: named === undefined || named === "duck" || new RegExp(`^\\[${named}\\]`, "m").test(host.files[FILE] ?? "") });
    }
    return reply;
  };
  return states;
}

// The folder names `old` as the default engine and the page's file holds it. Without a host that writes the page's file, the copy gets `wiki`, names it the default and drops `old`.
async function replaced_default_engine(host: Host, cut_host: (host: Host) => void) {
  host.files = { "settings.toml": 'default_engine = "old"\n', [FILE]: MARK + '[old]\nurl = "https://o.test/?q={query}"\n' };
  const { messages, startup, local, fake } = await started(host.files, host);
  cut_host(host);
  assert.equal((await messages.change(set("wiki", "https://w.test/?q={query}"))).ok, true);
  assert.equal((await startup.set_in_settings_file("default_engine", "wiki")).kind, "waiting");
  const removed = await messages.change(remove("old"));
  assert.ok(removed.ok, removed.message);
  assert.deepEqual(Object.keys(unsynced_of(local) as object).sort(), [FILE, "settings.toml"]);
  return { local, fake };
}

for (const [label, cut_host] of [
  ["gone", (host: Host) => void (host.granted = false)],
  ["without the engines kind", (host: Host) => void (host.no_engines_kind = true)],
] as const) {
  test(`a new default engine and the removal of the old one, with the host ${label}, reach the folder at the next start in one batch`, async () => {
    const host: Host = { files: {} };
    const { local, fake } = await replaced_default_engine(host, cut_host);
    host.granted = true;
    host.no_engines_kind = false;
    const states = watch_folder_states(fake, host);
    const restarted = fresh_config_service();
    await restarted.reload_config_at_start();
    assert.equal(states.length, 1);
    assert.ok(states.every((state) => state.defined), JSON.stringify(states));
    assert.equal(host.files[FILE], MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n');
    assert.equal(host.files["settings.toml"], 'default_engine = "wiki"\n');
    assert.equal(unsynced_of(local), undefined);
  });
}

test("a remove of the engine the folder's settings.toml names takes the waiting settings.toml into its batch, so both land at once", async () => {
  const host: Host = { files: { "settings.toml": 'default_engine = "old"\n', [FILE]: MARK + '[old]\nurl = "https://o.test/?q={query}"\n[keep]\nurl = "https://k.test/?q={query}"\n' } };
  const { messages, startup, local, fake } = await started(host.files, host);
  host.no_engines_kind = true;
  await messages.change(set("wiki", "https://w.test/?q={query}"));
  await startup.set_in_settings_file("default_engine", "wiki");
  host.no_engines_kind = false;
  const states = watch_folder_states(fake, host);
  const removed = await messages.change(remove("old"));
  assert.deepEqual(removed, { ok: true, message: `Removed the engine old from ${FILE}.` });
  assert.deepEqual(states.map((state) => state.kinds), ["engines,settings"]);
  assert.ok(states.every((state) => state.defined), JSON.stringify(states));
  assert.doesNotMatch(host.files[FILE]!, /\[old\]/);
  assert.equal(host.files["settings.toml"], 'default_engine = "wiki"\n');
  assert.equal(unsynced_of(local), undefined);
});

test("a settings.toml that stops naming an engine lands in one batch with the page's file that drops it", async () => {
  const host: Host = { files: { "settings.toml": 'default_engine = "wiki"\n', [FILE]: MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n' } };
  const { messages, startup, local, fake } = await started(host.files, host);
  host.granted = false;
  // The page's file goes into the record first.
  await messages.change(set("other", "https://o.test/?q={query}"));
  await startup.set_in_settings_file("default_engine", "duck");
  await messages.change(remove("wiki"));
  assert.deepEqual(Object.keys(unsynced_of(local) as object), [FILE, "settings.toml"]);
  host.granted = true;
  const states = watch_folder_states(fake, host);
  await (fresh_config_service()).reload_config_at_start();
  assert.deepEqual(states.map((state) => state.kinds), ["engines,settings"]);
  assert.ok(states.every((state) => state.defined), JSON.stringify(states));
});

test("a remove waits for a settings.toml write that is out and still names the engine", async () => {
  const { host, messages, startup, fake } = await started({ "settings.toml": "", [FILE]: MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n' });
  const held = hold_writes(fake);
  const naming = startup.set_in_settings_file("default_engine", "wiki");
  await until(() => held.length === 1, "the settings.toml write did not go out");
  const back = startup.set_in_settings_file("default_engine", "duck");
  const removing = messages.change(remove("wiki"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(held.length, 1, "the page's file went out while settings.toml still named wiki");
  held.shift()!();
  await until(() => held.length === 1, "the second settings.toml write did not go out");
  assert.match(host.files[FILE]!, /\[wiki\]/);
  held.shift()!();
  await until(() => held.length === 1, "the page's file did not go out after settings.toml");
  assert.equal(host.files["settings.toml"], 'default_engine = "duck"\n');
  held.shift()!();
  const answers = await Promise.all([naming, back, removing]);
  assert.ok(answers.every((answer) => ("ok" in answer ? answer.ok : answer.kind === "written")), JSON.stringify(answers));
  assert.equal(host.files[FILE], undefined);
});

test("a default engine that is a child of a page engine takes the waiting page's file into its batch", async () => {
  const files = { "settings.toml": "" };
  const host: Host = { files };
  const { messages, startup, local, sent } = await started(files, host);
  host.granted = false;
  await startup.set_in_settings_file("default_engine", "duck");
  host.granted = true;
  host.no_engines_kind = true;
  assert.equal((await messages.change({ type: "change_engines", action: "starter" })).ok, true);
  assert.deepEqual(await startup.set_in_settings_file("default_engine", "github.issues"), { kind: "waiting", host_outdated: true });
  assert.equal(host.files["settings.toml"], "");
  assert.deepEqual(Object.keys(unsynced_of(local) as object), ["settings.toml", FILE]);
  host.no_engines_kind = false;
  sent.length = 0;
  await (fresh_config_service()).reload_config_at_start();
  assert.deepEqual(kinds_sent(sent), [["settings", "engines"]]);
  assert.equal(host.files["settings.toml"], 'default_engine = "github.issues"\n');
});

test("a page engine path names a child table or a child a param makes, never params itself", () => {
  const tables = { gh: { url: "u", repo: { url: "r" }, params: { type: { values: { a: "x" }, children: true } } }, plain: { url: "p" } };
  assert.equal(holds_engine(tables, "gh"), true);
  assert.equal(holds_engine(tables, "gh.repo"), true);
  assert.equal(holds_engine(tables, "gh.a"), true);
  assert.equal(holds_engine(tables, "gh.b"), false);
  assert.equal(holds_engine(tables, "gh.params"), false);
  assert.equal(holds_engine(tables, "plain.x"), false);
  assert.equal(holds_engine(tables, "none"), false);
});

test("a remove whose storage write fails puts the page's file and the old layer's key letter back together", async () => {
  const { messages, startup, local, fake } = await started({ "settings.toml": "", [FILE]: MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n' }, undefined, { letters: { w: "wiki" } });
  const file_before = stored_files(local)[FILE];
  const layer_before = structuredClone(local[ENGINE_EDITS_STORAGE_KEY]);
  const store_set = fake.storage.local.set;
  let failed = false;
  fake.storage.local.set = async (values: Record<string, unknown>) => {
    if (!failed && ENGINE_EDITS_STORAGE_KEY in values && FILES_SOURCE_STORAGE_KEY in values) {
      failed = true;
      // Half the write lands, as a stop between two keys would leave it.
      await store_set({ [ENGINE_EDITS_STORAGE_KEY]: values[ENGINE_EDITS_STORAGE_KEY] });
      throw new Error("disk full");
    }
    await store_set(values);
  };
  const answer = await messages.change(remove("wiki"));
  assert.equal(answer.ok, false);
  assert.ok(failed);
  assert.deepEqual(local[ENGINE_EDITS_STORAGE_KEY], layer_before);
  assert.deepEqual((await load_layers()).engines, { letters: { w: "wiki" } });
  assert.equal(stored_files(local)[FILE], file_before);
  const config = await startup.get_config();
  assert.ok(config.search_engines.wiki);
  assert.equal(config.keymap.search_keys?.w, "wiki");
});

// Every folder state the host leaves after a write, built as a `,r` would build it. A start after each write must build.
function watch_folder_builds(fake: ReturnType<typeof install_fake_browser>["fake"], host: Host) {
  const broken: string[] = [];
  const send = fake.runtime.sendNativeMessage;
  fake.runtime.sendNativeMessage = async (name: string, message: { cmd: string }) => {
    const reply = await send(name, message);
    if (message.cmd === "write_config_files" && (reply as { ok: boolean }).ok) {
      try {
        build_files_config(host.files, "folder", [], "reload");
      } catch (error) {
        broken.push(error instanceof Error ? error.message : String(error));
      }
    }
    return reply;
  };
  return broken;
}

test("a settings.toml that names an engine waits while a write that drops that engine is out", async () => {
  const { host, messages, startup, fake } = await started({ "settings.toml": "", [FILE]: MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n\n[keep]\nurl = "https://k.test/?q={query}"\n' });
  const broken = watch_folder_builds(fake, host);
  const held = hold_writes(fake);
  const removing = messages.change(remove("wiki"));
  await until(() => held.length === 1, "the removal did not go out");
  const adding = messages.change(set("wiki", "https://w.test/?q={query}"));
  const naming = startup.set_in_settings_file("default_engine", "wiki");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(held.length, 1, "settings.toml went out beside the removal of the engine it names");
  while (held.length > 0 || !(await Promise.race([naming.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 20))]))) {
    if (held.length > 0) held.shift()!();
  }
  const answers = await Promise.all([removing, adding]);
  assert.ok(answers.every((answer) => answer.ok), JSON.stringify(answers));
  assert.deepEqual(await naming, { kind: "written" });
  assert.deepEqual(broken, []);
  assert.equal(host.files["settings.toml"], 'default_engine = "wiki"\n');
  assert.match(host.files[FILE]!, /^\[wiki\]/m);
});

// The folder names `old` (keyword o) as the default. Without a host the copy gets `wiki`, names it the default, drops `old`, then gives `wiki` the keyword o.
test("a new default engine that takes the keyword of the old one it replaces lands in one batch", async () => {
  const host: Host = { files: { "settings.toml": 'default_engine = "old"\n', [FILE]: MARK + '[old]\nurl = "https://o.test/?q={query}"\nkeyword = "o"\n' } };
  const { messages, startup, local } = await started(host.files, host);
  host.granted = false;
  await messages.change(set("wiki", "https://w.test/?q={query}"));
  await startup.set_in_settings_file("default_engine", "wiki");
  await messages.change(remove("old"));
  assert.equal((await messages.change(set("wiki", "https://w.test/?q={query}", { keyword: "o" }))).ok, true);
  host.granted = true;
  await (fresh_config_service()).reload_config_at_start();
  assert.deepEqual(host.files, { "settings.toml": 'default_engine = "wiki"\n', [FILE]: MARK + '[wiki]\nurl = "https://w.test/?q={query}"\nkeyword = "o"\n' });
  assert.equal(unsynced_of(local), undefined);
});

test("a new default engine and the removal of the default child the folder names land in one batch", async () => {
  const host: Host = { files: { "settings.toml": 'default_engine = "wiki.images"\n', [FILE]: MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n\n[wiki.images]\nurl = "https://w.test/i?q={query}"\n' } };
  const { messages, startup, local } = await started(host.files, host);
  host.granted = false;
  await messages.change(set("docs", "https://d.test/?q={query}"));
  await startup.set_in_settings_file("default_engine", "docs");
  await messages.change(remove("wiki"));
  await messages.change(set("wiki", "https://w.test/?q={query}"));
  host.granted = true;
  await (fresh_config_service()).reload_config_at_start();
  assert.equal(host.files["settings.toml"], 'default_engine = "docs"\n');
  assert.equal(host.files[FILE], stored_files(local)[FILE]);
  assert.doesNotMatch(host.files[FILE]!, /images/);
  assert.equal(unsynced_of(local), undefined);
});

test("a remove of an engine that a settings.d file in the folder names waits and says why", async () => {
  const { host, messages, startup, local } = await started({ "settings.toml": "", "settings.d/10-search.toml": 'default_engine = "wiki"\n', [FILE]: MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n\n[keep]\nurl = "https://k.test/?q={query}"\n' });
  // The browser copy of the settings.d file changes in the Files editor, which writes nothing to the folder.
  await startup.save_config_file("settings.d/10-search.toml", 'default_engine = "duck"\n', 'default_engine = "wiki"\n');
  const answer = await messages.change(remove("wiki"));
  assert.ok(answer.ok);
  assert.match(answer.message, /zz-desertfox\.toml waits, because the config folder would not build with it \(.*default_engine: unknown search engine "wiki"\)/);
  assert.match(host.files[FILE]!, /^\[wiki\]/m);
  assert.deepEqual(Object.keys(unsynced_of(local) as object), [FILE]);
});

test("a default engine whose page-file write went to the question is not written to the folder", async () => {
  const files = { "settings.toml": "" };
  const host: Host = { files };
  const { messages, startup, local } = await started(files, host);
  host.granted = false;
  await messages.change(set("wiki", "https://w.test/?q={query}"));
  await startup.set_in_settings_file("default_engine", "wiki");
  host.granted = true;
  host.files = { ...host.files, [FILE]: '[hand]\nurl = "https://h.test/?q={query}"\n' };
  await (fresh_config_service()).reload_config_at_start();
  assert.equal(host.files["settings.toml"], "");
  assert.equal(host.files[FILE], '[hand]\nurl = "https://h.test/?q={query}"\n');
  assert.deepEqual(Object.keys(unsynced_of(local) as object), ["settings.toml"]);
});

test("a settings.toml that names a new theme and a new page engine lands with both in one batch at the next start", async () => {
  const files = { "settings.toml": "" };
  const host: Host = { files };
  const { messages, startup, local, sent } = await started(files, host);
  host.granted = false;
  // settings.toml goes into the record first.
  await startup.set_in_settings_file("default_engine", "duck");
  await startup.set_theme_file("mine", '[dark]\nbg_core = "#000000"\nfg_core = "#ffffff"\nprimary = "#ff0000"\naccent = "#00ff00"\n', false);
  await messages.change(set("wiki", "https://w.test/?q={query}"));
  await startup.set_in_settings_file("theme", "mine");
  await startup.set_in_settings_file("default_engine", "wiki");
  assert.equal(Object.keys(unsynced_of(local) as object)[0], "settings.toml");
  host.granted = true;
  sent.length = 0;
  await (fresh_config_service()).reload_config_at_start();
  assert.deepEqual(kinds_sent(sent), [["settings", "theme", "engines"]]);
  assert.equal(host.files["settings.toml"], 'default_engine = "wiki"\ntheme = "mine"\n');
  assert.equal(unsynced_of(local), undefined);
});

test("a page-path file written by hand stays the user's: its engines are not listed and every write to it is refused by name", async () => {
  const hand = '# my engines\n[mine]\nurl = "https://m.test/?q={query}"\n';
  const { host, messages, sent } = await started({ "settings.toml": "", [FILE]: hand });
  sent.length = 0;
  assert.deepEqual(await messages.list(), { ok: true, engines: [] });
  const refusal = `${FILE} was not written by the Engines page, so the page does not change it. Rename it, or move its engines to another search_engines.d file.`;
  assert.deepEqual(await messages.change(set("wiki", "https://w.test/?q={query}")), { ok: false, message: refusal, problems: [] });
  assert.deepEqual(await messages.change({ type: "change_engines", action: "starter" }), { ok: false, message: refusal, problems: [] });
  assert.match((await messages.change(set("mine", "https://x.test/?q={query}"))).message, /The engine mine is in search_engines\.d\/zz-desertfox\.toml, which this page does not change/);
  assert.match((await messages.change(remove("mine"))).message, /The engine mine is in search_engines\.d\/zz-desertfox\.toml/);
  assert.equal(host.files[FILE], hand);
  assert.ok(!sent.some((message) => message.cmd === "write_config_files"));
});

test("a hand file that holds only a child table of a page engine does not take the engine from the page", async () => {
  const { host, messages } = await started({ "settings.toml": "", "search_engines.toml": '[wiki.images]\nurl = "https://w.test/i?q={query}"\n', [FILE]: MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n' });
  const answer = await messages.change(set("wiki", "https://w.test/?q={query}&new=1"));
  assert.equal(answer.ok, true, answer.message);
  assert.match(host.files[FILE]!, /new=1/);
});

test("a write whose gate cannot read the folder is held, and nothing goes out", async () => {
  const { host, messages, fake, local, sent } = await started({ "settings.toml": "", "settings.d/10-search.toml": 'default_engine = "duck"\n', [FILE]: MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n\n[keep]\nurl = "https://k.test/?q={query}"\n' });
  const send = fake.runtime.sendNativeMessage;
  fake.runtime.sendNativeMessage = (name: string, message: { cmd: string }) => (message.cmd === "read_config" ? Promise.reject(new Error("read failed")) : send(name, message));
  sent.length = 0;
  const answer = await messages.change(remove("wiki"));
  assert.ok(answer.ok);
  assert.match(answer.message, /zz-desertfox\.toml waits, because the config folder could not be read to check the write \(.*read failed\)/);
  assert.ok(!sent.some((message) => message.cmd === "write_config_files"));
  assert.match(host.files[FILE]!, /^\[wiki\]/m);
  assert.deepEqual(Object.keys(unsynced_of(local) as object), [FILE]);
});

test("a held write says what clears it when it keeps waiting", async () => {
  const { messages, startup } = await started({ "settings.toml": "", "settings.d/10-search.toml": 'default_engine = "wiki"\n', [FILE]: MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n\n[keep]\nurl = "https://k.test/?q={query}"\n' });
  await startup.save_config_file("settings.d/10-search.toml", 'default_engine = "duck"\n', 'default_engine = "wiki"\n');
  const answer = await messages.change(remove("wiki"));
  assert.match(answer.message, /change the folder's files by hand, or press ,r to take the folder's files and drop the browser's change\.$/);
});

test("a write that lands between the gate's folder read and its check makes the gate read the folder again", async () => {
  const { host, messages, startup, fake } = await started({ "settings.toml": "", [FILE]: MARK + '[keep]\nurl = "https://k.test/?q={query}"\n' });
  const held = hold_writes(fake);
  // Holds the next folder read when the test arms it, and counts every read.
  const send = fake.runtime.sendNativeMessage;
  const held_reads: (() => void)[] = [];
  let reads = 0;
  let hold_next_read = false;
  fake.runtime.sendNativeMessage = (name: string, message: { cmd: string }) => {
    if (message.cmd !== "read_config") return send(name, message);
    reads += 1;
    if (!hold_next_read) return send(name, message);
    hold_next_read = false;
    const answer = send(name, message);
    return new Promise((resolve) => held_reads.push(() => resolve(answer)));
  };
  const picking = startup.set_in_settings_file("default_engine", "duck");
  await until(() => held.length === 1, "the settings.toml write did not go out");
  hold_next_read = true;
  const saving = messages.change(set("wiki", "https://w.test/?q={query}"));
  await until(() => held_reads.length === 1, "the gate did not read the folder");
  const reads_before = reads;
  held.shift()!();
  assert.deepEqual(await picking, { kind: "written" });
  held_reads.shift()!();
  await until(() => held.length === 1, "the page file write did not go out");
  assert.equal(reads, reads_before + 1, "the gate sent the write on a read from before the settings.toml write landed");
  held.shift()!();
  assert.equal((await saving).ok, true);
  assert.match(host.files[FILE]!, /^\[wiki\]/m);
});

test("only a first line that is the whole marker makes the page's path the page's file", () => {
  assert.equal(page_path_is_hand_file({ [FILE]: MARK + "[a]\n" }), false);
  assert.equal(page_path_is_hand_file({ [FILE]: `${PAGE_FILE_MARKER}\r\n[a]\r\n` }), false);
  assert.equal(page_path_is_hand_file({ [FILE]: PAGE_FILE_MARKER }), false);
  assert.equal(page_path_is_hand_file({ [FILE]: `${PAGE_FILE_MARKER} and my notes\n[a]\n` }), true);
});

test("a save whose browser copy an import replaced does not say its key letter searches it", async () => {
  // The folder already holds the imported keymap.toml, so the import writes nothing of its own.
  const { messages, startup, fake } = await started({ "settings.toml": "", "keymap.toml": "" });
  const held = hold_writes(fake);
  const saving = messages.change(set("wiki", "https://w.test/?q={query}", { letter: "W" }));
  await until(() => held.length === 1, "the page's file write did not go out");
  await startup.import_config({ kind: "folder", entries: [{ path: "keymap.toml", text: "" }] }, {});
  held.shift()!();
  const answer = await saving;
  assert.equal(answer.ok, true, answer.message);
  assert.match(answer.message, /A config import replaced the browser copy/);
  assert.doesNotMatch(answer.message, /sW searches/);
});


test("a key letter goes to the keys file in one batch with the engine file, the page lists it, and a remove takes both out together", async () => {
  const { host, messages, local, sent, fake } = await started();
  const broken = watch_folder_builds(fake, host);
  sent.length = 0;
  const saved = await messages.change(set("wiki", "https://w.test/?q={query}", { letter: "w" }));
  assert.deepEqual(saved, { ok: true, message: `Saved the engine wiki to ${FILE}. Saved its key letter to ${KEYS}. sw searches it.` });
  assert.deepEqual(kinds_sent(sent), [["engines", "search_keys"]]);
  assert.equal(host.files[KEYS], KEYS_MARK + '[search_keys]\nw = "wiki"\n');
  assert.equal(stored_files(local)[KEYS], host.files[KEYS]);
  assert.equal(local[ENGINE_EDITS_STORAGE_KEY], undefined);
  await messages.change(set("docs", "https://d.test/?q={query}", { letter: "d" }));
  const listed = await messages.list();
  assert.deepEqual(listed.ok && listed.engines.map((row) => [row.name, row.letter]), [["wiki", "w"], ["docs", "d"]]);

  sent.length = 0;
  assert.deepEqual(await messages.change(remove("wiki")), { ok: true, message: `Removed the engine wiki from ${FILE}. Removed its key letter from ${KEYS}.` });
  assert.deepEqual(kinds_sent(sent), [["engines", "search_keys"]]);
  assert.deepEqual(await messages.change(remove("docs")), { ok: true, message: `Removed the engine docs. ${FILE} held no other engine, so it is deleted. Removed its key letter. ${KEYS} held no other key letter, so it is deleted.` });
  assert.equal(host.files[KEYS], undefined);
  assert.deepEqual(broken, []);
  assert.equal(unsynced_of(local), undefined);
});

test("a save without a letter takes the engine's letter out of the keys file, and one without any letter leaves the file alone", async () => {
  const { host, messages, sent } = await started();
  await messages.change(set("wiki", "https://w.test/?q={query}", { letter: "w" }));
  await messages.change(set("docs", "https://d.test/?q={query}", { letter: "d" }));
  assert.deepEqual(await messages.change(set("wiki", "https://w.test/?q={query}&x=1")), { ok: true, message: `Saved the engine wiki to ${FILE}. Removed its key letter from ${KEYS}.` });
  assert.equal(host.files[KEYS], KEYS_MARK + '[search_keys]\nd = "docs"\n');
  sent.length = 0;
  assert.deepEqual(await messages.change(set("wiki", "https://w.test/?q={query}&x=2")), { ok: true, message: `Saved the engine wiki to ${FILE}.` });
  assert.deepEqual(kinds_sent(sent), [["engines"]]);
  assert.deepEqual(await messages.change(set("docs", "https://d.test/?q={query}")), { ok: true, message: `Saved the engine docs. Removed its key letter. ${KEYS} held no other key letter, so it is deleted.` });
  assert.equal(host.files[KEYS], undefined);
});

test("a letter another page engine had moves to the saved engine, and the reply names the engine it searched", async () => {
  const { host, messages, startup } = await started();
  await messages.change(set("wiki", "https://w.test/?q={query}", { letter: "w" }));
  const moved = await messages.change(set("wolf", "https://wolf.test/?q={query}", { letter: "w" }));
  assert.deepEqual(moved, { ok: true, message: `Saved the engine wolf to ${FILE}. Saved its key letter to ${KEYS}. sw searches it, where it searched wiki.` });
  assert.equal(host.files[KEYS], KEYS_MARK + '[search_keys]\nw = "wolf"\n');
  assert.equal((await startup.get_config()).keymap.search_keys?.w, "wolf");
});

test("a letter a hand file loaded earlier binds replaces it, and the hand file stays as written", async () => {
  const hand = '[search_keys]\nw = "duck"\n';
  const { host, messages, startup } = await started({ "settings.toml": "", "keymap.d/10-mine.toml": hand });
  const answer = await messages.change(set("wiki", "https://w.test/?q={query}", { letter: "w" }));
  assert.deepEqual(answer, { ok: true, message: `Saved the engine wiki to ${FILE}. Saved its key letter to ${KEYS}. sw searches it, where it searched duck.` });
  assert.equal(host.files["keymap.d/10-mine.toml"], hand);
  assert.equal((await startup.get_config()).keymap.search_keys?.w, "wiki");
});

test("a letter a keymap.d file loaded after the keys file binds to another engine is refused by name, and nothing is written", async () => {
  const page_file = MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n';
  const { host, messages, sent } = await started({ "settings.toml": "", [FILE]: page_file, "keymap.d/zz-mine.toml": '[search_keys]\nw = "duck"\nd = "wiki"\n' });
  sent.length = 0;
  const answer = await messages.change(set("wiki", "https://w.test/?q={query}&x=1", { letter: "w" }));
  assert.deepEqual(answer, { ok: false, message: `keymap.d/zz-mine.toml sets the key letter w in [search_keys], and it wins over ${KEYS}. Change it there, or pick another letter.`, problems: [] });
  assert.deepEqual(kinds_sent(sent), []);
  assert.equal(host.files[FILE], page_file);
  // The later file binds d to this same engine, so the page's d takes nothing from it.
  assert.equal((await messages.change(set("wiki", "https://w.test/?q={query}", { letter: "d" }))).ok, true);
});

test("a later keymap.d file that spells the letter another way still counts as setting it", async () => {
  const { messages } = await started({ "settings.toml": "", "keymap.d/zz-mine.toml": '[search_keys]\n"<C-D>" = "duck"\n' });
  const answer = await messages.change(set("wiki", "https://w.test/?q={query}", { letter: "<C-d>" }));
  assert.deepEqual(answer, { ok: false, message: `keymap.d/zz-mine.toml sets the key letter <C-d> in [search_keys], and it wins over ${KEYS}. Change it there, or pick another letter.`, problems: [] });
});

test("a letter the build refuses is refused and stores nothing", async () => {
  const { host, messages, local } = await started();
  const answer = await messages.change(set("wiki", "https://w.test/?q={query}", { letter: "/" }));
  assert.equal(answer.ok, false);
  assert.match(answer.message, /zz-desertfox\.toml: search_keys\["\/"\]|"\/" is the key of the current site search/);
  assert.equal(host.files[FILE], undefined);
  assert.equal(stored_files(local)[KEYS], undefined);
});

test("a keys file at the page's path without the marker stays the user's: its letters are not listed and a letter change is refused by name", async () => {
  const hand = '[search_keys]\nw = "wiki"\n';
  const { host, messages, sent } = await started({ "settings.toml": "", [FILE]: MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n', [KEYS]: hand });
  const listed = await messages.list();
  assert.deepEqual(listed.ok && listed.engines.map((row) => row.letter), [undefined]);
  sent.length = 0;
  const refusal = `${KEYS} was not written by the Engines page, so the page does not change it. Rename it, or move its keys to another keymap.d file.`;
  assert.deepEqual(await messages.change(set("docs", "https://d.test/?q={query}", { letter: "d" })), { ok: false, message: refusal, problems: [] });
  assert.deepEqual(await messages.change(set("docs", "https://d.test/?q={query}")), { ok: true, message: `Saved the engine docs to ${FILE}.` });
  // The hand file binds w to wiki, so the files build refuses the remove.
  const removed = await messages.change(remove("wiki"));
  assert.equal(removed.ok, false);
  assert.match(removed.message, /unknown search engine "wiki"/);
  assert.equal(host.files[KEYS], hand);
  assert.deepEqual(kinds_sent(sent), [["engines"]]);
});

test("a keys file made by hand since the last read is never overwritten, and the question is asked", async () => {
  const { host, messages, local } = await started();
  host.files = { ...host.files, [KEYS]: '[search_keys]\nh = "duck"\n' };
  const answer = await messages.change(set("wiki", "https://w.test/?q={query}", { letter: "w" }));
  assert.ok(answer.ok);
  assert.match(answer.message, new RegExp(`Saved its key letter\\. ${KEYS.replace(".", "\\.")} changed on disk, so it stays as it is`));
  assert.match(host.files[FILE]!, /^\[wiki\]/m);
  assert.equal(host.files[KEYS], '[search_keys]\nh = "duck"\n');
  assert.notEqual(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a save whose keys file the host cannot write writes neither file, and the reply says so", async () => {
  const { host, messages, local } = await started({ "settings.toml": "" }, { files: { "settings.toml": "" }, refuse: [KEYS] });
  const answer = await messages.change(set("wiki", "https://w.test/?q={query}", { letter: "w" }));
  assert.ok(answer.ok);
  assert.match(answer.message, new RegExp(`^Saved the engine wiki\\. ${FILE.replace(".", "\\.")} was not written \\(.*Permission denied.*so nothing was written\\)`));
  assert.match(answer.message, new RegExp(`Saved its key letter\\. ${KEYS.replace(".", "\\.")} was not written`));
  assert.equal(host.files[FILE], undefined);
  assert.equal(host.files[KEYS], undefined);
  assert.deepEqual(unsynced_of(local), { [FILE]: null, [KEYS]: null });
  host.refuse = [];
  await (fresh_config_service()).reload_config_at_start();
  assert.match(host.files[FILE]!, /^\[wiki\]/m);
  assert.equal(host.files[KEYS], KEYS_MARK + '[search_keys]\nw = "wiki"\n');
  assert.equal(unsynced_of(local), undefined);
});

test("a save whose gate cannot read the folder holds both files, and the reply says so", async () => {
  const { host, messages, fake, local } = await started();
  const send = fake.runtime.sendNativeMessage;
  fake.runtime.sendNativeMessage = async (name: string, message: { cmd: string }) => {
    if (message.cmd === "read_config") throw new Error("read failed");
    return send(name, message);
  };
  const answer = await messages.change(set("wiki", "https://w.test/?q={query}", { letter: "w" }));
  assert.ok(answer.ok);
  assert.match(answer.message, new RegExp(`^Saved the engine wiki\\. ${FILE.replace(".", "\\.")} waits, because the config folder could not be read to check the write \\(.*read failed\\)`));
  assert.match(answer.message, new RegExp(`Saved its key letter\\. ${KEYS.replace(".", "\\.")} waits, because the config folder could not be read`));
  assert.equal(host.files[FILE], undefined);
  assert.equal(host.files[KEYS], undefined);
  assert.deepEqual(unsynced_of(local), { [FILE]: null, [KEYS]: null });
});

test("a key letter whose engine's file went to the question is held by the gate, so the folder never names a missing engine", async () => {
  const { host, messages, local } = await started();
  host.files = { ...host.files, [FILE]: '[hand]\nurl = "https://h.test/?q={query}"\n' };
  const answer = await messages.change(set("wiki", "https://w.test/?q={query}", { letter: "w" }));
  assert.ok(answer.ok);
  assert.match(answer.message, /zz-desertfox\.toml changed on disk, so it stays as it is/);
  assert.match(answer.message, /keymap\.d\/zz-desertfox\.toml waits, because the config folder would not build with it \(.*unknown search engine "wiki"\)/);
  assert.equal(host.files[KEYS], undefined);
  assert.deepEqual(Object.keys(unsynced_of(local) as object), [KEYS]);
});

test("a host without the search_keys kind writes neither page file, both wait for the update, and the updated host writes them", async () => {
  const files = { "settings.toml": "" };
  const host: Host = { files, no_keys_kind: true };
  const { messages, startup, local } = await started(files, host);
  const answer = await messages.change(set("wiki", "https://w.test/?q={query}", { letter: "w" }));
  assert.deepEqual(answer, { ok: true, message: `Saved the engine wiki. ${FILE} updates once the native host is updated. Saved its key letter. ${KEYS} updates once the native host is updated. sw searches it.` });
  assert.equal((await startup.get_config()).keymap.search_keys?.w, "wiki");
  assert.equal(host.files[FILE], undefined);
  assert.equal(host.files[KEYS], undefined);
  assert.deepEqual(unsynced_of(local), { [FILE]: null, [KEYS]: null });
  host.no_keys_kind = false;
  await (fresh_config_service()).reload_config_at_start();
  assert.equal(host.files[KEYS], KEYS_MARK + '[search_keys]\nw = "wiki"\n');
  assert.equal(unsynced_of(local), undefined);
});

test("two saves with letters sent while the first write is out reach both files in order, and no letter is lost", async () => {
  const { host, messages, fake, local } = await started();
  const broken = watch_folder_builds(fake, host);
  const held = hold_writes(fake);
  const first = messages.change(set("one", "https://1.test/?q={query}", { letter: "o" }));
  await until(() => held.length === 1, "the first write did not go out");
  const second = messages.change(set("two", "https://2.test/?q={query}", { letter: "t" }));
  while (held.length > 0 || !(await Promise.race([Promise.all([first, second]).then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 20))]))) {
    if (held.length > 0) held.shift()!();
  }
  const answers = await Promise.all([first, second]);
  assert.ok(answers.every((answer) => answer.ok && answer.message.includes(`Saved its key letter to ${KEYS}`)), JSON.stringify(answers));
  assert.equal(host.files[KEYS], KEYS_MARK + '[search_keys]\no = "one"\nt = "two"\n');
  assert.match(host.files[FILE]!, /\[one\][^]*\[two\]/);
  assert.deepEqual(broken, []);
  assert.equal(unsynced_of(local), undefined);
});

test("a new engine with a letter and the removal of one the folder's keys file names reach the folder in one batch", async () => {
  const host: Host = { files: { "settings.toml": "", [FILE]: MARK + '[old]\nurl = "https://o.test/?q={query}"\n', [KEYS]: KEYS_MARK + '[search_keys]\no = "old"\n' } };
  const { messages, local, fake } = await started(host.files, host);
  host.granted = false;
  await messages.change(set("wiki", "https://w.test/?q={query}", { letter: "w" }));
  await messages.change(remove("old"));
  assert.deepEqual(Object.keys(unsynced_of(local) as object), [FILE, KEYS]);
  host.granted = true;
  const broken = watch_folder_builds(fake, host);
  const sent_kinds: string[][] = [];
  const send = fake.runtime.sendNativeMessage;
  fake.runtime.sendNativeMessage = (name: string, message: { cmd: string; files?: FileEntry[] }) => {
    if (message.cmd === "write_config_files") sent_kinds.push((message.files ?? []).map((file) => file.kind));
    return send(name, message);
  };
  await (fresh_config_service()).reload_config_at_start();
  assert.deepEqual(sent_kinds, [["engines", "search_keys"]]);
  assert.deepEqual(broken, []);
  assert.equal(host.files[FILE], MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n');
  assert.equal(host.files[KEYS], KEYS_MARK + '[search_keys]\nw = "wiki"\n');
  assert.equal(unsynced_of(local), undefined);
});

test("a remove whose keys write goes to the question takes the engine file's removal with it, so the folder keeps building", async () => {
  const { host, messages, local, fake } = await started({ "settings.toml": "", [FILE]: MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n\n[keep]\nurl = "https://k.test/?q={query}"\n', [KEYS]: KEYS_MARK + '[search_keys]\nw = "wiki"\n' });
  const broken = watch_folder_builds(fake, host);
  host.files = { ...host.files, [KEYS]: '[search_keys]\nw = "wiki"\nk = "keep"\n' };
  const answer = await messages.change(remove("wiki"));
  assert.ok(answer.ok, answer.message);
  assert.match(answer.message, /zz-desertfox\.toml changed on disk, so it stays as it is/);
  assert.match(host.files[FILE]!, /^\[wiki\]/m);
  assert.deepEqual(broken, []);
  assert.equal(unsynced_of(local), undefined);
});
