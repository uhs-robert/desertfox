// Every scalar and list setting changed in the browser goes into settings.toml: `:set`, `:toggle`, `:unset` and the settings page, and never with `--temp`.
import assert from "node:assert/strict";
import "../../src/background/command_modules.ts";
import { test } from "node:test";
import { make_settings_handlers } from "../../src/commands/settings.ts";
import { FILES_SOURCE_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY, TEMP_SETTINGS_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import { replayed_on_folder } from "../../src/background/settings_file.ts";
import { PAGE_FILE_MARKER } from "../../src/background/engine_file.ts";
import { default_engine_names } from "../../src/shared/config.ts";
import { parse } from "smol-toml";
import { install_fake_browser, type Files } from "./config_fake_browser.ts";

type Startup = typeof import("../../src/background/startup.ts");
let fresh_count = 0;
const fresh_startup = async () => (await import(`../../src/background/startup.ts?every_setting_${fresh_count++}`)) as Startup;

const MINE = '# My settings\n\nhint_letters = "abc" # home row\n\n# Fewer words\nnext_patterns = [\n  "next",\n  "more",\n]\ntoast_ms = 2000\n\n# Rules\n[[site_rules]]\nsite = "*://x.test/*"\noff = true\n';
// A hand edit of hint_letters.
const HAND = MINE.replace('"abc"', '"hand"');

const unsynced_of = (local: Record<string, unknown>) => local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] ?? undefined;
const stored_settings = (local: Record<string, unknown>) => (local[FILES_SOURCE_STORAGE_KEY] as { files: Files }).files["settings.toml"];
const pause = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
// Waits until `count` writes are held, as a loaded machine can take longer than a fixed pause.
async function writes_held(held: unknown[], count: number): Promise<void> {
  for (let waited = 0; held.length < count; waited += 10) {
    if (waited > 5000) throw new Error(`${held.length} writes held, not ${count}`);
    await pause(10);
  }
}

async function reloaded(host: { files: Files; granted?: boolean; old_host?: boolean }) {
  const fake = install_fake_browser(host);
  const startup = await fresh_startup();
  await startup.get_config();
  await startup.reload_config();
  return { ...fake, startup };
}

function hold_writes(fake: ReturnType<typeof install_fake_browser>["fake"]) {
  const send = fake.runtime.sendNativeMessage;
  const held: (() => void)[] = [];
  fake.runtime.sendNativeMessage = (name: string, message: { cmd: string }) => {
    if (message.cmd !== "write_config_file") return send(name, message);
    return new Promise((resolve) => held.push(() => resolve(send(name, message))));
  };
  return held;
}

const ctx: CommandContext = { tab_id: 7, window_id: 1, frame_id: 0, mode: "normal" };

// The command handlers over the real change queue, with the toasts they show.
function commands(startup: Startup) {
  const toasts: string[] = [];
  const handlers = make_settings_handlers({
    change_edits: startup.change_edits,
    toast: async (_ctx, kind, message) => void toasts.push(`${kind} ${message}`),
    set_in_file: startup.set_in_settings_file,
    toggle_in_file: startup.toggle_in_settings_file,
    unset_in_file: startup.unset_in_settings_file,
    get_config: startup.get_config,
  });
  return { handlers, toasts };
}

test(":set of a list and a scalar writes settings.toml and keeps every comment, the key order and the tables", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, startup } = await reloaded(host);
  const { handlers, toasts } = commands(startup);
  await handlers.set(ctx, { name: "next_patterns", value: "onward" });
  await handlers.set(ctx, { name: "toast_ms", value: "1500" });
  const expected = MINE.replace('next_patterns = [\n  "next",\n  "more",\n]', 'next_patterns = ["onward"]').replace("toast_ms = 2000", "toast_ms = 1500");
  assert.equal(host.files["settings.toml"], expected);
  assert.equal(stored_settings(local), expected);
  assert.deepEqual(toasts, ['success next_patterns = ["onward"], saved to settings.toml', "success toast_ms = 1500, saved to settings.toml"]);
  const { settings } = await startup.get_config();
  assert.deepEqual([settings.next_patterns, settings.toast_ms], [["onward"], 1500]);
  assert.equal(unsynced_of(local), undefined);
});

