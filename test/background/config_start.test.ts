import assert from "node:assert/strict";
import "../../src/background/command_modules.ts";
import { test } from "node:test";
import { IMPORT_DIR_LABEL } from "../../src/background/config_import.ts";
import { FILES_CONFIG_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY, TEMP_SETTINGS_STORAGE_KEY } from "../../src/background/storage_keys.ts";
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

test("a start rereads files that changed while the browser was closed, and a saved edit stays on top", async () => {
  const host = { files: settings_file('hint_letters = "ab"\n') };
  install_fake_browser(host);
  const first = await fresh_startup("changed_first");
  await first.get_config();
  await first.reload_config();
  await first.change_edits((current) => ({ ...current, saved: { ...current.saved, which_key_delay_ms: 5 } }));

  host.files = settings_file('hint_letters = "xy"\n');
  const restarted = await fresh_startup("changed_second");
  await restarted.reload_config_at_start();
  assert.deepEqual((await restarted.get_config()).settings, { hint_letters: "xy", which_key_delay_ms: 5 });

  const third = await fresh_startup("changed_third");
  assert.equal((await third.get_config()).settings.hint_letters, "xy");
});

test("a start with the same files builds and publishes nothing", async () => {
  const host = { files: settings_file('hint_letters = "ab"\n') };
  const { local, fake, told } = install_fake_browser(host);
  await stored_run("same");
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
  install_fake_browser(host);
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
});

test("a :set issued while the start read applies waits for the swap and stays on top of it", async () => {
  const host = { files: settings_file('hint_letters = "old"\n') };
  const { fake } = install_fake_browser(host);
  await stored_run("race");
  host.files = settings_file('hint_letters = "ab"\n');
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

test("with a host present, the files on disk replace an imported config at the next start", async () => {
  const host = { files: settings_file('hint_letters = "disk"\n') };
  const { local } = install_fake_browser(host);
  await stored_run("import");
  local[FILES_SOURCE_STORAGE_KEY] = { files: settings_file('hint_letters = "imported"\n'), dir_label: IMPORT_DIR_LABEL };
  const restarted = await fresh_startup("import_restart");
  await restarted.reload_config_at_start();
  assert.equal((await restarted.get_config()).settings.hint_letters, "disk");
  assert.deepEqual((local[FILES_SOURCE_STORAGE_KEY] as { files: Files }).files, host.files);
});

test("no host or no permission keeps the stored config and stays silent", async () => {
  for (const failure of ["no_host", "no_permission"]) {
    const host: { files: Files; granted: boolean; reply?: () => Promise<unknown> } = { files: settings_file('hint_letters = "ab"\n'), granted: true };
    const { fake, sent } = install_fake_browser(host);
    await stored_run(failure);
    host.files = settings_file('hint_letters = "xy"\n');
    if (failure === "no_permission") host.granted = false;
    if (failure === "no_host") host.reply = async () => Promise.reject(new Error("No such native application org.desertfox.host"));
    const toasts = watch_toasts(fake);
    sent.length = 0;
    const restarted = await fresh_startup(`${failure}_restart`);
    await restarted.reload_config_at_start();
    assert.equal(sent.length, failure === "no_host" ? 1 : 0);
    assert.equal((await restarted.get_config()).settings.hint_letters, "ab");
    assert.deepEqual(toasts, []);
  }
});

test("a missing config folder keeps the stored config and a toast names the folder", async () => {
  const host: { files: Files; reply?: () => Promise<unknown> } = { files: settings_file('hint_letters = "ab"\n') };
  const { fake } = install_fake_browser(host);
  await stored_run("no_dir");
  host.reply = async () => ({ ok: true, config_dir: "/home/u/.config/desertfox", config_dir_exists: false, files: {} });
  const toasts = watch_toasts(fake);
  const restarted = await fresh_startup("no_dir_restart");
  await restarted.reload_config_at_start();
  assert.equal((await restarted.get_config()).settings.hint_letters, "ab");
  assert.equal(toasts.length, 1);
  assert.match(toasts[0]!, /no config folder at \/home\/u\/\.config\/desertfox/);
});

test("a broken settings.toml keeps the stored config and a toast names the error, on every start", async () => {
  const host = { files: settings_file('hint_letters = "ab"\n') };
  const { fake, local } = install_fake_browser(host);
  await stored_run("broken");
  host.files = settings_file("hint_letters = \n");
  const stored_before = structuredClone(local[FILES_CONFIG_STORAGE_KEY]);
  for (const round of ["one", "two"]) {
    const toasts = watch_toasts(fake);
    const restarted = await fresh_startup(`broken_${round}`);
    await restarted.reload_config_at_start();
    assert.equal((await restarted.get_config()).settings.hint_letters, "ab");
    assert.deepEqual(local[FILES_CONFIG_STORAGE_KEY], stored_before);
    assert.equal(toasts.length, 1);
    assert.match(toasts[0]!, /Config not reloaded, the current one stays\..*settings\.toml/);
  }
});
