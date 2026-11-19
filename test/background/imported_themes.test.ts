import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "smol-toml";
import "../../src/background/command_modules.ts";
import { answer_config_transfer } from "../../src/background/config_transfer.ts";
import { load_edits } from "../../src/background/config_load.ts";
import { create_theme_messages, imports_moved_to_files, stored_imports_of } from "../../src/background/theme_message.ts";
import { FILES_SOURCE_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY, THEME_EDITS_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { DEFAULT_SETTINGS } from "../../src/shared/config.ts";
import { build_setting_list } from "../../src/shared/setting_list.ts";
import { parse_base16 } from "../../src/shared/theme/base16.ts";
import { THEME_STORAGE_KEY } from "../../src/shared/theme/apply.ts";
import { load_theme } from "../../src/shared/theme/load.ts";
import { write_zip } from "../../src/shared/zip.ts";
import { install_fake_browser, until, type Files } from "./config_fake_browser.ts";

type Startup = typeof import("../../src/background/startup.ts");
let fresh_count = 0;
const fresh_startup = async () => (await import(`../../src/background/startup.ts?imported_themes_${fresh_count++}`)) as Startup;

const SCHEME = `scheme: "Gruvbox dark, medium"
base00: "282828"
base01: "3c3836"
base02: "504945"
base03: "665c54"
base04: "bdae93"
base05: "d5c4a1"
base06: "ebdbb2"
base07: "fbf1c7"
base08: "fb4934"
base09: "fe8019"
base0A: "fabd2f"
base0B: "b8bb26"
base0C: "8ec07c"
base0D: "83a598"
base0E: "d3869b"
base0F: "d65d0e"
`;
const OTHER_SCHEME = SCHEME.replace('"282828"', '"101820"').replace("Gruvbox dark, medium", "Other");
const mapped = (text: string) => {
  const parsed = parse_base16(text);
  assert.ok(parsed.ok);
  return parsed.scheme.theme;
};
// The text a save writes to `themes/<name>.toml`.
const file_of = (text: string) => stringify(mapped(text));
const HAND_THEME = '[dark]\nbg_core = "#000000"\nfg_core = "#ffffff"\nprimary = "#ff0000"\naccent = "#00ff00"\n';

type Host = { files: Files; granted?: boolean; old_host?: boolean; settings_only_host?: boolean };

const messages_of = (startup: Startup) => create_theme_messages({ read_files: startup.read_stored_files, set_theme_file: startup.set_theme_file });

// A profile that read the folder once through the host, as after `,r`, so its changes go to the folder.
async function started(files: Files = { "settings.toml": "" }, host: Host = { files }) {
  const browser = install_fake_browser(host);
  const startup = await fresh_startup();
  await startup.get_config();
  await startup.reload_config();
  return { host, startup, messages: messages_of(startup), ...browser };
}

const save = (name: string, text: string, replace = false) => ({ type: "change_imported_themes", action: "save", name, text, ...(replace && { replace }) }) as const;
const remove = (name: string) => ({ type: "change_imported_themes", action: "remove", name }) as const;
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

test("a saved scheme becomes themes/<name>.toml in the copy and the folder, and a pick of it goes into settings.toml", async () => {
  const { host, messages, startup, local } = await started();
  const answer = await messages.change(save("dusk_one", SCHEME));
  assert.deepEqual(answer, { ok: true, message: "Saved the theme dusk_one, saved to themes/dusk_one.toml. Use it with :set theme dusk_one." });
  assert.equal(host.files["themes/dusk_one.toml"], file_of(SCHEME));
  assert.equal(stored_files(local)["themes/dusk_one.toml"], file_of(SCHEME));
  assert.deepEqual(await messages.list(), { ok: true, names: ["dusk_one"] });
  assert.equal(unsynced_of(local), undefined);
  assert.equal(local[THEME_EDITS_STORAGE_KEY], undefined);

  assert.deepEqual(await startup.set_in_settings_file("theme", "dusk_one"), { kind: "written" });
  assert.equal(host.files["settings.toml"], 'theme = "dusk_one"\n');
  assert.deepEqual(local[THEME_STORAGE_KEY], mapped(SCHEME));
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
});

test("a malformed, partial or misnamed scheme is refused, and nothing is stored or sent", async () => {
  const { messages, local, sent } = await started();
  const before = structuredClone(stored_files(local));
  sent.length = 0;
  const partial = SCHEME.replace(/base0[ef].*\n/gi, "");
  for (const [name, text, pattern] of [
    ["half", partial, /lacks base0E, base0F/],
    ["junk", "base00: nope\n", /not a six-digit hex color/],
    ["oasis_cactus", SCHEME, /built-in/],
    ["desktop", SCHEME, /built-in/],
    ["Bad Name", SCHEME, /lowercase/],
    ["__proto__", SCHEME, /lowercase/],
    ["../x", SCHEME, /lowercase/],
  ] as const) {
    const answer = await messages.change(save(name, text));
    assert.equal(answer.ok, false, name);
    assert.match(answer.message, pattern);
  }
  assert.equal((await messages.change({ type: "change_imported_themes", action: "save", name: 5, text: SCHEME } as never)).ok, false);
  assert.deepEqual(stored_files(local), before);
  assert.ok(!sent.some((message) => message.cmd === "write_config_file"));
});

test("saving over a name asks first and replaces only when told to", async () => {
  const { host, messages } = await started();
  await messages.change(save("mine", SCHEME));
  const asked = await messages.change(save("mine", OTHER_SCHEME));
  assert.deepEqual([asked.ok, "needs_replace" in asked && asked.needs_replace], [false, true]);
  assert.equal(host.files["themes/mine.toml"], file_of(SCHEME));
  const replaced = await messages.change(save("mine", OTHER_SCHEME, true));
  assert.ok(replaced.ok && replaced.message.startsWith("Replaced the theme mine, saved to themes/mine.toml"));
  assert.equal(host.files["themes/mine.toml"], file_of(OTHER_SCHEME));
});

test("a save over a theme file added by hand since the last read leaves that file and asks", async () => {
  const { host, messages, local } = await started();
  host.files = { ...host.files, "themes/mine.toml": HAND_THEME };
  const answer = await messages.change(save("mine", SCHEME));
  assert.ok(answer.ok);
  assert.match(answer.message, /themes\/mine\.toml changed on disk, so it stays as it is/);
  assert.equal(host.files["themes/mine.toml"], HAND_THEME);
  assert.notEqual(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("removing the theme in use deletes its file, takes theme out of settings.toml and drops a temp edit naming it", async () => {
  const { host, messages, startup, local } = await started();
  await messages.change(save("dusk_one", SCHEME));
  await messages.change(save("other", OTHER_SCHEME));
  await startup.set_in_settings_file("theme", "dusk_one");
  await startup.change_edits((current) => ({ ...current, temp: { theme: "dusk_one", which_key_delay_ms: 5 } }));

  const removed = await messages.change(remove("dusk_one"));
  assert.deepEqual(removed, { ok: true, message: "Removed the theme dusk_one, and themes/dusk_one.toml is deleted from the config folder. The theme setting goes back to the default, saved to settings.toml." });
  assert.equal(host.files["themes/dusk_one.toml"], undefined);
  assert.equal(host.files["settings.toml"], "");
  assert.equal(stored_files(local)["themes/dusk_one.toml"], undefined);
  assert.deepEqual((await load_edits()).temp, { which_key_delay_ms: 5 });
  assert.deepEqual(local[THEME_STORAGE_KEY], load_theme("oasis_moonlight", 3));
  assert.equal((await startup.get_config()).settings.theme, undefined);
  assert.deepEqual((local[WARNINGS_STORAGE_KEY] as string[]).filter((warning) => warning.includes("theme")), []);
  assert.equal(unsynced_of(local), undefined);
  assert.match((await messages.change(remove("dusk_one"))).message, /No theme named dusk_one/);
});

test("removing a theme that is not in use leaves the setting and the published theme alone, across a restart", async () => {
  const { host, messages, startup, local } = await started();
  await messages.change(save("dusk_one", SCHEME));
  await messages.change(save("other", OTHER_SCHEME));
  await startup.set_in_settings_file("theme", "other");
  assert.deepEqual(await messages.change(remove("dusk_one")), { ok: true, message: "Removed the theme dusk_one, and themes/dusk_one.toml is deleted from the config folder." });
  assert.equal(host.files["settings.toml"], 'theme = "other"\n');
  assert.deepEqual(local[THEME_STORAGE_KEY], mapped(OTHER_SCHEME));
  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.equal((await restarted.get_config()).settings.theme, "other");
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a settings.d file that picks the theme refuses its removal and names that file", async () => {
  const { host, messages, local } = await started({ "settings.toml": "", "settings.d/look.toml": 'theme = "oasis_night"\n' });
  await messages.change(save("dusk_one", SCHEME));
  host.files = { ...host.files, "settings.d/look.toml": 'theme = "dusk_one"\n' };
  const startup = await fresh_startup();
  await startup.reload_config();
  const answer = await messages_of(startup).change(remove("dusk_one"));
  assert.deepEqual(answer, { ok: false, message: 'settings.d/look.toml sets theme = "dusk_one". Change it there before you remove the theme.' });
  assert.equal(host.files["themes/dusk_one.toml"], file_of(SCHEME));
  assert.equal(stored_files(local)["themes/dusk_one.toml"], file_of(SCHEME));
});

test("a remove of a theme file edited by hand since the last read leaves the file and asks", async () => {
  const { host, messages, local } = await started();
  await messages.change(save("dusk_one", SCHEME));
  host.files = { ...host.files, "themes/dusk_one.toml": HAND_THEME };
  const answer = await messages.change(remove("dusk_one"));
  assert.ok(answer.ok);
  assert.match(answer.message, /themes\/dusk_one\.toml changed on disk, so it stays as it is/);
  assert.equal(host.files["themes/dusk_one.toml"], HAND_THEME);
  assert.notEqual(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("without the host a save changes the copy and waits, and the next start writes the file", async () => {
  const files = { "settings.toml": "" };
  const host: Host = { files };
  const { messages, local } = await started(files, host);
  host.granted = false;
  const answer = await messages.change(save("dusk_one", SCHEME));
  assert.ok(answer.ok);
  assert.match(answer.message, /themes\/dusk_one\.toml updates when the native host connects/);
  assert.deepEqual(unsynced_of(local), { "themes/dusk_one.toml": null });
  assert.equal(host.files["themes/dusk_one.toml"], undefined);

  host.granted = true;
  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.equal(host.files["themes/dusk_one.toml"], file_of(SCHEME));
  assert.equal(unsynced_of(local), undefined);
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a remove that runs while the save of the same theme is still out deletes the file once the save lands", async () => {
  const { host, fake, messages, local } = await started();
  const held = hold_writes(fake);
  const saving = messages.change(save("dusk_one", SCHEME));
  await until(() => held.length === 1, "the save did not go out");
  const removing = messages.change(remove("dusk_one"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(held.length, 1, "the delete went out while the save was out");
  held.shift()!();
  await until(() => held.length === 1, "the delete did not go out after the save");
  assert.equal(host.files["themes/dusk_one.toml"], file_of(SCHEME));
  held.shift()!();
  const [saved, removed] = await Promise.all([saving, removing]);
  assert.ok(saved.ok && removed.ok, `${saved.message} / ${removed.message}`);
  assert.equal(host.files["themes/dusk_one.toml"], undefined);
  assert.equal(stored_files(local)["themes/dusk_one.toml"], undefined);
  assert.equal(unsynced_of(local), undefined);
});

test("an import and a pick of it sent back to back both reach the folder, the theme file first", async () => {
  const { host, fake, messages, startup, local } = await started();
  const held = hold_writes(fake);
  const saving = messages.change(save("dusk_one", SCHEME));
  const picking = startup.set_in_settings_file("theme", "dusk_one");
  await until(() => held.length === 1, "the theme write did not go out");
  // settings.toml names the theme, so its write waits until the theme file lands.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(held.length, 1, "settings.toml went out before the theme file it names");
  held.shift()!();
  await until(() => held.length === 1, "the settings.toml write did not go out after the theme file");
  assert.equal(host.files["themes/dusk_one.toml"], file_of(SCHEME));
  held.shift()!();
  const [saved, picked] = await Promise.all([saving, picking]);
  assert.ok(saved.ok, saved.message);
  assert.deepEqual(picked, { kind: "written" });
  assert.equal(host.files["themes/dusk_one.toml"], file_of(SCHEME));
  assert.equal(host.files["settings.toml"], 'theme = "dusk_one"\n');
  assert.equal(unsynced_of(local), undefined);
  assert.deepEqual(local[THEME_STORAGE_KEY], mapped(SCHEME));

  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("the settings export carries each theme file, and importing it elsewhere gives the same theme by name", async () => {
  const first = await started();
  await first.messages.change(save("dusk_one", SCHEME));
  await first.messages.change(save("other", OTHER_SCHEME));
  await first.startup.set_in_settings_file("theme", "other");
  const answer = await answer_config_transfer({ type: "export_config" }, {
    read_files: first.startup.read_stored_files,
    read_saved: async () => (await load_edits()).saved,
    read_keymap_edits: async () => ({ edits: {}, skipped: [] }),
    remove: first.startup.remove_snippet,
  });
  assert.ok(answer.ok && "config_files" in answer);
  const exported = answer.config_files;
  assert.deepEqual(Object.keys(exported).filter((path) => path.startsWith("themes/")).sort(), ["themes/dusk_one.toml", "themes/other.toml"]);

  const second = await started();
  await second.startup.import_config({ kind: "zip", bytes: write_zip(exported) }, {});
  const config = await second.startup.get_config();
  assert.deepEqual(config.local_themes?.dusk_one, mapped(SCHEME));
  assert.deepEqual(second.local[THEME_STORAGE_KEY], mapped(OTHER_SCHEME));
});

// A profile from before theme files: the imports and the pick of one sit in browser storage.
async function with_stored_imports(files: Files, saved: Record<string, unknown>, host: Host = { files }) {
  const profile = await started(files, host);
  profile.local[THEME_EDITS_STORAGE_KEY] = { dusk_one: mapped(SCHEME), other: mapped(OTHER_SCHEME) };
  profile.local[SAVED_SETTINGS_STORAGE_KEY] = { ...saved };
  return profile;
}

test("the first start moves the stored imports into theme files and the saved pick into settings.toml, once", async () => {
  const { host, local, sent } = await with_stored_imports({ "settings.toml": "# mine\n" }, { theme: "dusk_one", which_key_delay_ms: 5 });
  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.equal(host.files["themes/dusk_one.toml"], file_of(SCHEME));
  assert.equal(host.files["themes/other.toml"], file_of(OTHER_SCHEME));
  assert.equal(host.files["settings.toml"], 'theme = "dusk_one"\n# mine\n');
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { which_key_delay_ms: 5 });
  assert.equal(local[THEME_EDITS_STORAGE_KEY], undefined);
  assert.equal(unsynced_of(local), undefined);
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
  assert.equal((await restarted.get_config()).settings.theme, "dusk_one");
  assert.deepEqual(local[THEME_STORAGE_KEY], mapped(SCHEME));

  sent.length = 0;
  const again = await fresh_startup();
  await again.reload_config_at_start();
  assert.ok(!sent.some((message) => message.cmd === "write_config_file"), "a second start wrote again");
});

test("with the host off the moved files wait in the record, and the next start with the host writes them", async () => {
  const files = { "settings.toml": "" };
  const host: Host = { files };
  const { local } = await with_stored_imports(files, { theme: "other" }, host);
  host.granted = false;
  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.equal(local[THEME_EDITS_STORAGE_KEY], undefined);
  assert.deepEqual(unsynced_of(local), { "themes/dusk_one.toml": null, "themes/other.toml": null, "settings.toml": "" });
  assert.equal(stored_files(local)["themes/other.toml"], file_of(OTHER_SCHEME));
  assert.equal((await restarted.get_config()).settings.theme, "other");
  assert.equal(host.files["themes/other.toml"], undefined);

  host.granted = true;
  const later = await fresh_startup();
  await later.reload_config_at_start();
  assert.equal(host.files["themes/other.toml"], file_of(OTHER_SCHEME));
  assert.equal(host.files["settings.toml"], 'theme = "other"\n');
  assert.equal(unsynced_of(local), undefined);
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a stop after the files are stored and before the list is dropped moves nothing twice at the next start", async () => {
  const { host, local, fake } = await with_stored_imports({ "settings.toml": "" }, { theme: "dusk_one" });
  const remove_key = fake.storage.local.remove;
  let stopped = false;
  fake.storage.local.remove = async (key: string | string[]) => {
    if (!stopped && [key].flat().includes(THEME_EDITS_STORAGE_KEY)) {
      stopped = true;
      throw new Error("the browser stopped");
    }
    return remove_key(key);
  };
  const crashed = await fresh_startup();
  await crashed.reload_config_at_start();
  assert.ok(stopped);
  assert.notEqual(local[THEME_EDITS_STORAGE_KEY], undefined);

  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.equal(local[THEME_EDITS_STORAGE_KEY], undefined);
  assert.deepEqual(Object.keys(host.files).filter((path) => path.startsWith("themes/")).sort(), ["themes/dusk_one.toml", "themes/other.toml"]);
  assert.equal(host.files["settings.toml"], 'theme = "dusk_one"\n');
  assert.equal(unsynced_of(local), undefined);
});

test("a stored import whose name a theme file of other text holds moves to <name>-browser, and the saved pick follows it", async () => {
  const { host, local } = await with_stored_imports({ "settings.toml": "", "themes/dusk_one.toml": HAND_THEME }, { theme: "dusk_one" });
  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.equal(host.files["themes/dusk_one.toml"], HAND_THEME);
  assert.equal(host.files["themes/dusk_one-browser.toml"], file_of(SCHEME));
  assert.equal(host.files["settings.toml"], 'theme = "dusk_one-browser"\n');
  assert.deepEqual(local[THEME_STORAGE_KEY], mapped(SCHEME));
});

test("a saved pick of an import stays a saved edit, under the new name, while a settings.d file sets theme", () => {
  const files = { "settings.toml": "", "settings.d/look.toml": 'theme = "nord"\n', "themes/dusk_one.toml": HAND_THEME };
  const moved = imports_moved_to_files({ dusk_one: mapped(SCHEME) }, files, { theme: "dusk_one" });
  assert.deepEqual(moved.saved, { theme: "dusk_one-browser" });
  assert.deepEqual(moved.paths, ["themes/dusk_one-browser.toml"]);
  assert.equal(moved.files["settings.toml"], "");
  const long = "a".repeat(48);
  assert.deepEqual(imports_moved_to_files({ [long]: mapped(SCHEME) }, { [`themes/${long}.toml`]: HAND_THEME }, {}).paths, [`themes/${"a".repeat(40)}-browser.toml`]);
});

test("a pick and an import sent while the start moves the stored imports land after the move", async () => {
  const { host, local } = await with_stored_imports({ "settings.toml": "" }, { theme: "dusk_one" });
  const restarted = await fresh_startup();
  const starting = restarted.reload_config_at_start();
  const picking = restarted.set_in_settings_file("theme", "other");
  const saving = messages_of(restarted).change(save("third", SCHEME));
  await starting;
  assert.deepEqual(await picking, { kind: "written" });
  assert.ok((await saving).ok);
  assert.equal(host.files["settings.toml"], 'theme = "other"\n');
  assert.equal(host.files["themes/third.toml"], file_of(SCHEME));
  assert.equal(host.files["themes/dusk_one.toml"], file_of(SCHEME));
  assert.equal(local[THEME_EDITS_STORAGE_KEY], undefined);
  assert.equal(unsynced_of(local), undefined);
});

test("a damaged stored list moves only the whole themes", () => {
  const good = mapped(SCHEME);
  const { accent: _gone, ...no_accent } = good.dark;
  const stored = { good, no_accent: { dark: no_accent, light: good.light }, bad_color: { dark: { ...good.dark, primary: "red" }, light: good.light }, "Bad Name": good, text: "not a theme" };
  assert.deepEqual(Object.keys(stored_imports_of(stored)), ["good"]);
  assert.deepEqual(stored_imports_of("garbage"), {});
});

test("the picker lists the theme file names after the built-in ones, without repeating a built-in name", () => {
  const status = { settings: DEFAULT_SETTINGS, saved: [], temp: [], configured: [] };
  const allowed = build_setting_list(status, ["dusk_one", "oasis_cactus"]).find((row) => row.name === "theme")?.allowed ?? [];
  assert.equal(allowed.at(-1), "dusk_one");
  assert.equal(allowed.filter((name) => name === "oasis_cactus").length, 1);
  assert.equal(build_setting_list(status).find((row) => row.name === "theme")?.allowed?.includes("dusk_one"), false);
});

test("a config stored with the single local_theme key still gives that theme", async () => {
  const { pick_config } = await import("../../src/background/config_load.ts");
  const theme = mapped(SCHEME);
  const stored = { format_version: 1, keymap: {}, search_engines: {}, command_aliases: {}, quickmarks: {}, settings: {}, snippets: [], css: "", local_theme: { name: "mine", colors: theme } };
  const { CONFIG_FORMAT_VERSION } = await import("../../src/shared/config.ts");
  const loaded = pick_config({ ...stored, format_version: CONFIG_FORMAT_VERSION });
  assert.equal(loaded.source, "files");
  assert.deepEqual(loaded.config.local_themes?.mine, theme);
});

// A host from before `write_config_file` writes settings.toml through `write_settings` but no theme file, so settings.toml waits for the theme file it names.
const builds = async (startup: Startup) => {
  await startup.reload_config();
  return true;
};

test("a pick of a saved theme the folder lacks waits for the theme file, and the updated host writes both in order", async () => {
  const files = { "settings.toml": "" };
  const host: Host = { files };
  const { messages, startup, local } = await started(files, host);
  host.settings_only_host = true;
  const saved = await messages.change(save("dusk_one", SCHEME));
  assert.ok(saved.ok);
  assert.match(saved.message, /themes\/dusk_one\.toml updates once the native host is updated/);
  assert.deepEqual(await startup.set_in_settings_file("theme", "dusk_one"), { kind: "waiting", host_outdated: true });
  assert.equal(host.files["settings.toml"], "");
  assert.equal(host.files["themes/dusk_one.toml"], undefined);
  assert.deepEqual(local[THEME_STORAGE_KEY], mapped(SCHEME));

  host.settings_only_host = false;
  const updated = await fresh_startup();
  await updated.reload_config_at_start();
  assert.equal(host.files["themes/dusk_one.toml"], file_of(SCHEME));
  assert.equal(host.files["settings.toml"], 'theme = "dusk_one"\n');
  assert.equal(unsynced_of(local), undefined);
  assert.ok(await builds(updated));
});

test("the moved imports and the moved pick reach the folder in an order that builds, while the host knows only write_settings", async () => {
  const files = { "settings.toml": "" };
  const host: Host = { files };
  const { local } = await with_stored_imports(files, { theme: "dusk_one" }, host);
  host.settings_only_host = true;
  const restarted = await fresh_startup();
  await restarted.reload_config_at_start();
  assert.equal(host.files["settings.toml"], "");
  assert.equal(host.files["themes/dusk_one.toml"], undefined);
  assert.equal(local[THEME_EDITS_STORAGE_KEY], undefined);

  host.settings_only_host = false;
  const updated = await fresh_startup();
  await updated.reload_config_at_start();
  assert.equal(host.files["settings.toml"], 'theme = "dusk_one"\n');
  assert.ok(await builds(updated));
});

test("a remove of the theme in use clears settings.toml before the delete, and a hand edit of settings.toml keeps the theme file", async () => {
  const { host, messages, startup, local } = await started();
  await messages.change(save("dusk_one", SCHEME));
  await startup.set_in_settings_file("theme", "dusk_one");
  host.settings_only_host = true;
  // A browser change the folder lacks, so the refused settings.toml cannot take the folder's text and goes to the question.
  await startup.save_config_file("keymap.toml", '[normal]\n"zz" = "tab.next"\n', null);
  host.files = { ...host.files, "settings.toml": '# mine\ntheme = "dusk_one"\n' };
  const answer = await messages.change(remove("dusk_one"));
  assert.ok(answer.ok);
  assert.match(answer.message, /themes\/dusk_one\.toml changed on disk, so it stays as it is/);
  assert.equal(host.files["settings.toml"], '# mine\ntheme = "dusk_one"\n');
  assert.equal(host.files["themes/dusk_one.toml"], file_of(SCHEME));
  assert.equal(unsynced_of(local), undefined);
  assert.notEqual(local[HOST_START_PENDING_STORAGE_KEY], undefined);
  assert.ok(await builds(await fresh_startup()));
});

test("with no config folder, a remove of the theme in use says once that only the browser copy changed", async () => {
  const browser = install_fake_browser({ files: {}, granted: false });
  const startup = await fresh_startup();
  await startup.get_config();
  const messages = messages_of(startup);
  await messages.change(save("dusk_one", SCHEME));
  await startup.set_in_settings_file("theme", "dusk_one");
  const answer = await messages.change(remove("dusk_one"));
  assert.deepEqual(answer, { ok: true, message: "Removed the theme dusk_one from the browser copy. It did not come from a config folder, so no file there changes. The theme setting goes back to the default." });
  assert.equal(stored_files(browser.local)["themes/dusk_one.toml"], undefined);
});

test("a theme file whose name the host does not write is listed apart, and its remove is refused with the file kept", async () => {
  const { host, messages, local } = await started({ "settings.toml": "", "themes/Nord.toml": HAND_THEME, "themes/dusk.toml": HAND_THEME });
  assert.deepEqual(await messages.list(), { ok: true, names: ["dusk"], kept_names: ["Nord"] });
  const answer = await messages.change(remove("Nord"));
  assert.equal(answer.ok, false);
  assert.match(answer.message, /does not write themes\/Nord\.toml.*by hand/);
  assert.equal(stored_files(local)["themes/Nord.toml"], HAND_THEME);
  assert.equal(host.files["themes/Nord.toml"], HAND_THEME);
});

test("removing a theme file that shadows a built-in keeps the selection, which finds the built-in again", async () => {
  const { host, messages, startup, local } = await started({ "settings.toml": 'theme = "nord"\n', "themes/nord.toml": HAND_THEME });
  await startup.change_edits((current) => ({ ...current, temp: { theme: "nord" } }));
  assert.deepEqual(await messages.change(remove("nord")), { ok: true, message: "Removed the theme nord, and themes/nord.toml is deleted from the config folder." });
  assert.equal(host.files["themes/nord.toml"], undefined);
  assert.equal(host.files["settings.toml"], 'theme = "nord"\n');
  assert.deepEqual((await load_edits()).temp, { theme: "nord" });
  assert.equal((await startup.get_config()).settings.theme, "nord");
  assert.deepEqual(local[THEME_STORAGE_KEY], load_theme("nord", 3));
});

test("a settings.d file that picks a shadowed built-in does not refuse the file's removal", async () => {
  const { host, messages } = await started({ "settings.toml": "", "settings.d/look.toml": 'theme = "nord"\n', "themes/nord.toml": HAND_THEME });
  assert.equal((await messages.change(remove("nord"))).ok, true);
  assert.equal(host.files["themes/nord.toml"], undefined);
  assert.equal(host.files["settings.d/look.toml"], 'theme = "nord"\n');
});
