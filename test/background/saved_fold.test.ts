import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "smol-toml";
import "../../src/background/command_modules.ts";
import { build_files_config, ConfigRefusal } from "../../src/background/config_reload.ts";
import { fold_kept_notes, fold_moved_note, saved_layer_folded } from "../../src/background/saved_fold.ts";
import { FILES_SOURCE_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, SAVED_FOLD_NOTES_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import type { SettingOverrides } from "../../src/shared/config.ts";
import { answer_host_start_choice } from "../../src/background/host_start.ts";
import type { HostStartPending } from "../../src/shared/messages/page.ts";
import { install_fake_browser, type Files } from "./config_fake_browser.ts";
import { fresh_config_service, type ConfigService } from "./fresh_config_service.ts";

type Startup = ConfigService;

const problems_of = (files: Files): string[] => {
  try {
    build_files_config(files, "folder", [], "setting");
    return [];
  } catch (error) {
    if (!(error instanceof ConfigRefusal)) throw error;
    return error.problems.length > 0 ? error.problems : [error.message];
  }
};
const nothing_stays = () => false;
// Through JSON, as the parser gives objects without a prototype.
const settings_of = (files: Files) => JSON.parse(JSON.stringify(parse(files["settings.toml"] ?? ""))) as Record<string, unknown>;

const LINKS = [{ label: "Mail", url: "https://mail.test/" }];
// One saved value of each kind: number, boolean, text, list, `[[table]]` list, and a consent setting.
const SAVED: SettingOverrides = { which_key_delay_ms: 5, which_key_repeat: false, hint_letters: "qw", which_key_skip: ["g"], newtab_links: LINKS, newtab_ip_info: true };

test("the fold writes each kind into settings.toml, keeps its comments and leaves only the consent setting saved", () => {
  const files = { "settings.toml": "# mine\ntoast_ms = 900 # kept\n" };
  const fold = saved_layer_folded(SAVED, files, problems_of, nothing_stays);
  assert.deepEqual(fold.saved, { newtab_ip_info: true });
  assert.deepEqual(fold.moved, ["which_key_delay_ms", "which_key_repeat", "hint_letters", "which_key_skip", "newtab_links"]);
  assert.deepEqual(fold.held, []);
  assert.deepEqual(fold.refused, []);
  assert.match(fold.files["settings.toml"]!, /^# mine$/m);
  assert.match(fold.files["settings.toml"]!, /^toast_ms = 900 # kept$/m);
  assert.deepEqual(settings_of(fold.files), { toast_ms: 900, which_key_delay_ms: 5, which_key_repeat: false, hint_letters: "qw", which_key_skip: ["g"], newtab_links: LINKS });
  assert.equal(fold_moved_note(fold), "5 settings saved in the browser moved into settings.toml: which_key_delay_ms, which_key_repeat, hint_letters, which_key_skip, newtab_links.");
});

test("a saved value replaces the file's value, as it won over it before", () => {
  const fold = saved_layer_folded({ hint_letters: "qw" }, { "settings.toml": 'hint_letters = "as"\n' }, problems_of, nothing_stays);
  assert.equal(fold.files["settings.toml"], 'hint_letters = "qw"\n');
  assert.deepEqual(fold.saved, {});
});

test("a second fold of what the first left changes nothing", () => {
  const first = saved_layer_folded(SAVED, { "settings.toml": "" }, problems_of, nothing_stays);
  const second = saved_layer_folded(first.saved, first.files, problems_of, nothing_stays);
  assert.equal(second.files, first.files);
  assert.equal(second.saved, first.saved);
  assert.deepEqual(second.moved, []);
  assert.equal(fold_moved_note(second), undefined);
});

test("a name a settings.d file sets stays saved with one warning, and the rest moves", () => {
  const files = { "settings.toml": "", "settings.d/10-hints.toml": 'hint_letters = "zx"\nwhich_key_repeat = true\n' };
  const fold = saved_layer_folded(SAVED, files, problems_of, nothing_stays);
  assert.deepEqual(fold.saved, { which_key_repeat: false, hint_letters: "qw", newtab_ip_info: true });
  assert.deepEqual(fold.held, [
    { name: "which_key_repeat", file: "settings.d/10-hints.toml" },
    { name: "hint_letters", file: "settings.d/10-hints.toml" },
  ]);
  assert.equal(settings_of(fold.files).hint_letters, undefined);
  const notes = fold_kept_notes(fold);
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /which_key_repeat \(settings\.d\/10-hints\.toml\), hint_letters \(settings\.d\/10-hints\.toml\)/);
});

test("a value the files build refuses stays saved with its problem, and the others move", () => {
  const fold = saved_layer_folded({ theme: "no_such_theme", which_key_delay_ms: 5 }, { "settings.toml": "" }, problems_of, nothing_stays);
  assert.deepEqual(fold.saved, { theme: "no_such_theme" });
  assert.deepEqual(fold.moved, ["which_key_delay_ms"]);
  assert.equal(fold.refused.length, 1);
  assert.equal(fold.refused[0]!.name, "theme");
  assert.deepEqual(settings_of(fold.files), { which_key_delay_ms: 5 });
  assert.match(fold_kept_notes(fold)[0]!, /^The setting theme saved in the browser stays there, as the config refuses it in settings\.toml: .*no_such_theme.* Fix that, and the next start moves it\.$/);
});

test("a settings.toml that does not parse keeps every saved value", () => {
  const files = { "settings.toml": "hint_letters = \n" };
  const fold = saved_layer_folded({ which_key_delay_ms: 5 }, files, problems_of, nothing_stays);
  assert.equal(fold.files, files);
  assert.deepEqual(fold.saved, { which_key_delay_ms: 5 });
  assert.deepEqual(fold.refused.map((entry) => entry.name), ["which_key_delay_ms"]);
});

test("a name the caller keeps in the browser stays saved with no note", () => {
  const fold = saved_layer_folded({ default_engine: "layer_only", which_key_delay_ms: 5 }, { "settings.toml": "" }, problems_of, (name) => name === "default_engine");
  assert.deepEqual(fold.saved, { default_engine: "layer_only" });
  assert.deepEqual(fold_kept_notes(fold), []);
});

test("a saved site_rules list adds only the popup's off rows and kept-keys rows the file lacks", () => {
  const file_row = '[[site_rules]]\nsite = "*://a.test/*"\noff = true\n';
  const saved = {
    site_rules: [
      // A copy of the file's row from the popup's first write, edited in the file since.
      { site: "*://a.test/*", off: true },
      { site: "*://b.test/*", off: true },
      { site: "*://c.test/*", pass: "j k" },
      { site: "*://d.test/*", only: "f" },
    ],
  };
  const fold = saved_layer_folded(saved, { "settings.toml": file_row }, problems_of, nothing_stays);
  assert.deepEqual(fold.saved, {});
  assert.deepEqual(settings_of(fold.files).site_rules, [
    { site: "*://a.test/*", off: true },
    { site: "*://b.test/*", off: true },
    { site: "*://c.test/*", pass: "j k" },
  ]);
  assert.ok(fold.files["settings.toml"]!.startsWith(file_row));

  const nothing_new = saved_layer_folded({ site_rules: [{ site: "*://a.test/*", off: true }] }, { "settings.toml": file_row }, problems_of, nothing_stays);
  assert.equal(nothing_new.files["settings.toml"], file_row);
  assert.deepEqual(nothing_new.saved, {});
  assert.deepEqual(nothing_new.moved, ["site_rules"]);
});

test("a saved site_rules list folds into settings.toml under a settings.d site_rules file, skipping rows any file has", () => {
  const d_file = '[[site_rules]]\nsite = "*://b.test/*"\noff = true\n\n[[site_rules]]\nsite = "*://e.test/*"\npass = "x"\n';
  const files = { "settings.toml": '[[site_rules]]\nsite = "*://a.test/*"\noff = true\n', "settings.d/60-knack.toml": d_file };
  const saved = { site_rules: [{ site: "*://a.test/*", off: true }, { site: "*://b.test/*", off: true }, { site: "*://c.test/*", off: true }, { site: "*://e.test/*", pass: "x" }] };
  const fold = saved_layer_folded(saved, files, problems_of, nothing_stays);
  assert.deepEqual(fold.held, []);
  assert.deepEqual(fold.saved, {});
  assert.deepEqual(fold.moved, ["site_rules"]);
  assert.deepEqual(settings_of(fold.files).site_rules, [{ site: "*://a.test/*", off: true }, { site: "*://c.test/*", off: true }]);
  assert.equal(fold.files["settings.d/60-knack.toml"], d_file);
  assert.deepEqual(fold_kept_notes(fold), []);
});

test("a saved kept-keys row stays unless a file has the same keys for the site", () => {
  const files = { "settings.toml": "", "settings.d/60-knack.toml": '[[site_rules]]\nsite = "*://a.test/*"\npass = "j"\n\n[[site_rules]]\nsite = "*://b.test/*"\npass = "x"\n' };
  const saved = { site_rules: [{ site: "*://a.test/*", pass: "j k" }, { site: "*://b.test/*", pass: "x" }] };
  const fold = saved_layer_folded(saved, files, problems_of, nothing_stays);
  assert.deepEqual(settings_of(fold.files).site_rules, [{ site: "*://a.test/*", pass: "j k" }]);
});

test("running the fold again over its own result, as after a stop before the layer shrank, adds no row", () => {
  const files = { "settings.toml": "", "settings.d/60-knack.toml": '[[site_rules]]\nsite = "*://b.test/*"\noff = true\n' };
  const saved = { site_rules: [{ site: "*://b.test/*", off: true }, { site: "*://c.test/*", off: true }, { site: "*://d.test/*", pass: "j" }] };
  const once = saved_layer_folded(saved, files, problems_of, nothing_stays);
  const twice = saved_layer_folded(saved, once.files, problems_of, nothing_stays);
  assert.deepEqual(settings_of(once.files).site_rules, [{ site: "*://c.test/*", off: true }, { site: "*://d.test/*", pass: "j" }]);
  assert.deepEqual(twice.files, once.files);
});

function watch_toasts(fake: ReturnType<typeof install_fake_browser>["fake"]): string[] {
  const toasts: string[] = [];
  fake.tabs.query = async () => [{ id: 7 }];
  fake.tabs.sendMessage = (async (_tab: number, message: unknown) => {
    const sent = message as { type: string; refusal?: { message: string } };
    if (sent.type === "refusal") toasts.push(sent.refusal!.message);
    return undefined;
  }) as typeof fake.tabs.sendMessage;
  return toasts;
}

// A profile of an older version: it read the folder once through the host, and saved edits sit in storage. The next start is the first one of this version.
async function old_profile(saved: SettingOverrides, files: Files = { "settings.toml": "# mine\n" }) {
  const host: { files: Files; granted?: boolean; refuse?: string[] } = { files };
  const browser = install_fake_browser(host);
  const startup = fresh_config_service();
  await startup.get_config();
  await startup.reload_config();
  browser.local[SAVED_SETTINGS_STORAGE_KEY] = saved;
  return { host, toasts: watch_toasts(browser.fake), ...browser };
}

async function first_start() {
  const startup = fresh_config_service();
  await startup.reload_config_at_start();
  return startup;
}

const stored_files = (local: Record<string, unknown>) => (local[FILES_SOURCE_STORAGE_KEY] as { files: Files }).files;
const unsynced_of = (local: Record<string, unknown>) => local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] ?? undefined;
const settings_writes = (sent: { cmd: string; files?: { kind: string }[] }[]) => sent.filter((message) => message.cmd === "write_config_files" && (message.files ?? []).some((file) => file.kind === "settings")).length;
const warnings_of = (local: Record<string, unknown>) => local[WARNINGS_STORAGE_KEY] as string[];

test("the first start folds the saved settings into the folder's settings.toml in one storage write, says so once, and a second start writes nothing", async () => {
  const { host, local, session, sent, fake, toasts } = await old_profile(SAVED);
  const sets: Record<string, unknown>[] = [];
  const set = fake.storage.local.set;
  fake.storage.local.set = async (values: Record<string, unknown>) => {
    sets.push(values);
    return set(values);
  };
  sent.length = 0;
  const startup = await first_start();
  assert.ok(
    sets.some((values) => Object.hasOwn(values, SAVED_SETTINGS_STORAGE_KEY) && Object.hasOwn(values, FILES_SOURCE_STORAGE_KEY) && Object.hasOwn(values, SETTINGS_FILE_UNSYNCED_STORAGE_KEY)),
    "the smaller layer, the files and the record went in separate writes",
  );
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { newtab_ip_info: true });
  assert.equal(host.files["settings.toml"], stored_files(local)["settings.toml"]);
  assert.match(host.files["settings.toml"]!, /^# mine$/m);
  assert.deepEqual(settings_of(host.files), { which_key_delay_ms: 5, which_key_repeat: false, hint_letters: "qw", which_key_skip: ["g"], newtab_links: LINKS });
  assert.equal(settings_writes(sent), 1);
  assert.equal(unsynced_of(local), undefined);
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
  const { settings } = await startup.get_config();
  assert.equal(settings.which_key_delay_ms, 5);
  assert.equal(settings.newtab_ip_info, true);
  assert.deepEqual(toasts, ["5 settings saved in the browser moved into settings.toml: which_key_delay_ms, which_key_repeat, hint_letters, which_key_skip, newtab_links."]);
  assert.ok(warnings_of(local).includes(toasts[0]!), "the Home warnings lack the fold's note");

  sent.length = 0;
  toasts.length = 0;
  // A restart within the same browser session keeps the notes, as `storage.session` does.
  await first_start();
  assert.equal(settings_writes(sent), 0);
  assert.deepEqual(toasts, []);
  assert.equal(session[SAVED_FOLD_NOTES_STORAGE_KEY], undefined);
  assert.ok(!warnings_of(local).some((warning) => warning.includes("moved into settings.toml")), "the note outlived the start that moved");
});

test("without the host the saved settings stay in the layer, and the next start with the host moves them", async () => {
  const { host, local, toasts } = await old_profile({ which_key_delay_ms: 5 });
  host.granted = false;
  const startup = await first_start();
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { which_key_delay_ms: 5 });
  assert.equal(unsynced_of(local), undefined);
  assert.equal(stored_files(local)["settings.toml"], "# mine\n");
  assert.equal((await startup.get_config()).settings.which_key_delay_ms, 5);
  assert.deepEqual(toasts, []);

  host.granted = true;
  await first_start();
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  assert.equal(settings_of(host.files).which_key_delay_ms, 5);
  assert.equal(unsynced_of(local), undefined);
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("a host that refuses the write keeps the record and the smaller layer, and a later start writes the file", async () => {
  const { host, local } = await old_profile({ which_key_delay_ms: 5 });
  host.refuse = ["settings.toml"];
  const startup = await first_start();
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  assert.deepEqual(unsynced_of(local), { "settings.toml": "# mine\n" });
  assert.equal((await startup.get_config()).settings.which_key_delay_ms, 5);

  delete host.refuse;
  await first_start();
  assert.equal(settings_of(host.files).which_key_delay_ms, 5);
  assert.equal(unsynced_of(local), undefined);
});

test("a profile that never read a folder keeps the saved settings until a host shows one, then takes the folder and moves them with no question", async () => {
  const host: { files: Files; granted?: boolean } = { files: { "settings.toml": 'hint_letters = "xy"\n' }, granted: false };
  const browser = install_fake_browser(host);
  const toasts = watch_toasts(browser.fake);
  browser.local[SAVED_SETTINGS_STORAGE_KEY] = { which_key_delay_ms: 5, bridge: true };
  const startup = await first_start();
  assert.deepEqual(browser.local[SAVED_SETTINGS_STORAGE_KEY], { which_key_delay_ms: 5, bridge: true });
  assert.equal(browser.local[FILES_SOURCE_STORAGE_KEY], undefined);
  assert.equal((await startup.get_config()).settings.which_key_delay_ms, 5);

  host.granted = true;
  const later = await first_start();
  assert.equal(browser.local[HOST_START_PENDING_STORAGE_KEY], undefined);
  assert.deepEqual(browser.local[SAVED_SETTINGS_STORAGE_KEY], { bridge: true });
  assert.deepEqual(settings_of(host.files), { hint_letters: "xy", which_key_delay_ms: 5 });
  assert.deepEqual((await later.get_config()).settings, { hint_letters: "xy", which_key_delay_ms: 5, bridge: true });
  assert.deepEqual(toasts, ["1 setting saved in the browser moved into settings.toml: which_key_delay_ms."]);
});

test("while the copies-differ question waits the saved settings stay, Use the folder keeps them on top, and the next start moves them", async () => {
  const { host, local, toasts } = await old_profile({ which_key_delay_ms: 5 }, { "settings.toml": 'hint_letters = "ab"\n' });
  const seeded = fresh_config_service();
  await seeded.save_config_file("settings.toml", 'hint_letters = "typed"\n', 'hint_letters = "ab"\n');
  host.files = { "settings.toml": 'hint_letters = "xy"\n' };
  const startup = await first_start();
  const pending = local[HOST_START_PENDING_STORAGE_KEY] as HostStartPending | undefined;
  assert.ok(pending, "no question was stored");
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { which_key_delay_ms: 5 });
  assert.ok(!toasts.some((toast) => toast.includes("moved into settings.toml")), "the start moved settings while the question waited");

  const answered = await answer_host_start_choice({ type: "host_start_choice", choice: "use_folder", host_digest: pending.host_digest, browser_digest: pending.browser_digest }, startup.choose_host_start);
  assert.equal(answered.ok, true, answered.message);
  assert.deepEqual((await startup.get_config()).settings, { hint_letters: "xy", which_key_delay_ms: 5 });

  await first_start();
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  assert.deepEqual(settings_of(host.files), { hint_letters: "xy", which_key_delay_ms: 5 });
  assert.equal(local[HOST_START_PENDING_STORAGE_KEY], undefined);
});

test("an editor save that lands between the start read and the fold keeps the saved settings for a later start", async () => {
  const { host, local, fake } = await old_profile({ which_key_delay_ms: 5 }, { "settings.toml": "", "keymap.toml": "" });
  const old_host = host as typeof host & { old_host?: boolean };
  // A host from before the write verbs, so a fold's write waits and only the copy holds the values.
  old_host.old_host = true;
  const startup = fresh_config_service();
  let saved_by_editor: Promise<unknown> | undefined;
  const remove = fake.storage.local.remove;
  // The start read clears the question key in its own queue turn, so a save asked for then lands before the fold's turn.
  fake.storage.local.remove = async (key: string | string[]) => {
    if (saved_by_editor === undefined && [key].flat().includes(HOST_START_PENDING_STORAGE_KEY)) saved_by_editor = startup.save_config_file("keymap.toml", "# typed\n", "");
    return remove(key);
  };
  await startup.reload_config_at_start();
  assert.ok(saved_by_editor, "the start read never cleared the question");
  await saved_by_editor;
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { which_key_delay_ms: 5 });
  assert.equal(settings_of(stored_files(local)).which_key_delay_ms, undefined);
  assert.equal((await startup.get_config()).settings.which_key_delay_ms, 5);
});

