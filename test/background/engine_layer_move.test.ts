import assert from "node:assert/strict";
import { mock, test } from "node:test";
import "../../src/background/command_modules.ts";
import { build_files_config } from "../../src/background/config_reload.ts";
import { export_files } from "../../src/background/config_transfer.ts";
import { PAGE_FILE_MARKER } from "../../src/background/engine_file.ts";
import { KEYS_FILE_MARKER } from "../../src/background/engine_keys_file.ts";
import { engine_layer_moved, merged_by_path } from "../../src/background/engine_layer_move.ts";
import { create_engine_messages } from "../../src/background/engine_message.ts";
import { ENGINE_EDITS_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../../src/shared/prefix_tree.ts";
import { install_fake_browser, type Files } from "./config_fake_browser.ts";

type Startup = typeof import("../../src/background/startup.ts");
let fresh_count = 0;
const fresh_startup = async () => (await import(`../../src/background/startup.ts?engine_layer_move_${fresh_count++}`)) as Startup;

const FILE = "search_engines.d/zz-desertfox.toml";
const KEYS = "keymap.d/zz-desertfox.toml";
const MARK = `${PAGE_FILE_MARKER}\n\n`;
const KEYS_MARK = `${KEYS_FILE_MARKER}\n\n`;
type Host = { files: Files; granted?: boolean; no_engines_kind?: boolean; no_keys_kind?: boolean };

const WIKI = { url: "https://w.test/?q={query}", label: "Wiki", keyword: "w" };
const LAYER = { engines: { wiki: WIKI, docs: { url: "https://d.test/?q={query}" } }, letters: { w: "wiki" } };

// A profile of an older version: it read the folder once through the host, and its engines layer and saved edits sit in storage. The next start is the first one of this version.
async function old_profile(layer: unknown, files: Files = { "settings.toml": "" }, saved: Record<string, unknown> = {}, host: Host = { files }) {
  const browser = install_fake_browser(host);
  const startup = await fresh_startup();
  await startup.get_config();
  await startup.reload_config();
  browser.local[ENGINE_EDITS_STORAGE_KEY] = layer;
  browser.local[SAVED_SETTINGS_STORAGE_KEY] = saved;
  return { host, ...browser };
}

const messages_of = (startup: Startup) => create_engine_messages({ read_engine_state: startup.read_engine_state, change_engine_file: startup.change_engine_file, read_starter: async () => "" });

async function first_start() {
  const startup = await fresh_startup();
  await startup.reload_config_at_start();
  return startup;
}

const stored_files = (local: Record<string, unknown>) => (local[FILES_SOURCE_STORAGE_KEY] as { files: Files }).files;
const unsynced_of = (local: Record<string, unknown>) => local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] ?? undefined;
const kinds_sent = (sent: { cmd: string; kind?: string }[]) => sent.filter((message) => message.cmd === "write_config_file").map((message) => message.kind);

