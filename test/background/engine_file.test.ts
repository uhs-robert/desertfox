import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import "../../src/background/command_modules.ts";
import { load_layers } from "../../src/background/edit_layers.ts";
import { create_engine_messages } from "../../src/background/engine_message.ts";
import { ENGINE_EDITS_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { install_fake_browser, until, type Files } from "./config_fake_browser.ts";

type Startup = typeof import("../../src/background/startup.ts");
let fresh_count = 0;
const fresh_startup = async () => (await import(`../../src/background/startup.ts?engine_file_${fresh_count++}`)) as Startup;

const FILE = "search_engines.d/zz-desertfox.toml";
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
  assert.deepEqual(second, { ok: true, message: `Saved the engine docs, saved to ${FILE}.` });
  assert.equal(host.files[FILE], '[wiki]\nurl = "https://w.test/?q={query}"\nkeyword = "w"\n\n[docs]\nurl = "https://d.test/?q={query}"\n');
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
  assert.equal(host.files[FILE], '[gh]\nurl = "https://github.com/search?q={query}&type=code"\nlabel = "GitHub"\n\n[gh.repo]\nurl = "https://github.com/{repo}/search?q={query}"\nlabel = "Repo"\n');
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
  assert.deepEqual(answers.map((answer) => answer.message), [`Saved the engine one, saved to ${FILE}.`, `Saved the engine two, saved to ${FILE}.`]);
  assert.equal(host.files[FILE], '[one]\nurl = "https://1.test/?q={query}"\n\n[two]\nurl = "https://2.test/?q={query}"\n');
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
  assert.equal(host.files[FILE], '[wiki]\nurl = "https://w.test/?q={query}"\n');
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
  assert.equal(host.files[FILE], '[wiki]\nurl = "https://w.test/?q={query}"\n');
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