test(":set --temp and :toggle --temp never touch settings.toml, and send nothing to the host", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, session, sent, startup } = await reloaded(host);
  const { handlers } = commands(startup);
  sent.length = 0;
  await handlers.set(ctx, { name: "hint_letters", value: "qwer", temp: true });
  await handlers.toggle(ctx, { name: "newtab_date", temp: true });
  await handlers.unset(ctx, { name: "hint_letters", temp: true });
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], { newtab_date: false });
  assert.equal(host.files["settings.toml"], MINE);
  assert.equal(stored_settings(local), MINE);
  assert.deepEqual(sent.filter((message) => message.cmd === "write_config_file"), []);
});

test(":set over a temp and a saved edit drops both, so the file value shows", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, session, startup } = await reloaded(host);
  await startup.change_edits(() => ({ saved: { hint_letters: "zx", toast_ms: 900 }, temp: { hint_letters: "qw" } }));
  await commands(startup).handlers.set(ctx, { name: "hint_letters", value: "dfg" });
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { toast_ms: 900 });
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], {});
  assert.equal((await startup.get_config()).settings.hint_letters, "dfg");
});

test("two quick :toggle presses flip twice, and the file holds the second value", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { startup } = await reloaded(host);
  const { handlers, toasts } = commands(startup);
  await Promise.all([handlers.toggle(ctx, { name: "newtab_date" }), handlers.toggle(ctx, { name: "newtab_date" })]);
  assert.deepEqual(toasts, ["success newtab_date = false, saved to settings.toml", "success newtab_date = true, saved to settings.toml"]);
  assert.equal(host.files["settings.toml"], MINE.replace("toast_ms = 2000\n", "toast_ms = 2000\nnewtab_date = true\n"));
});

test(":unset removes the key from settings.toml, never writes the default, and drops the browser edits", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, session, startup } = await reloaded(host);
  await startup.change_edits(() => ({ saved: { hint_letters: "zx" }, temp: { hint_letters: "qw" } }));
  const { handlers, toasts } = commands(startup);
  await handlers.unset(ctx, { name: "hint_letters" });
  await handlers.unset(ctx, { name: "next_patterns" });
  const expected = MINE.replace('hint_letters = "abc" # home row\n', "").replace('next_patterns = [\n  "next",\n  "more",\n]\n', "");
  assert.equal(host.files["settings.toml"], expected);
  assert.equal(stored_settings(local), expected);
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], {});
  assert.deepEqual(toasts, ["success Unset hint_letters, saved to settings.toml", "success Unset next_patterns, saved to settings.toml"]);
  const { settings } = await startup.get_config();
  assert.equal(settings.hint_letters, undefined);
});

test(":unset of a key only the browser edits set drops them and writes nothing, and one set nowhere says so", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, sent, startup } = await reloaded(host);
  await startup.change_edits(() => ({ saved: { newtab_date: false }, temp: {} }));
  sent.length = 0;
  const { handlers, toasts } = commands(startup);
  await handlers.unset(ctx, { name: "newtab_date" });
  await handlers.unset(ctx, { name: "newtab_date" });
  assert.deepEqual(toasts, ["success Unset newtab_date", "info newtab_date is not set"]);
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  assert.equal(host.files["settings.toml"], MINE);
  assert.deepEqual(sent.filter((message) => message.cmd === "write_config_file"), []);
});

test(":unset all drops the browser edits only, and settings.toml keeps every key", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, startup } = await reloaded(host);
  await startup.change_edits(() => ({ saved: { newtab_date: false }, temp: { toast_ms: 10 } }));
  await commands(startup).handlers.unset(ctx, { name: "all" });
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  assert.equal(host.files["settings.toml"], MINE);
  assert.equal((await startup.get_config()).settings.toast_ms, 2000);
});

