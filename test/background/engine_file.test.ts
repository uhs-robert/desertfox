import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import "../../src/background/command_modules.ts";
import { load_layers } from "../../src/background/edit_layers.ts";
import { holds_engine, PAGE_FILE_MARKER } from "../../src/background/engine_file.ts";
import { create_engine_messages } from "../../src/background/engine_message.ts";
import { ENGINE_EDITS_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { build_files_config } from "../../src/background/config_reload.ts";
import { install_fake_browser, until, type Files } from "./config_fake_browser.ts";

type Startup = typeof import("../../src/background/startup.ts");
let fresh_count = 0;
const fresh_startup = async () => (await import(`../../src/background/startup.ts?engine_file_${fresh_count++}`)) as Startup;

const FILE = "search_engines.d/zz-desertfox.toml";
// The first lines of a page file the page wrote.
const MARK = `${PAGE_FILE_MARKER}\n\n`;
type Host = { files: Files; granted?: boolean; no_engines_kind?: boolean };

const messages_of = (startup: Startup) =>
  create_engine_messages({ read_engine_state: startup.read_engine_state, change_engine_file: startup.change_engine_file, read_starter: async () => readFileSync(new URL("../../examples/engines.toml", import.meta.url), "utf8") });

// A profile that read the folder once through the host, as after `,r`, so its changes go to the folder.
async function started(files: Files = { "settings.toml": "" }, host: Host = { files }, layer?: Record<string, unknown>) {
  const browser = install_fake_browser(host);
  if (layer) browser.local[ENGINE_EDITS_STORAGE_KEY] = layer;
  const startup = await fresh_startup();
  await startup.get_config();
  await startup.reload_config();
  return { host, startup, messages: messages_of(startup), ...browser };
}

const set = (name: string, url: string, extra: { keyword?: string; letter?: string } = {}) => ({ type: "change_engines", action: "set", name, url, ...extra }) as const;
const remove = (name: string) => ({ type: "change_engines", action: "remove", name }) as const;
const stored_files = (local: Record<string, unknown>) => (local[FILES_SOURCE_STORAGE_KEY] as { files: Files }).files;
const unsynced_of = (local: Record<string, unknown>) => local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] ?? undefined;

// A host whose `write_config_file` answers only when the test says so.
function hold_writes(fake: ReturnType<typeof install_fake_browser>["fake"]) {
  const send = fake.runtime.sendNativeMessage;
  const held: (() => void)[] = [];
  fake.runtime.sendNativeMessage = (name: string, message: { cmd: string }) => {
    if (message.cmd !== "write_config_file") return send(name, message);
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
  assert.ok(!sent.some((message) => message.cmd === "write_config_file"));
  const starter = await messages.change({ type: "change_engines", action: "starter" });
  assert.ok(starter.ok && /Skipped 1/.test(starter.message) && starter.message.includes(`to ${FILE}`), starter.ok ? starter.message : "");
  assert.doesNotMatch(host.files[FILE]!, /^\[arch\]/m);
  assert.equal(host.files["search_engines.toml"], files["search_engines.toml"]);
});

test("a save of an engine the old browser layer holds moves it into the file with its label, children and letter", async () => {
  const layer = { engines: { gh: { url: "https://github.com/search?q={query}", label: "GitHub", keyword: "g", repo: { url: "https://github.com/{repo}/search?q={query}", label: "Repo" } }, other: { url: "https://o.test/?q={query}" } }, letters: { g: "gh" } };
  const { host, startup, messages } = await started(undefined, undefined, layer);
  const answer = await messages.change(set("gh", "https://github.com/search?q={query}&type=code", { letter: "g" }));
  assert.equal(answer.ok, true, answer.message);
  assert.equal(host.files[FILE], MARK + '[gh]\nurl = "https://github.com/search?q={query}&type=code"\nlabel = "GitHub"\n\n[gh.repo]\nurl = "https://github.com/{repo}/search?q={query}"\nlabel = "Repo"\n');
  assert.deepEqual((await load_layers()).engines, { engines: { other: { url: "https://o.test/?q={query}" } }, letters: { g: "gh" } });
  const config = await startup.get_config();
  assert.equal(config.search_engines.gh?.keyword, undefined);
  assert.ok(config.search_engines["gh.repo"]);
  assert.equal(config.keymap.search_keys?.g, "gh");
  const listed = await messages.list();
  assert.deepEqual(listed.ok && listed.engines.map((row) => [row.name, row.letter ?? ""]), [["gh", "g"], ["other", ""]]);
  // A remove of an engine still in the layer changes no file.
  assert.deepEqual(await messages.change(remove("other")), { ok: true, message: "Removed the engine other." });
  assert.deepEqual((await load_layers()).engines, { letters: { g: "gh" } });
});