test("changes queued during the fold land after it, so a :set of a folded name wins", async () => {
  const { host, local, fake } = await old_profile({ which_key_delay_ms: 5, hint_letters: "qw" });
  const startup = fresh_config_service();
  const queued: Promise<unknown>[] = [];
  const get = fake.storage.local.get;
  // The fold reads the question key alone first thing in its queue turn, so changes asked for then wait behind it.
  fake.storage.local.get = async (key?: string | string[]) => {
    if (queued.length === 0 && key === HOST_START_PENDING_STORAGE_KEY) {
      queued.push(startup.set_in_settings_file("which_key_delay_ms", 9), startup.set_in_settings_file("toast_ms", 900));
    }
    return get(key);
  };
  await startup.reload_config_at_start();
  assert.equal(queued.length, 2, "the fold never read the question key");
  for (const outcome of await Promise.all(queued)) assert.deepEqual(outcome, { kind: "written" });
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  assert.deepEqual(settings_of(host.files), { which_key_delay_ms: 9, hint_letters: "qw", toast_ms: 900 });
  assert.equal(stored_files(local)["settings.toml"], host.files["settings.toml"]);
  assert.equal((await startup.get_config()).settings.which_key_delay_ms, 9);
});

test("a saved value a settings.d file sets stays on top with a Home warning at every start and no toast", async () => {
  const { local, toasts } = await old_profile({ hint_letters: "qw", which_key_delay_ms: 5 }, { "settings.toml": "", "settings.d/10-hints.toml": 'hint_letters = "zx"\n' });
  const startup = await first_start();
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { hint_letters: "qw" });
  assert.equal((await startup.get_config()).settings.hint_letters, "qw");
  assert.equal(toasts.length, 1);
  const held = (warnings: string[]) => warnings.filter((warning) => warning.startsWith("Settings saved in the browser stay there"));
  assert.equal(held(warnings_of(local)).length, 1);

  toasts.length = 0;
  await first_start();
  assert.deepEqual(toasts, []);
  assert.equal(held(warnings_of(local)).length, 1);
});