test("a key a settings.d file sets: :set and :unset refuse and name the file, but :unset still drops a browser edit", async () => {
  const host = { files: { "settings.toml": MINE, "settings.d/10-mine.toml": "toast_ms = 1000\n" } };
  const { local, startup } = await reloaded(host);
  const named = (error: unknown) => error instanceof RuntimeRefusal && /settings\.d\/10-mine\.toml sets toast_ms/.test(error.message);
  await assert.rejects(startup.set_in_settings_file("toast_ms", 600), named);
  await assert.rejects(startup.unset_in_settings_file("toast_ms"), named);
  await startup.change_edits(() => ({ saved: { toast_ms: 700 }, temp: {} }));
  assert.deepEqual(await startup.unset_in_settings_file("toast_ms"), { kind: "edits_only" });
  assert.equal(stored_settings(local), MINE);
  assert.equal((await startup.get_config()).settings.toast_ms, 1000);
});

test("without a host, or with one that lacks the verb, the change applies and the reply says the file waits", async () => {
  const hosts: { files: Files; granted?: boolean; old_host?: boolean }[] = [{ files: { "settings.toml": MINE }, granted: true }, { files: { "settings.toml": MINE }, old_host: true }];
  for (const host of hosts) {
    const { local, startup } = await reloaded(host);
    if ("granted" in host) host.granted = false;
    const { handlers, toasts } = commands(startup);
    await handlers.set(ctx, { name: "toast_ms", value: "1500" });
    await handlers.unset(ctx, { name: "hint_letters" });
    assert.equal((await startup.get_config()).settings.toast_ms, 1500);
    assert.equal(host.files["settings.toml"], MINE);
    assert.ok(toasts.every((toast) => !toast.includes("saved to")), toasts.join("\n"));
    assert.match(toasts[0]!, "granted" in host ? /updates when the native host connects$/ : /updates once the native host is updated$/);
    assert.deepEqual(unsynced_of(local), { "settings.toml": MINE });
  }
});

test("a set and an unset of other keys while a write is out land in one later write", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, fake, sent, startup } = await reloaded(host);
  const held = hold_writes(fake);
  const first = startup.set_in_settings_file("toast_ms", 1500);
  await writes_held(held, 1);
  const second = startup.set_in_settings_file("next_patterns", ["on"]);
  const third = startup.unset_in_settings_file("hint_letters");
  await pause();
  assert.equal(held.length, 1, "a second write went out while the first was out");
  held.shift()!();
  await writes_held(held, 1);
  held.shift()!();
  assert.deepEqual(await Promise.all([first, second, third]), [{ kind: "written" }, { kind: "written" }, { kind: "written" }]);
  assert.equal(sent.filter((message) => message.cmd === "write_config_file").length, 2);
  const expected = MINE.replace('hint_letters = "abc" # home row\n', "").replace('next_patterns = [\n  "next",\n  "more",\n]', 'next_patterns = ["on"]').replace("toast_ms = 2000", "toast_ms = 1500");
  assert.equal(host.files["settings.toml"], expected);
  assert.equal(unsynced_of(local), undefined);
});

test("an editor save of another key during a write keeps both, a list and a removal included", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, fake, startup } = await reloaded(host);
  const send = fake.runtime.sendNativeMessage;
  const held = hold_writes(fake);
  const set = startup.set_in_settings_file("next_patterns", ["on"]);
  const unset = startup.unset_in_settings_file("toast_ms");
  await writes_held(held, 1);
  host.files = { "settings.toml": HAND };
  fake.runtime.sendNativeMessage = send;
  held.shift()!();
  assert.deepEqual(await Promise.all([set, unset]), [{ kind: "written" }, { kind: "written" }]);
  const expected = HAND.replace('next_patterns = [\n  "next",\n  "more",\n]', 'next_patterns = ["on"]').replace("toast_ms = 2000\n", "");
  assert.equal(host.files["settings.toml"], expected);
  assert.equal(stored_settings(local), expected);
  assert.equal(unsynced_of(local), undefined);
});

test("an editor save of the same key during a write is never overwritten", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { fake, startup } = await reloaded(host);
  const send = fake.runtime.sendNativeMessage;
  const held = hold_writes(fake);
  const unset = startup.unset_in_settings_file("hint_letters");
  await writes_held(held, 1);
  host.files = { "settings.toml": HAND };
  fake.runtime.sendNativeMessage = send;
  held.shift()!();
  assert.deepEqual(await unset, { kind: "conflict" });
  assert.equal(host.files["settings.toml"], HAND);
});