test("a remove takes the engine's key letter with it in the same storage write", async () => {
  const { messages, startup, local, fake } = await started();
  await messages.change(set("wiki", "https://w.test/?q={query}", { letter: "w" }));
  assert.deepEqual((await load_layers()).engines?.letters, { w: "wiki" });
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
  const updated = await fresh_startup();
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
  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.equal(host.files[FILE], MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n');
  assert.equal(unsynced_of(local), undefined);
});

test("a settings.toml that names a page engine waits for the page's file, even when its own edit came first", async () => {
  const files = { "settings.toml": "" };
  const host: Host = { files, no_engines_kind: true };
  const { messages, startup, local, sent } = await started(files, host);
  host.granted = false;
  await startup.set_in_settings_file("default_engine", "duck");
  host.granted = true;
  // settings.toml is in the record before the page's file.
  await messages.change(set("wiki", "https://w.test/?q={query}"));
  assert.deepEqual(await startup.set_in_settings_file("default_engine", "wiki"), { kind: "waiting", host_outdated: true });
  assert.deepEqual(Object.keys(unsynced_of(local) as object), ["settings.toml", FILE]);
  assert.equal(host.files["settings.toml"], "");

  host.no_engines_kind = false;
  sent.length = 0;
  const updated = await fresh_startup();
  await updated.reload_config_at_start();
  const kinds = sent.filter((message) => message.cmd === "write_config_file").map((message) => message.kind);
  assert.deepEqual(kinds, ["engines", "settings"]);
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
  const startup = await fresh_startup();
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
  fake.runtime.sendNativeMessage = async (name: string, message: { cmd: string; kind?: string }) => {
    const reply = await send(name, message);
    if (message.cmd === "write_config_file" && (reply as { ok: boolean }).ok) {
      const named = /default_engine = "([^"]+)"/.exec(host.files["settings.toml"] ?? "")?.[1];
      states.push({ kinds: message.kind ?? "", ...(named !== undefined && { named }), defined: named === undefined || named === "duck" || new RegExp(`^\\[${named}\\]`, "m").test(host.files[FILE] ?? "") });
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
  test(`a new default engine and the removal of the old one, with the host ${label}, reach the folder at the next start through a bridge file`, async () => {
    const host: Host = { files: {} };
    const { local, fake } = await replaced_default_engine(host, cut_host);
    host.granted = true;
    host.no_engines_kind = false;
    const states = watch_folder_states(fake, host);
    const restarted = await fresh_startup();
    await restarted.reload_config_at_start();
    assert.deepEqual(states.map((state) => state.kinds), ["engines", "settings", "engines"]);
    assert.ok(states.every((state) => state.defined), JSON.stringify(states));
    assert.equal(host.files[FILE], MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n');
    assert.equal(host.files["settings.toml"], 'default_engine = "wiki"\n');
    assert.equal(unsynced_of(local), undefined);
  });
}

test("a remove that meets the same wait in its own write goes through the bridge file at once", async () => {
  const host: Host = { files: { "settings.toml": 'default_engine = "old"\n', [FILE]: MARK + '[old]\nurl = "https://o.test/?q={query}"\n[keep]\nurl = "https://k.test/?q={query}"\n' } };
  const { messages, startup, local, fake } = await started(host.files, host);
  host.no_engines_kind = true;
  await messages.change(set("wiki", "https://w.test/?q={query}"));
  await startup.set_in_settings_file("default_engine", "wiki");
  host.no_engines_kind = false;
  const states = watch_folder_states(fake, host);
  const removed = await messages.change(remove("old"));
  assert.deepEqual(removed, { ok: true, message: `Removed the engine old from ${FILE}.` });
  assert.deepEqual(states.map((state) => state.kinds), ["engines", "settings", "engines"]);
  assert.ok(states.every((state) => state.defined), JSON.stringify(states));
  assert.doesNotMatch(host.files[FILE]!, /\[old\]/);
  assert.equal(unsynced_of(local), undefined);
});

test("a settings.toml that stops naming an engine goes before the page's file that drops it", async () => {
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
  await (await fresh_startup()).reload_config_at_start();
  assert.deepEqual(states.map((state) => state.kinds), ["settings", "engines"]);
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

test("a default engine that is a child of a page engine waits for the page's file", async () => {
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
  await (await fresh_startup()).reload_config_at_start();
  assert.deepEqual(sent.filter((message) => message.cmd === "write_config_file").map((message) => message.kind), ["engines", "settings"]);
});

test("a page engine path names a child table or a child a param makes, never params itself", () => {
  const tables = { gh: { url: "u", repo: { url: "r" }, params: { type: { values: { a: "x" }, children: true } } }, plain: { url: "p" } };
  assert.equal(holds_engine(tables, "gh"), true);
  assert.equal(holds_engine(tables, "gh.repo"), true);
  assert.equal(holds_engine(tables, "gh.a"), true);
  assert.equal(holds_engine(tables, "gh.params"), false);
  assert.equal(holds_engine(tables, "plain.x"), false);
  assert.equal(holds_engine(tables, "none"), false);
});

test("a remove whose storage write fails puts the page's file and the key letter back together", async () => {
  const { messages, startup, local, fake } = await started();
  await messages.change(set("wiki", "https://w.test/?q={query}", { letter: "w" }));
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
test("a bridge file that would hold one keyword twice is not written, and both files wait", async () => {
  const host: Host = { files: { "settings.toml": 'default_engine = "old"\n', [FILE]: MARK + '[old]\nurl = "https://o.test/?q={query}"\nkeyword = "o"\n' } };
  const { messages, startup, local } = await started(host.files, host);
  host.granted = false;
  await messages.change(set("wiki", "https://w.test/?q={query}"));
  await startup.set_in_settings_file("default_engine", "wiki");
  await messages.change(remove("old"));
  assert.equal((await messages.change(set("wiki", "https://w.test/?q={query}", { keyword: "o" }))).ok, true);
  host.granted = true;
  const before = structuredClone(host.files);
  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.deepEqual(host.files, before);
  assert.deepEqual(Object.keys(unsynced_of(local) as object).sort(), [FILE, "settings.toml"]);
});

test("a bridge file that would drop the default child the folder names is not written", async () => {
  const host: Host = { files: { "settings.toml": 'default_engine = "wiki.images"\n', [FILE]: MARK + '[wiki]\nurl = "https://w.test/?q={query}"\n\n[wiki.images]\nurl = "https://w.test/i?q={query}"\n' } };
  const { messages, startup, local } = await started(host.files, host);
  host.granted = false;
  await messages.change(set("docs", "https://d.test/?q={query}"));
  await startup.set_in_settings_file("default_engine", "docs");
  await messages.change(remove("wiki"));
  await messages.change(set("wiki", "https://w.test/?q={query}"));
  host.granted = true;
  const before = structuredClone(host.files);
  await (await fresh_startup()).reload_config_at_start();
  assert.deepEqual(host.files, before);
  assert.deepEqual(Object.keys(unsynced_of(local) as object).sort(), [FILE, "settings.toml"]);
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
  await (await fresh_startup()).reload_config_at_start();
  assert.equal(host.files["settings.toml"], "");
  assert.equal(host.files[FILE], '[hand]\nurl = "https://h.test/?q={query}"\n');
  assert.deepEqual(Object.keys(unsynced_of(local) as object), ["settings.toml"]);
});

test("a settings.toml that names a new theme and a new page engine waits for both, then lands in the same start", async () => {
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
  await (await fresh_startup()).reload_config_at_start();
  assert.deepEqual(sent.filter((message) => message.cmd === "write_config_file").map((message) => message.kind), ["theme", "engines", "settings"]);
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
  assert.ok(!sent.some((message) => message.cmd === "write_config_file"));
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
  assert.ok(!sent.some((message) => message.cmd === "write_config_file"));
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
