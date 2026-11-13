import assert from "node:assert/strict";
import "../../src/background/command_modules.ts";
import { test } from "node:test";
import { IMPORT_DIR_LABEL } from "../../src/background/config_import.ts";
import { FILES_CONFIG_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY, HOST_START_APPLIED_STORAGE_KEY, HOST_START_KEPT_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { answer_host_start_choice, CHOICE_SETTLED, CHOICE_STALE } from "../../src/background/host_start.ts";
import type { HostStartChoice, HostStartPending } from "../../src/shared/messages.ts";
import { install_fake_browser, type Files } from "./config_fake_browser.ts";

type Startup = typeof import("../../src/background/startup.ts");
const fresh_startup = async (tag: string) => (await import(`../../src/background/startup.ts?start_${tag}`)) as Startup;
const settings_file = (body: string): Files => ({ "settings.toml": body });

// The stored build a previous run left behind: a reload on the given files, then the modules are dropped.
async function stored_run(tag: string): Promise<void> {
  const startup = await fresh_startup(`${tag}_seed`);
  await startup.get_config();
  await startup.reload_config();
}

function watch_toasts(fake: ReturnType<typeof install_fake_browser>["fake"]): string[] {
  const toasts: string[] = [];
  fake.tabs.query = async () => [{ id: 7 }];
  fake.tabs.sendMessage = (async (_tab: number, message: unknown) => {
    if ((message as { type: string }).type === "refusal") toasts.push(JSON.stringify(message));
    return undefined;
  }) as typeof fake.tabs.sendMessage;
  return toasts;
}

const pending_of = (local: Record<string, unknown>) => local[HOST_START_PENDING_STORAGE_KEY] as HostStartPending | undefined;

// The page's answer to the stored question, through the same function the background's message listener calls.
function answer(startup: Startup, choice: HostStartChoice["choice"], seen: HostStartPending | undefined) {
  assert.ok(seen, "a question is pending");
  return answer_host_start_choice({ type: "host_start_choice", choice, host_digest: seen.host_digest, browser_digest: seen.browser_digest }, startup.choose_host_start);
}

test("a start applies a changed folder at once while the browser copy holds no browser change, and a saved edit stays on top", async () => {
  const host = { files: settings_file('hint_letters = "ab"\n') };
  const { local, fake } = install_fake_browser(host);
  const first = await fresh_startup("changed_first");
  await first.get_config();
  await first.reload_config();
  await first.change_edits((current) => ({ ...current, saved: { ...current.saved, which_key_delay_ms: 5 } }));

  host.files = settings_file('hint_letters = "xy"\n');
  const toasts = watch_toasts(fake);
  const restarted = await fresh_startup("changed_second");
  await restarted.reload_config_at_start();
  assert.deepEqual((await restarted.get_config()).settings, { hint_letters: "xy", which_key_delay_ms: 5 });
  assert.equal(pending_of(local), undefined);
  assert.deepEqual(toasts, []);

  // The start that applied it remembers it too, so the next folder edit applies as well.
  host.files = settings_file('hint_letters = "zx"\n');
  const third = await fresh_startup("changed_third");
  await third.reload_config_at_start();
  assert.equal((await third.get_config()).settings.hint_letters, "zx");
  assert.equal(pending_of(local), undefined);
});

test("a start with a changed folder asks when an editor save changed the browser copy, and using the folder keeps a saved edit on top", async () => {
  const host = { files: settings_file('hint_letters = "ab"\n') };
  const { local, fake } = install_fake_browser(host);
  const first = await fresh_startup("edited_first");
  await first.get_config();
  await first.reload_config();
  await first.change_edits((current) => ({ ...current, saved: { ...current.saved, which_key_delay_ms: 5 } }));
  await first.save_config_file("settings.toml", 'hint_letters = "typed"\n', 'hint_letters = "ab"\n');

  host.files = settings_file('hint_letters = "xy"\n');
  const toasts = watch_toasts(fake);
  const restarted = await fresh_startup("edited_second");
  await restarted.reload_config_at_start();
  assert.deepEqual((await restarted.get_config()).settings, { hint_letters: "typed", which_key_delay_ms: 5 });
  assert.deepEqual(pending_of(local)?.changes, [{ path: "settings.toml", kind: "replaced" }]);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0]!, /differs.*Settings page/);

  const answered = await answer(restarted, "use_folder", pending_of(local));
  assert.equal(answered.ok, true, answered.message);
  assert.deepEqual((await restarted.get_config()).settings, { hint_letters: "xy", which_key_delay_ms: 5 });
  assert.equal(pending_of(local), undefined);

  // Using the folder counts as a read from the host: the next folder edit applies at once.
  host.files = settings_file('hint_letters = "zx"\n');
  const third = await fresh_startup("edited_third");
  await third.reload_config_at_start();
  assert.equal((await third.get_config()).settings.hint_letters, "zx");
  assert.equal(pending_of(local), undefined);
});