test("a saved value the build refuses stays, warns and moves at the start after the file it needs arrives", async () => {
  const { host, local } = await old_profile({ theme: "dusk", which_key_delay_ms: 5 });
  const startup = await first_start();
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { theme: "dusk" });
  assert.ok(warnings_of(local).some((warning) => warning.startsWith("The setting theme saved in the browser stays there")));
  assert.equal((await startup.get_config()).settings.which_key_delay_ms, 5);

  host.files = { ...host.files, "themes/dusk.toml": readFileSync("themes/nord.toml", "utf8") };
  await startup.reload_config();
  await first_start();
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  assert.equal(settings_of(host.files).theme, "dusk");
  assert.ok(!warnings_of(local).some((warning) => warning.includes("saved in the browser stays there")));
});

test("a saved site_rules list under a settings.d site_rules file folds once: a second start leaves settings.toml as the first made it", async () => {
  const knack = '[[site_rules]]\nsite = "*://b.test/*"\noff = true\n';
  const { host, local, toasts } = await old_profile({ site_rules: [{ site: "*://b.test/*", off: true }, { site: "*://c.test/*", off: true }] }, { "settings.toml": "", "settings.d/60-knack.toml": knack });
  const startup = await first_start();
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  assert.deepEqual(settings_of(host.files).site_rules, [{ site: "*://c.test/*", off: true }]);
  assert.deepEqual(toasts, ["1 setting saved in the browser moved into settings.toml: site_rules."]);
  assert.deepEqual(JSON.parse(JSON.stringify((await startup.get_config()).settings.site_rules)), [{ site: "*://c.test/*", off: true }, { site: "*://b.test/*", off: true }]);
  assert.ok(!warnings_of(local).some((warning) => warning.includes("stay there") || warning.includes("stays there")));
  const after_first = host.files["settings.toml"];

  toasts.length = 0;
  await first_start();
  assert.equal(host.files["settings.toml"], after_first);
  assert.deepEqual(toasts, []);
});