// Every folder state the host leaves after a write, built as a `,r` would build it.
function watch_folder_builds(fake: ReturnType<typeof install_fake_browser>["fake"], host: Host) {
  const broken: string[] = [];
  const send = fake.runtime.sendNativeMessage;
  fake.runtime.sendNativeMessage = async (name: string, message: { cmd: string }) => {
    const reply = await send(name, message);
    if (message.cmd === "write_config_file" && (reply as { ok: boolean }).ok) {
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

// The start toasts through `console.warn` as well, which a test can read.
function start_warnings() {
  const warn = mock.method(console, "warn", () => undefined);
  return {
    toasts: () => warn.mock.calls.map((call) => String(call.arguments[0])).filter((text) => text.startsWith("Moving the search engines")),
    restore: () => warn.mock.restore(),
  };
}

test("the first start moves the layer into both files and the saved default engine into settings.toml after them, once", async () => {
  const { host, local, sent, fake } = await old_profile(LAYER, { "settings.toml": "# mine\n" }, { default_engine: "wiki", which_key_delay_ms: 5 });
  const broken = watch_folder_builds(fake, host);
  sent.length = 0;
  const warnings = start_warnings();
  const startup = await first_start();
  warnings.restore();
  assert.deepEqual(warnings.toasts(), []);
  assert.equal(host.files[FILE], MARK + '[wiki]\nurl = "https://w.test/?q={query}"\nlabel = "Wiki"\nkeyword = "w"\n\n[docs]\nurl = "https://d.test/?q={query}"\n');
  assert.equal(host.files[KEYS], KEYS_MARK + '[search_keys]\nw = "wiki"\n');
  assert.equal(host.files["settings.toml"], 'default_engine = "wiki"\n# mine\n');
  assert.deepEqual(kinds_sent(sent), ["engines", "search_keys", "settings"]);
  assert.deepEqual(broken, []);
  assert.equal(local[ENGINE_EDITS_STORAGE_KEY], undefined);
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { which_key_delay_ms: 5 });
  assert.equal(unsynced_of(local), undefined);
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
  const config = await startup.get_config();
  assert.equal(config.search_engines.wiki?.keyword, "w");
  assert.equal(config.keymap.search_keys?.w, "wiki");
  assert.equal(config.settings.default_engine, "wiki");
  const listed = await messages_of(startup).list();
  assert.deepEqual(listed.ok && listed.engines.map((row) => [row.name, row.letter ?? ""]), [["wiki", "w"], ["docs", ""]]);

  sent.length = 0;
  await first_start();
  assert.deepEqual(kinds_sent(sent), [], "a second start wrote again");
});

test("without the host the moved files wait in the copy and the record, and the next start with the host writes them", async () => {
  const files = { "settings.toml": "" };
  const host: Host = { files };
  const { local } = await old_profile(LAYER, files, { default_engine: "wiki" }, host);
  host.granted = false;
  const startup = await first_start();
  assert.equal(local[ENGINE_EDITS_STORAGE_KEY], undefined);
  assert.deepEqual(unsynced_of(local), { [FILE]: null, [KEYS]: null, "settings.toml": "" });
  assert.match(stored_files(local)[FILE]!, /^\[wiki\]$/m);
  assert.equal((await startup.get_config()).settings.default_engine, "wiki");
  assert.equal(host.files[FILE], undefined);

  host.granted = true;
  await first_start();
  assert.match(host.files[FILE]!, /^\[docs\]$/m);
  assert.equal(host.files["settings.toml"], 'default_engine = "wiki"\n');
  assert.equal(unsynced_of(local), undefined);
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("with no config folder ever read, the move changes only the browser copy", async () => {
  const browser = install_fake_browser({ files: {}, granted: false });
  browser.local[ENGINE_EDITS_STORAGE_KEY] = LAYER;
  const startup = await first_start();
  assert.match(stored_files(browser.local)[FILE]!, /^\[wiki\]$/m);
  assert.equal(unsynced_of(browser.local), undefined);
  assert.equal(browser.local[ENGINE_EDITS_STORAGE_KEY], undefined);
  assert.equal((await startup.get_config()).keymap.search_keys?.w, "wiki");
});

test("a host without the engines kind keeps the files waiting, and the updated host writes them in order", async () => {
  const files = { "settings.toml": "" };
  const host: Host = { files, no_engines_kind: true };
  const { local, sent, fake } = await old_profile(LAYER, files, { default_engine: "wiki" }, host);
  await first_start();
  assert.equal(local[ENGINE_EDITS_STORAGE_KEY], undefined);
  assert.equal(host.files[FILE], undefined);
  assert.equal(host.files["settings.toml"], "", "settings.toml waits for the engine file");
  assert.deepEqual(Object.keys(unsynced_of(local) as object).sort(), [KEYS, FILE, "settings.toml"].sort());

  host.no_engines_kind = false;
  const broken = watch_folder_builds(fake, host);
  sent.length = 0;
  await first_start();
  assert.deepEqual(kinds_sent(sent), ["engines", "search_keys", "settings"]);
  assert.deepEqual(broken, []);
  assert.equal(unsynced_of(local), undefined);
});

test("a page file made by hand in the folder since the last read is never overwritten, and the engines stay in the copy", async () => {
  const { host, local } = await old_profile(LAYER);
  const hand = `${MARK}[mine]\nurl = "https://m.test/?q={query}"\n`;
  host.files = { ...host.files, [FILE]: hand };
  const startup = await first_start();
  assert.equal(host.files[FILE], hand);
  assert.notEqual(local[HOST_START_PENDING_STORAGE_KEY], undefined);
  assert.equal(local[ENGINE_EDITS_STORAGE_KEY], undefined);
  assert.ok((await startup.get_config()).search_engines.wiki, "the copy keeps the moved engines");
});

test("a stop before the storage write moves nothing, and one after it moves nothing twice", async () => {
  const { host, local, fake, sent } = await old_profile(LAYER);
  const store_set = fake.storage.local.set;
  let stopped = false;
  fake.storage.local.set = async (values: Record<string, unknown>) => {
    if (!stopped && ENGINE_EDITS_STORAGE_KEY in values) {
      stopped = true;
      throw new Error("the browser stopped");
    }
    await store_set(values);
  };
  await first_start();
  assert.ok(stopped);
  assert.deepEqual(local[ENGINE_EDITS_STORAGE_KEY], LAYER);
  assert.equal(stored_files(local)[FILE], undefined);
  assert.equal(host.files[FILE], undefined);
  fake.storage.local.set = store_set;

  const remove_key = fake.storage.local.remove;
  let removed_once = false;
  fake.storage.local.remove = async (key: string | string[]) => {
    if (!removed_once && [key].flat().includes(ENGINE_EDITS_STORAGE_KEY)) {
      removed_once = true;
      throw new Error("the browser stopped");
    }
    return remove_key(key);
  };
  await first_start();
  assert.ok(removed_once);
  assert.deepEqual(local[ENGINE_EDITS_STORAGE_KEY], {});
  const written = host.files[FILE];
  assert.match(written!, /^\[wiki\]$/m);

  sent.length = 0;
  await first_start();
  assert.equal(local[ENGINE_EDITS_STORAGE_KEY], undefined);
  assert.equal(host.files[FILE], written);
  assert.deepEqual(kinds_sent(sent), []);
});

test("a layer engine whose name an earlier hand file defines moves and still wins, and the page can remove it", async () => {
  const files = { "settings.toml": "", "search_engines.toml": 'wiki = { url = "https://hand.test/?q={query}", keyword = "h" }\n' };
  await old_profile({ engines: { wiki: WIKI } }, files);
  const warnings = start_warnings();
  const startup = await first_start();
  warnings.restore();
  assert.deepEqual(warnings.toasts(), []);
  assert.equal((await startup.get_config()).search_engines.wiki?.url, WIKI.url);
  const messages = messages_of(startup);
  assert.equal((await messages.change({ type: "change_engines", action: "remove", name: "wiki" })).ok, true);
  assert.equal((await startup.get_config()).search_engines.wiki?.url, "https://hand.test/?q={query}");
});

test("a later hand file that defines a moved engine or one of its children is named in the start toast", async () => {
  const layer = { engines: { gh: { url: "https://github.com/search?q={query}", repo: { url: "https://github.com/{repo}/search?q={query}" } }, wiki: WIKI } };
  const custom = '[gh.repo]\nurl = "https://hand.test/{repo}?q={query}"\n\n[wiki]\nurl = "https://hand.test/?q={query}"\n';
  const { host, local } = await old_profile(layer);
  // The old version built this folder with the layer's gh, which the hand child needs, so the copy holds it as the folder does.
  host.files = { ...host.files, "search_engines.d/zzz-custom.toml": custom };
  (local[FILES_SOURCE_STORAGE_KEY] as { files: Files }).files["search_engines.d/zzz-custom.toml"] = custom;
  const warnings = start_warnings();
  const startup = await first_start();
  warnings.restore();
  const [toast] = warnings.toasts();
  assert.match(toast!, /search_engines\.d\/zzz-custom\.toml defines the engine gh\.repo too/);
  assert.match(toast!, /search_engines\.d\/zzz-custom\.toml defines the engine wiki too/);
  const config = await startup.get_config();
  assert.equal(config.search_engines.gh?.url, "https://github.com/search?q={query}");
  assert.equal(config.search_engines["gh.repo"]?.url, "https://hand.test/{repo}?q={query}");
});

test("a layer table over a page engine keeps the page file's children it does not hold", async () => {
  const files = { "settings.toml": "", [FILE]: `${MARK}[wiki]\nurl = "https://old.test/?q={query}"\n\n[wiki.images]\nurl = "https://old.test/img?q={query}"\n` };
  await old_profile({ engines: { wiki: { url: "https://new.test/?q={query}" } } }, files);
  const startup = await first_start();
  const config = await startup.get_config();
  assert.equal(config.search_engines.wiki?.url, "https://new.test/?q={query}");
  assert.equal(config.search_engines["wiki.images"]?.url, "https://old.test/img?q={query}");
});

test("a layer letter wins over an earlier hand binding, and one a later keymap.d file rebinds is dropped and named", async () => {
  const files = { "settings.toml": "", "search_engines.toml": 'other = { url = "https://o.test/?q={query}" }\n', "keymap.toml": '[search_keys]\nw = "other"\n', "keymap.d/zzz.toml": '[search_keys]\nd = "other"\n' };
  await old_profile({ engines: { wiki: WIKI, docs: { url: "https://d.test/?q={query}" } }, letters: { w: "wiki", d: "docs" } }, files);
  const warnings = start_warnings();
  const startup = await first_start();
  warnings.restore();
  const config = await startup.get_config();
  assert.equal(config.keymap.search_keys?.w, "wiki");
  assert.equal(config.keymap.search_keys?.d, "other");
  assert.match(warnings.toasts()[0]!, /keymap\.d\/zzz\.toml binds the key letter d to another engine, so the letter that searched docs is dropped/);
});

test("a piece the config refuses stays in the layer, the start says so each time, and moves once the clash is gone", async () => {
  const files = { "settings.toml": "", "search_engines.toml": 'taken = { url = "https://t.test/?q={query}", keyword = "w" }\n' };
  const { host, local } = await old_profile(LAYER, files);
  const warnings = start_warnings();
  let startup = await first_start();
  assert.deepEqual(local[ENGINE_EDITS_STORAGE_KEY], { engines: { wiki: WIKI }, letters: { w: "wiki" } });
  assert.match(host.files[FILE]!, /^\[docs\]$/m);
  assert.doesNotMatch(host.files[FILE]!, /wiki/);
  assert.equal((await startup.get_config()).search_engines.wiki, undefined);
  await first_start();
  assert.equal(warnings.toasts().length, 2);
  assert.match(warnings.toasts()[0]!, /The engine wiki saved in the browser stays there, as the config refuses it: .*keyword/);

  host.files = { ...host.files, "search_engines.toml": 'taken = { url = "https://t.test/?q={query}" }\n' };
  startup = await fresh_startup();
  await startup.reload_config();
  await startup.reload_config_at_start();
  warnings.restore();
  assert.equal(local[ENGINE_EDITS_STORAGE_KEY], undefined);
  assert.match(host.files[FILE]!, /^\[wiki\]$/m);
  assert.equal((await startup.get_config()).keymap.search_keys?.w, "wiki");
});

test("a hand file at the page's path keeps every engine in the layer, still in force and listed, and names the file", async () => {
  const files = { "settings.toml": "", [FILE]: '[mine]\nurl = "https://m.test/?q={query}"\n' };
  const { local, host } = await old_profile(LAYER, files);
  const warnings = start_warnings();
  let startup = await first_start();
  assert.deepEqual(local[ENGINE_EDITS_STORAGE_KEY], LAYER);
  assert.equal(host.files[FILE], files[FILE]);
  assert.match(warnings.toasts()[0]!, /search_engines\.d\/zz-desertfox\.toml was not written by the Engines page/);
  for (const round of ["after the move", "after a restart"]) {
    const config = await startup.get_config();
    assert.equal(config.search_engines.wiki?.url, WIKI.url, round);
    assert.equal(config.keymap.search_keys?.w, "wiki", round);
    assert.ok(config.search_engines.mine, round);
    const listed = await messages_of(startup).list();
    assert.deepEqual(listed.ok && listed.engines.map((row) => [row.name, row.letter ?? ""]), [["wiki", "w"], ["docs", ""]], round);
    startup = await first_start();
  }
  warnings.restore();
  const exported = export_files((await startup.read_engine_state()).files, {}, {}, (await startup.read_engine_state()).kept);
  assert.match(exported.config_files["search_engines.d/zz-saved-edits.toml"]!, /^\[wiki\]$/m);
  assert.match(exported.config_files["keymap.d/zz-saved-edits.toml"]!, /^w = "wiki"$/m);
  // A remove of a retained engine drops it from the layer, and the key goes with its last engine.
  assert.equal((await messages_of(startup).change({ type: "change_engines", action: "remove", name: "wiki" })).ok, true);
  assert.equal((await messages_of(startup).change({ type: "change_engines", action: "remove", name: "docs" })).ok, true);
  assert.equal((await startup.get_config()).search_engines.wiki, undefined);
  await first_start();
  assert.equal(local[ENGINE_EDITS_STORAGE_KEY], undefined);
});

test("a saved default engine stays a saved edit while a settings.d file sets it or the config refuses it", () => {
  const files = { "settings.toml": "", "settings.d/look.toml": 'default_engine = "duck"\n' };
  const saved = { default_engine: "wiki" };
  const no_problems = () => [];
  assert.equal(engine_layer_moved(undefined, files, saved, no_problems).saved, saved);
  const refused = engine_layer_moved(undefined, { "settings.toml": "" }, saved, (next) => (next["settings.toml"] === "" ? [] : ["unknown search engine"]));
  assert.equal(refused.saved, saved);
  assert.deepEqual(refused.paths, []);
  const moved = engine_layer_moved(undefined, { "settings.toml": "" }, saved, no_problems);
  assert.deepEqual(moved.saved, {});
  assert.deepEqual(moved.paths, ["settings.toml"]);
});

test("a table the TOML writer refuses stays in the layer, and the others move", () => {
  const move = engine_layer_moved({ engines: { bad: { url: "https://b.test/?q={query}", hosts: [null] }, good: { url: "https://g.test/?q={query}" } } }, {}, {}, () => []);
  assert.deepEqual(move.left, { engines: { bad: { url: "https://b.test/?q={query}", hosts: [null] } } });
  assert.match(move.files[FILE]!, /^\[good\]$/m);
});

test("an empty child table is a node of its own, so it drops the old child's fields and inherits the new parent's", () => {
  const under = { url: "https://old.test/?q={query}", images: { url: "https://old.test/img?q={query}" } };
  const over = { url: "https://new.test/?q={query}", images: {} };
  assert.deepEqual(merged_by_path(under, over), { url: "https://new.test/?q={query}", images: {} });
  const config = build_files_config({ [FILE]: MARK + '[wiki]\nurl = "https://new.test/?q={query}"\n\n[wiki.images]\n' }, "folder", [], "reload").loaded.config;
  assert.equal(config.search_engines["wiki.images"]?.url, "https://new.test/?q={query}");
});

test("a merge by path takes the fields of a path whole from the top table and keeps the children only the lower one has", () => {
  const under = { url: "u1", label: "L", params: { t: { values: { a: "x" } } }, img: { url: "i1" }, news: { url: "n1", old: { url: "o" } } };
  const over = { url: "u2", news: { deep: { url: "d" } } };
  assert.deepEqual(merged_by_path(under, over), { url: "u2", img: { url: "i1" }, news: { url: "n1", old: { url: "o" }, deep: { url: "d" } } });
});

test("an engine left in the layer can be the default engine, keeps it across a restart, and the default moves to settings.toml with the engine", async () => {
  const hand = '[mine]\nurl = "https://m.test/?q={query}"\n';
  const { host, local } = await old_profile(LAYER, { "settings.toml": "", [FILE]: hand });
  const warnings = start_warnings();
  let startup = await first_start();
  assert.deepEqual(await startup.set_in_settings_file("default_engine", "wiki"), { kind: "saved_in_browser" });
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { default_engine: "wiki" });
  startup = await first_start();
  assert.equal((await startup.get_config()).settings.default_engine, "wiki");
  assert.equal(host.files["settings.toml"], "");

  // The user renames the hand file, so the page's path is free and the next start moves the layer.
  host.files = { "settings.toml": "", "search_engines.d/10-mine.toml": hand };
  await startup.reload_config();
  startup = await first_start();
  warnings.restore();
  assert.equal(local[ENGINE_EDITS_STORAGE_KEY], undefined);
  assert.match(host.files[FILE]!, /^\[wiki\]$/m);
  assert.equal(host.files["settings.toml"], 'default_engine = "wiki"\n');
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  assert.equal((await startup.get_config()).settings.default_engine, "wiki");
});

test("a move that only drops a layer letter publishes, so the running keymap follows the later keymap.d file", async () => {
  const files = { "settings.toml": "", "search_engines.toml": 'docs = { url = "https://d.test/?q={query}" }\nother = { url = "https://o.test/?q={query}" }\n', "keymap.d/zzz.toml": '[search_keys]\nd = "other"\n' };
  const { local } = await old_profile({ letters: { d: "docs" } }, files);
  const warnings = start_warnings();
  const startup = await first_start();
  warnings.restore();
  assert.equal(local[ENGINE_EDITS_STORAGE_KEY], undefined);
  assert.equal((await startup.get_config()).keymap.search_keys?.d, "other");
  assert.match(JSON.stringify(local[COMPILED_KEYMAP_STORAGE_KEY]), /"engine":"other"/);
  assert.doesNotMatch(JSON.stringify(local[COMPILED_KEYMAP_STORAGE_KEY]), /"engine":"docs"/);
});

test("a moved narrowing that shares its name with a page child stays in the layer, since one table cannot hold both", () => {
  const files = { [FILE]: `${MARK}[gh]\nurl = "https://github.com/search?q={query}"\n\n[gh.repo]\nurl = "https://github.com/{repo}?q={query}"\n` };
  const layer = { engines: { gh: { url: "https://github.com/search?q={query}&x=1", params: { type: { values: { code: "code", repo: "repositories" } } }, repo: { only: ["code"] } } } };
  const move = engine_layer_moved(layer, files, {}, () => []);
  assert.deepEqual(move.left, layer);
  assert.equal(move.files[FILE], files[FILE]);
  assert.match(move.notes.join(" "), /The engine gh saved in the browser stays there.*repo/);
  assert.throws(() => merged_by_path({ repo: { only: ["code"] } }, { repo: { url: "u" } }), /repo/);
});