test("a profile from before the applied digest asks once, and a start that finds the folder equal remembers it", async () => {
  const host = { files: settings_file('hint_letters = "ab"\n') };
  const { local } = install_fake_browser(host);
  await stored_run("upgrade");
  delete local[HOST_START_APPLIED_STORAGE_KEY];
  host.files = settings_file('hint_letters = "xy"\n');
  const asked = await fresh_startup("upgrade_asked");
  await asked.reload_config_at_start();
  assert.equal((await asked.get_config()).settings.hint_letters, "ab");
  assert.notEqual(pending_of(local), undefined);

  delete local[HOST_START_PENDING_STORAGE_KEY];
  host.files = settings_file('hint_letters = "ab"\n');
  const seeded = await fresh_startup("upgrade_seeded");
  await seeded.reload_config_at_start();
  assert.equal(typeof local[HOST_START_APPLIED_STORAGE_KEY], "string");
  host.files = settings_file('hint_letters = "xy"\n');
  const followed = await fresh_startup("upgrade_followed");
  await followed.reload_config_at_start();
  assert.equal((await followed.get_config()).settings.hint_letters, "xy");
  assert.equal(pending_of(local), undefined);
});

test("a start with the same files builds and publishes nothing, whatever autoconfig.toml and the stored label say", async () => {
  const host = { files: { ...settings_file('hint_letters = "ab"\n'), "autoconfig.toml": "# old mirror\n" } };
  const { local, fake, told } = install_fake_browser(host);
  await stored_run("same");
  // An editor save leaves the label empty and the host rewrites autoconfig.toml on every saved `:set`: neither is a difference.
  local[FILES_SOURCE_STORAGE_KEY] = { files: settings_file('hint_letters = "ab"\n'), dir_label: "" };
  host.files = { ...settings_file('hint_letters = "ab"\n'), "autoconfig.toml": "# new mirror\n" };
  const restarted = await fresh_startup("same_restart");
  // The start's own publish has run. Only a rebuild from the host files would write again.
  await restarted.get_config();
  const stored_before = structuredClone(local);
  const set_calls: string[][] = [];
  const working = fake.storage.local.set;
  fake.storage.local.set = async (values) => {
    set_calls.push(Object.keys(values));
    return working(values);
  };
  told.length = 0;
  await restarted.reload_config_at_start();
  assert.deepEqual(set_calls, []);
  assert.deepEqual(told, []);
  assert.deepEqual(local, stored_before);
});

test("a first start with no stored files and a filled config folder takes the files", async () => {
  const host = { files: settings_file('hint_letters = "ab"\n') };
  install_fake_browser(host);
  const startup = await fresh_startup("first");
  await startup.reload_config_at_start();
  assert.equal((await startup.get_config()).settings.hint_letters, "ab");
});