test("an import between a change and its write says the file was not written, and `,r` writes a waiting unset first", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { startup } = await reloaded(host);
  const { handlers, toasts } = commands(startup);
  const set = handlers.set(ctx, { name: "toast_ms", value: "1500" });
  const imported = startup.import_config({ kind: "folder", entries: [{ path: "keymap.toml", text: "" }] }, {});
  await Promise.all([set, imported]);
  await startup.reload_config();
  const unset = handlers.unset(ctx, { name: "toast_ms" });
  const reload = startup.reload_config();
  await Promise.all([unset, reload]);
  assert.deepEqual(toasts, [
    "warning toast_ms = 1500. A config import replaced the browser copy before the write, so settings.toml was not written",
    "success Unset toast_ms, saved to settings.toml",
  ]);
  assert.equal(host.files["settings.toml"], MINE.replace("toast_ms = 2000\n", ""));
  assert.equal((await startup.get_config()).settings.toast_ms, undefined);
});

test("a theme or engine name that matches nothing is refused by name, and nothing changes", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, sent, startup } = await reloaded(host);
  sent.length = 0;
  await assert.rejects(startup.set_in_settings_file("default_engine", "nowhere"), (error: unknown) => error instanceof RuntimeRefusal && error.message === 'default_engine not changed: no search engine named "nowhere"');
  await assert.rejects(startup.set_in_settings_file("theme", "nowhere"), (error: unknown) => error instanceof RuntimeRefusal && error.message === 'theme not changed: no theme named "nowhere"');
  assert.equal(stored_settings(local), MINE);
  assert.deepEqual(sent.filter((message) => message.cmd === "write_config_file"), []);
});

test("the edits of lists and removals are put onto the folder's text where the folder kept the base value", () => {
  const edited = MINE.replace('next_patterns = [\n  "next",\n  "more",\n]', 'next_patterns = ["on"]').replace("toast_ms = 2000\n", "");
  assert.equal(replayed_on_folder(MINE, edited, HAND), HAND.replace('next_patterns = [\n  "next",\n  "more",\n]', 'next_patterns = ["on"]').replace("toast_ms = 2000\n", ""));
  assert.equal(replayed_on_folder(MINE, edited, MINE.replace('"more"', '"other"')), undefined);
});

test("a :set while the copies-differ question waits is written, the question stays, and either answer keeps the set", async () => {
  for (const choice of ["keep_browser", "use_folder"] as const) {
    const host = { files: { "settings.toml": MINE, "keymap.toml": "" } as Files };
    const { local, startup: before_restart } = await reloaded(host);
    // A browser change and a folder change, so the start stores the question.
    await before_restart.save_config_file("keymap.toml", '[normal]\n"zz" = "tab.next"\n', "");
    host.files = { ...host.files, "keymap.toml": '[normal]\n"zx" = "tab.next"\n' };
    const startup = await fresh_startup();
    await startup.reload_config_at_start();
    assert.notEqual(local[HOST_START_PENDING_STORAGE_KEY], undefined);

    assert.deepEqual(await startup.set_in_settings_file("toast_ms", 1500), { kind: "written" });
    assert.equal(host.files["settings.toml"], MINE.replace("toast_ms = 2000", "toast_ms = 1500"));
    const pending = local[HOST_START_PENDING_STORAGE_KEY] as { host_digest: string; browser_digest: string };
    assert.notEqual(pending, undefined, "the keymap still differs, so the question stays");
    await startup.choose_host_start(choice, pending);
    assert.equal((await startup.get_config()).settings.toast_ms, 1500, choice);
  }
});

test("a default engine of the Engines page's file goes to settings.toml, and an unknown name is refused", async () => {
  const page_file = `${PAGE_FILE_MARKER}\n\n[page_one]\nurl = "https://p.test/?q={query}"\n`;
  const host = { files: { "settings.toml": MINE, "search_engines.d/zz-desertfox.toml": page_file } };
  const { local, startup } = await reloaded(host);
  const { handlers, toasts } = commands(startup);
  await handlers.set(ctx, { name: "default_engine", value: "page_one" });
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  assert.match(host.files["settings.toml"]!, /^default_engine = "page_one"$/m);
  assert.equal((await startup.get_config()).settings.default_engine, "page_one");
  await assert.rejects(handlers.set(ctx, { name: "default_engine", value: "nowhere" }), /no search engine named "nowhere"/);
  assert.deepEqual(toasts, ['success default_engine = "page_one", saved to settings.toml']);
});

test("an engine added in the browser saves as the default in the browser, and an engine in the files goes to the file", async () => {
  const host = { files: { "settings.toml": MINE, "search_engines.toml": 'files_one = { url = "https://f.test/?q={query}" }\n' } };
  const { local, sent, startup } = await reloaded(host);
  await startup.change_layers("engines", () => ({ engines: { browser_one: { url: "https://b.test/?q={query}" } } }));
  sent.length = 0;
  const { handlers, toasts } = commands(startup);
  await handlers.set(ctx, { name: "default_engine", value: "browser_one" });
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { default_engine: "browser_one" });
  assert.equal(stored_settings(local), MINE);
  assert.deepEqual(sent.filter((message) => message.cmd === "write_config_file"), []);
  assert.equal((await startup.get_config()).settings.default_engine, "browser_one");

  await handlers.set(ctx, { name: "default_engine", value: "files_one" });
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  assert.match(host.files["settings.toml"]!, /^default_engine = "files_one"$/m);
  assert.deepEqual(toasts, ['success default_engine = "browser_one", saved in the browser because the search engine is not in your files', 'success default_engine = "files_one", saved to settings.toml']);
});

test("a default engine that needs the current page is refused by name before any build, and the dropdown leaves it out", async () => {
  const host = { files: { "settings.toml": MINE, "search_engines.toml": 'repo_one = { url = "https://r.test/{repo}?q={query}" }\nplain = { url = "https://p.test/?q={query}" }\n' } };
  const { local, sent, startup } = await reloaded(host);
  sent.length = 0;
  for (const engine of ["site", "repo_one"]) {
    await assert.rejects(startup.set_in_settings_file("default_engine", engine), (error: unknown) => error instanceof RuntimeRefusal && error.message === `default_engine not changed: ${engine} needs the current page, so it cannot be the default engine`);
  }
  assert.equal(stored_settings(local), MINE);
  assert.deepEqual(sent.filter((message) => message.cmd === "write_config_file"), []);
  const offered = default_engine_names((await startup.get_config()).search_engines);
  assert.ok(offered.includes("plain") && offered.includes("duck"), offered.join(" "));
  assert.ok(!offered.includes("site") && !offered.includes("repo_one"), offered.join(" "));
});

// Each value a setting takes that TOML must escape: quotes, a backslash, a newline, a tab, a `#` and non-ASCII.
const AWKWARD_VALUES = [
  ["scroll_selector", '[data-label="a\\b"]'],
  ["newtab_weather_city", 'line one\nline\ttwo # not a comment "quoted" \\ é 東京 🌵'],
  ["next_patterns", ['say "next"', "a\\b", "# hash", "→ 次へ", "tab\there"]],
] as const;

test("every awkward string goes through the file, parses back and reloads as the exact value", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { startup } = await reloaded(host);
  for (const [name, value] of AWKWARD_VALUES) assert.deepEqual(await startup.set_in_settings_file(name, value), { kind: "written" }, name);
  const parsed = parse(host.files["settings.toml"]!) as Record<string, unknown>;
  const reloaded_startup = await fresh_startup();
  await reloaded_startup.reload_config();
  const { settings } = await reloaded_startup.get_config();
  for (const [name, value] of AWKWARD_VALUES) {
    assert.deepEqual(parsed[name], value, `${name} in the file`);
    assert.deepEqual(settings[name], value, `${name} after a reload`);
  }
  // The comment and the table after the edited keys stay as they were.
  assert.ok(host.files["settings.toml"]!.includes('hint_letters = "abc" # home row\n') && host.files["settings.toml"]!.endsWith('[[site_rules]]\nsite = "*://x.test/*"\noff = true\n'));
});