// The first read after `arm` waits for `release`. Every later read, a reload for example, answers at once.
function gate_host_reads(host: { reply?: () => Promise<unknown> }, files_when_released: Files) {
  let armed = false;
  let release!: () => void;
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => (reached = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  const reply = (files: Files) => ({ ok: true, config_dir: "/home/u/.config/desertfox", config_dir_exists: true, files });
  host.reply = async () => {
    if (!armed) return reply(files_when_released);
    armed = false;
    reached();
    await gate;
    return reply(files_when_released);
  };
  return { arm: () => void (armed = true), waiting, release };
}

test("an older start reply never overwrites a reload that committed while the host was answering", async () => {
  const host: { files: Files; reply?: () => Promise<unknown> } = { files: settings_file('hint_letters = "old"\n') };
  const { local } = install_fake_browser(host);
  await stored_run("stale");
  const startup = await fresh_startup("stale_restart");
  await startup.get_config();
  const gate = gate_host_reads(host, settings_file('hint_letters = "stale"\n'));
  gate.arm();
  const start = startup.reload_config_at_start();
  await gate.waiting;
  host.files = settings_file('hint_letters = "new"\n');
  host.reply = async () => ({ ok: true, config_dir: "/home/u/.config/desertfox", config_dir_exists: true, files: host.files });
  await startup.reload_config();
  gate.release();
  await start;
  assert.equal((await startup.get_config()).settings.hint_letters, "new");
  assert.equal(pending_of(local), undefined);
});

test("a :set issued while the start adopts the folder waits for the swap and stays on top of it", async () => {
  const host = { files: settings_file('hint_letters = "ab"\n') };
  const { fake } = install_fake_browser(host);
  const startup = await fresh_startup("race_restart");
  await startup.get_config();
  let swap_started!: () => void;
  const swap_is_writing = new Promise<void>((resolve) => (swap_started = resolve));
  const working = fake.storage.local.set;
  fake.storage.local.set = async (values) => {
    if (FILES_CONFIG_STORAGE_KEY in values) {
      swap_started();
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return working(values);
  };
  const finished: string[] = [];
  const start = startup.reload_config_at_start().then(() => finished.push("start"));
  await swap_is_writing;
  const set = startup.change_edits((current) => ({ ...current, temp: { ...current.temp, which_key_delay_ms: 9 } })).then(() => finished.push("set"));
  await Promise.all([start, set]);
  assert.deepEqual(finished, ["start", "set"]);
  assert.deepEqual((await startup.get_config()).settings, { hint_letters: "ab", which_key_delay_ms: 9 });
});

// The browser copy a previous run left: `files` imported over a folder that held `host.files`.
async function imported_run(tag: string, local: Record<string, unknown>, files: Files): Promise<void> {
  await stored_run(tag);
  const seeded = await fresh_startup(`${tag}_import`);
  await seeded.import_config({ kind: "folder", entries: Object.entries(files).map(([path, text]) => ({ path, text })) }, {});
  assert.equal((local[FILES_SOURCE_STORAGE_KEY] as { dir_label: string }).dir_label, IMPORT_DIR_LABEL);
}

test("a folder that differs from an imported config replaces nothing at start and names each file it would change", async () => {
  const host = { files: { ...settings_file('hint_letters = "disk"\n'), "quickmarks.toml": "" } };
  const { local } = install_fake_browser(host);
  await imported_run("import", local, { ...settings_file('hint_letters = "imported"\n'), "command_aliases.toml": "" });
  const restarted = await fresh_startup("import_restart");
  await restarted.reload_config_at_start();
  assert.equal((await restarted.get_config()).settings.hint_letters, "imported");
  assert.deepEqual(pending_of(local)?.changes, [
    { path: "command_aliases.toml", kind: "removed" },
    { path: "quickmarks.toml", kind: "added" },
    { path: "settings.toml", kind: "replaced" },
  ]);
  assert.equal(pending_of(local)?.config_dir, "/home/u/.config/desertfox");
});

test("keeping the browser copy stays quiet at the next start, and a later change in the folder asks again", async () => {
  const host = { files: settings_file('hint_letters = "disk"\n') };
  const { local, fake } = install_fake_browser(host);
  await imported_run("keep", local, settings_file('hint_letters = "mine"\n'));
  const first = await fresh_startup("keep_first");
  await first.reload_config_at_start();
  const answered = await answer(first, "keep_browser", pending_of(local));
  assert.equal(answered.ok, true, answered.message);
  assert.equal(pending_of(local), undefined);
  assert.equal(typeof local[HOST_START_KEPT_STORAGE_KEY], "string");

  const toasts = watch_toasts(fake);
  const second = await fresh_startup("keep_second");
  await second.reload_config_at_start();
  assert.equal(pending_of(local), undefined);
  assert.deepEqual(toasts, []);
  assert.equal((await second.get_config()).settings.hint_letters, "mine");

  host.files = settings_file('hint_letters = "disk2"\n');
  const third = await fresh_startup("keep_third");
  await third.reload_config_at_start();
  assert.notEqual(pending_of(local), undefined);
  assert.equal(toasts.length, 1);
  assert.equal((await third.get_config()).settings.hint_letters, "mine");
  assert.equal((await answer(third, "use_folder", pending_of(local))).ok, true);
  assert.equal(local[HOST_START_KEPT_STORAGE_KEY], undefined);
});

test("after the folder changed, keeping is refused and asked again, and using the folder takes the folder as it is now", async () => {
  const host = { files: settings_file('hint_letters = "disk"\n') };
  const { local } = install_fake_browser(host);
  await imported_run("folder_moved", local, settings_file('hint_letters = "mine"\n'));
  const startup = await fresh_startup("folder_moved_start");
  await startup.reload_config_at_start();
  const seen = pending_of(local);
  // The user unpacked the export into the folder after the banner showed.
  host.files = settings_file('hint_letters = "disk2"\n');
  const kept = await answer(startup, "keep_browser", seen);
  assert.deepEqual(kept, { ok: false, message: CHOICE_STALE });
  assert.equal((await startup.get_config()).settings.hint_letters, "mine");
  assert.notEqual(pending_of(local)?.host_digest, seen?.host_digest);
  assert.equal(pending_of(local)?.browser_digest, seen?.browser_digest);
  assert.equal((await answer(startup, "use_folder", seen)).ok, true);
  assert.equal((await startup.get_config()).settings.hint_letters, "disk2");
  assert.equal(pending_of(local), undefined);
});

test("an editor save, an import or a reload while the question is pending clears it, and the old answer is refused", async () => {
  for (const change of ["save", "import", "reload"] as const) {
    const host = { files: settings_file('hint_letters = "disk"\n') };
    const { local } = install_fake_browser(host);
    await imported_run(`pending_${change}`, local, settings_file('hint_letters = "mine"\n'));
    const startup = await fresh_startup(`pending_${change}_start`);
    await startup.reload_config_at_start();
    const seen = pending_of(local);
    assert.ok(seen);
    if (change === "save") await startup.save_config_file("settings.toml", 'hint_letters = "typed"\n', 'hint_letters = "mine"\n');
    if (change === "import") await startup.import_config({ kind: "folder", entries: [{ path: "settings.toml", text: 'hint_letters = "zip"\n' }] }, {});
    if (change === "reload") await startup.reload_config();
    assert.equal(pending_of(local), undefined, change);
    const answered = await answer(startup, "use_folder", seen);
    assert.equal(answered.ok, false, change);
    assert.equal(answered.message, change === "reload" ? CHOICE_SETTLED : CHOICE_STALE, change);
    const expected = { save: "typed", import: "zip", reload: "disk" }[change];
    assert.equal((await startup.get_config()).settings.hint_letters, expected, change);
  }
});

test("a restart before the answer asks again with the same digests, and the old page's answer still applies", async () => {
  const host = { files: settings_file('hint_letters = "disk"\n') };
  const { local } = install_fake_browser(host);
  await imported_run("restart_pending", local, settings_file('hint_letters = "mine"\n'));
  const first = await fresh_startup("restart_pending_first");
  await first.reload_config_at_start();
  const seen = pending_of(local);
  const restarted = await fresh_startup("restart_pending_second");
  // The stored question shows before the host answers.
  assert.deepEqual(pending_of(local), seen);
  await restarted.reload_config_at_start();
  assert.deepEqual(pending_of(local), seen);
  assert.equal((await answer(restarted, "use_folder", seen)).ok, true);
  assert.equal((await restarted.get_config()).settings.hint_letters, "disk");
});

test("two pages answering at once: the first answer wins and the second is told it is settled", async () => {
  for (const [first_choice, second_choice] of [["use_folder", "use_folder"], ["keep_browser", "use_folder"], ["use_folder", "keep_browser"]] as const) {
    const host = { files: settings_file('hint_letters = "disk"\n') };
    const { local } = install_fake_browser(host);
    await imported_run(`two_${first_choice}_${second_choice}`, local, settings_file('hint_letters = "mine"\n'));
    const startup = await fresh_startup(`two_${first_choice}_${second_choice}_start`);
    await startup.reload_config_at_start();
    const seen = pending_of(local);
    const [first, second] = await Promise.all([answer(startup, first_choice, seen), answer(startup, second_choice, seen)]);
    assert.equal(first.ok, true, first.message);
    assert.deepEqual(second, { ok: false, message: CHOICE_SETTLED });
    assert.equal((await startup.get_config()).settings.hint_letters, first_choice === "use_folder" ? "disk" : "mine");
    assert.equal(pending_of(local), undefined);
  }
});

test("using a folder that does not build keeps the browser copy and the question, and lists every problem", async () => {
  const host = { files: settings_file('hint_letters = "disk"\n') };
  const { local } = install_fake_browser(host);
  await imported_run("broken_choice", local, settings_file('hint_letters = "mine"\n'));
  host.files = settings_file("hint_letters = \n");
  const startup = await fresh_startup("broken_choice_start");
  await startup.reload_config_at_start();
  const seen = pending_of(local);
  const answered = await answer(startup, "use_folder", seen);
  assert.equal(answered.ok, false);
  assert.ok(!answered.ok && answered.problems && answered.problems.length > 0);
  assert.equal((await startup.get_config()).settings.hint_letters, "mine");
  assert.deepEqual(pending_of(local), seen);
});

test("a choice the page did not send in full is refused before anything runs", async () => {
  install_fake_browser({ files: {} });
  const startup = await fresh_startup("bad_choice");
  const answered = await answer_host_start_choice({ type: "host_start_choice", choice: "delete" as never, host_digest: "a", browser_digest: "b" }, startup.choose_host_start);
  assert.equal(answered.ok, false);
});

test("an empty folder, or one holding only autoconfig.toml, never replaces the browser copy, filled or empty", async () => {
  for (const folder of [{}, { "autoconfig.toml": "[settings]\n" }]) {
    for (const browser_filled of [true, false]) {
      const host: { files: Files } = { files: settings_file('hint_letters = "mine"\n') };
      const { local, fake } = install_fake_browser(host);
      if (browser_filled) await stored_run(`empty_${Object.keys(folder).length}`);
      const files_before = structuredClone(local[FILES_SOURCE_STORAGE_KEY]);
      host.files = folder;
      const toasts = watch_toasts(fake);
      const restarted = await fresh_startup(`empty_${Object.keys(folder).length}_${browser_filled}`);
      await restarted.reload_config_at_start();
      assert.equal((await restarted.get_config()).settings.hint_letters, browser_filled ? "mine" : undefined);
      assert.deepEqual(local[FILES_SOURCE_STORAGE_KEY], files_before);
      assert.equal(pending_of(local), undefined);
      assert.deepEqual(toasts, []);
      // The explicit command refuses the same folder.
      await assert.rejects(restarted.reload_config(), /no config files in/);
    }
  }
});

test("a host that connects after the start asks nothing then, and the next start asks", async () => {
  const host: { files: Files; reply?: () => Promise<unknown> } = { files: settings_file('hint_letters = "disk"\n') };
  const { local } = install_fake_browser(host);
  await imported_run("late", local, settings_file('hint_letters = "mine"\n'));
  host.reply = async () => Promise.reject(new Error("No such native application org.desertfox.host"));
  const early = await fresh_startup("late_early");
  await early.reload_config_at_start();
  assert.equal(pending_of(local), undefined);
  assert.equal((await early.get_config()).settings.hint_letters, "mine");
  delete host.reply;
  const later = await fresh_startup("late_later");
  await later.reload_config_at_start();
  assert.notEqual(pending_of(local), undefined);
  assert.equal((await later.get_config()).settings.hint_letters, "mine");
});

test("no host or no permission keeps the stored config and stays silent", async () => {
  for (const failure of ["no_host", "no_permission"]) {
    const host: { files: Files; granted: boolean; reply?: () => Promise<unknown> } = { files: settings_file('hint_letters = "ab"\n'), granted: true };
    const { fake, sent, local } = install_fake_browser(host);
    await stored_run(failure);
    host.files = settings_file('hint_letters = "xy"\n');
    if (failure === "no_permission") host.granted = false;
    if (failure === "no_host") host.reply = async () => Promise.reject(new Error("No such native application org.desertfox.host"));
    const toasts = watch_toasts(fake);
    sent.length = 0;
    // A question from an earlier start cannot be answered without the host.
    local[HOST_START_PENDING_STORAGE_KEY] = { config_dir: "/c", host_digest: "h", browser_digest: "b", changes: [] };
    const restarted = await fresh_startup(`${failure}_restart`);
    await restarted.reload_config_at_start();
    assert.equal(sent.length, failure === "no_host" ? 1 : 0);
    assert.equal(pending_of(local), undefined);
    assert.equal((await restarted.get_config()).settings.hint_letters, "ab");
    assert.deepEqual(toasts, []);
  }
});

test("a missing config folder keeps the stored config and stays silent", async () => {
  const host: { files: Files; reply?: () => Promise<unknown> } = { files: settings_file('hint_letters = "ab"\n') };
  const { fake } = install_fake_browser(host);
  await stored_run("no_dir");
  host.reply = async () => ({ ok: true, config_dir: "/home/u/.config/desertfox", config_dir_exists: false, files: {} });
  const toasts = watch_toasts(fake);
  const restarted = await fresh_startup("no_dir_restart");
  await restarted.reload_config_at_start();
  assert.equal((await restarted.get_config()).settings.hint_letters, "ab");
  assert.deepEqual(toasts, []);
});

test("a broken settings.toml adopted into an empty browser copy keeps the stored config and a toast names the error, on every start", async () => {
  const host = { files: settings_file("hint_letters = \n") };
  const { fake, local } = install_fake_browser(host);
  const stored_before = structuredClone(local[FILES_CONFIG_STORAGE_KEY]);
  for (const round of ["one", "two"]) {
    const toasts = watch_toasts(fake);
    const restarted = await fresh_startup(`broken_${round}`);
    await restarted.reload_config_at_start();
    assert.equal((await restarted.get_config()).settings.hint_letters, undefined);
    assert.deepEqual(local[FILES_CONFIG_STORAGE_KEY], stored_before);
    assert.equal(toasts.length, 1);
    assert.match(toasts[0]!, /Config not reloaded, the current one stays\..*settings\.toml/);
  }
});
