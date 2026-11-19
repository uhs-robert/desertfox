import assert from "node:assert/strict";
import "../../src/background/command_modules.ts";
import { test } from "node:test";
import { create_settings_messages } from "../../src/background/settings_message.ts";
import { is_extension_page } from "../../src/background/extension_page.ts";
import { CONFIG_FORMAT_VERSION } from "../../src/shared/config.ts";
import { FILES_CONFIG_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, TEMP_SETTINGS_STORAGE_KEY } from "../../src/background/storage_keys.ts";

// A browser that keeps storage in memory. `fail_session_writes` makes the temp layer's writes throw, after the saved layer's write has landed.
function install_fake_browser(file_settings: Record<string, unknown>) {
  const local: Record<string, unknown> = { [FILES_CONFIG_STORAGE_KEY]: { config: { format_version: CONFIG_FORMAT_VERSION, settings: file_settings }, warnings: [] } };
  const session: Record<string, unknown> = {};
  const state = { fail_session_writes: 0 };
  const area = (store: Record<string, unknown>, before_set?: () => void | Promise<void>) => ({
    get: async (key?: string | string[]) => {
      const keys = key === undefined ? Object.keys(store) : [key].flat();
      return Object.fromEntries(keys.filter((name) => name in store).map((name) => [name, structuredClone(store[name])]));
    },
    set: async (values: Record<string, unknown>) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      await before_set?.();
      Object.assign(store, structuredClone(values));
    },
  });
  Object.assign(globalThis, {
    browser: {
      runtime: { id: "test@desertfox" },
      // No native permission, so the autoconfig mirror stays quiet and writes nothing.
      permissions: { contains: async () => false },
      storage: {
        local: area(local),
        session: area(session, async () => {
          if (state.fail_session_writes > 0) {
            state.fail_session_writes--;
            // A window in which the saved layer holds the new value and the write has not failed yet.
            await new Promise((resolve) => setTimeout(resolve, 20));
            throw new Error("session storage down");
          }
        }),
      },
      tabs: { query: async () => [], sendMessage: async () => undefined },
      contextualIdentities: { query: async () => [] },
      commands: { update: async () => undefined, reset: async () => undefined },
    },
  });
  return { local, session, state };
}

async function make(file_settings: Record<string, unknown> = {}) {
  const fake = install_fake_browser(file_settings);
  const startup = (await import(`../../src/background/startup.ts?settings_message_${Math.random()}`)) as typeof import("../../src/background/startup.ts");
  await startup.get_config();
  return { ...fake, startup, messages: create_settings_messages({ change_edits: startup.change_edits, read_layers: startup.read_settings_layers, read_theme_names: async () => Object.keys((await startup.get_config()).local_themes ?? {}), set_in_file: startup.set_in_settings_file, unset_in_file: startup.unset_in_settings_file }) };
}

test("a save of a consent setting stores the typed value, and the reply names the value and its top layer", async () => {
  const { messages, local, startup } = await make();
  const answer = await messages.change({ type: "change_setting", name: "newtab_ip_info", action: "set", value: true });
  assert.ok(answer.ok);
  assert.equal(answer.setting.value, true);
  assert.equal(answer.setting.top_layer, "saved");
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { newtab_ip_info: true });
  assert.equal((await startup.get_config()).settings.newtab_ip_info, true);
});

test("a save of any other setting without the file layer is refused, and the saved layer stays as it was", async () => {
  const { messages, local, session } = await make();
  for (const [name, value] of [["newtab_clock", "analog"], ["light_intensity", 3], ["newtab_links", [{ label: "Mail", url: "https://mail.test/" }]], ["site_rules", [{ site: "a.test", off: true }]]] as const) {
    const answer = await messages.change({ type: "change_setting", name, action: "set", value });
    assert.deepEqual(answer, { ok: false, message: `${name} is not kept in the browser. Only the consent settings are.` });
  }
  assert.equal(local[SAVED_SETTINGS_STORAGE_KEY], undefined);
  assert.equal(session[TEMP_SETTINGS_STORAGE_KEY], undefined);
});

test("typed values keep their type: a boolean and a number are stored as sent", async () => {
  const { messages, local, session } = await make();
  await messages.change({ type: "change_setting", name: "bridge", action: "set", value: false });
  await messages.change({ type: "change_setting", name: "light_intensity", action: "set", value: 3, layer: "temp" });
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { bridge: false });
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], { light_intensity: 3 });
});

test("temp sets the temp layer, and a later save drops it", async () => {
  const { messages, local, session } = await make({ bridge: false });
  const temp = await messages.change({ type: "change_setting", name: "bridge", action: "set", value: true, layer: "temp" });
  assert.ok(temp.ok);
  assert.equal(temp.setting.top_layer, "temp");
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], { bridge: true });
  const saved = await messages.change({ type: "change_setting", name: "bridge", action: "set", value: false });
  assert.ok(saved.ok);
  assert.equal(saved.setting.top_layer, "saved");
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], {});
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { bridge: false });
});

test("reset drops a saved value an older version left and the temp edit, and shows the file value", async () => {
  const { messages, local, session } = await make({ hint_letters: "ab" });
  local[SAVED_SETTINGS_STORAGE_KEY] = { hint_letters: "zx" };
  await messages.change({ type: "change_setting", name: "hint_letters", action: "set", value: "qw", layer: "temp" });
  const answer = await messages.change({ type: "change_setting", name: "hint_letters", action: "reset" });
  assert.ok(answer.ok);
  assert.equal(answer.setting.value, "ab");
  assert.equal(answer.setting.top_layer, "settings.toml");
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], {});
});

test("a value that fails the setting's check stores nothing", async () => {
  const { messages, local, session } = await make();
  for (const [name, value] of [["light_intensity", 9], ["newtab_clock", "sundial"], ["which_key_delay_ms", "5"], ["next_patterns", ["a.com", ""]]] as const) {
    const answer = await messages.change({ type: "change_setting", name, action: "set", value });
    assert.equal(answer.ok, false, name);
  }
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], undefined);
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], undefined);
  const answer = await messages.change({ type: "change_setting", name: "light_intensity", action: "set", value: 9 });
  assert.deepEqual(answer, { ok: false, message: "light_intensity: expected a whole number from 1 to 5" });
});

test("the settings that :set refuses get the text :set gives, and unknown names are refused", async () => {
  const { messages, local } = await make();
  for (const name of ["search_prefixes", "container_prefixes"]) {
    const set = await messages.change({ type: "change_setting", name, action: "set", value: [] });
    const reset = await messages.change({ type: "change_setting", name, action: "reset" });
    assert.equal(set.ok, false);
    assert.match(set.message, new RegExp(`^name expects one of .*, got "${name}"$`));
    assert.equal(reset.ok, false);
    assert.match(reset.message, new RegExp(`got "${name}"$`));
  }
  assert.equal((await messages.change({ type: "change_setting", name: "nope", action: "set", value: 1 })).ok, false);
  assert.equal(local[SAVED_SETTINGS_STORAGE_KEY], undefined);
});

test("changes that arrive together all land, each on what the others wrote", async () => {
  const { messages, local } = await make();
  const answers = await Promise.all([
    messages.change({ type: "change_setting", name: "bridge", action: "set", value: true }),
    messages.change({ type: "change_setting", name: "newtab_ip_info", action: "set", value: true }),
    messages.change({ type: "change_setting", name: "host_auto_update", action: "set", value: true }),
  ]);
  assert.ok(answers.every((answer) => answer.ok));
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { bridge: true, newtab_ip_info: true, host_auto_update: true });
});

test("a failed write puts both layers back and the reply is a failure, not a rejection", async () => {
  const { messages, local, session, state } = await make();
  await messages.change({ type: "change_setting", name: "newtab_ip_info", action: "set", value: true });
  await messages.change({ type: "change_setting", name: "bridge", action: "set", value: false, layer: "temp" });
  // The saved layer's write lands, then the temp layer's write fails. The rollback's writes work.
  state.fail_session_writes = 1;
  const answer = await messages.change({ type: "change_setting", name: "bridge", action: "set", value: true });
  assert.deepEqual(answer, { ok: false, message: "session storage down" });
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { newtab_ip_info: true });
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], { bridge: false });
});

test("the list gives every setting with value, top layer, kind and allowed values", async () => {
  const { messages } = await make({ hint_letters: "ab" });
  await messages.change({ type: "change_setting", name: "newtab_ip_info", action: "set", value: true });
  const answer = await messages.list();
  assert.ok(answer.ok);
  const row = (name: string) => answer.settings.find((candidate) => candidate.name === name)!;
  assert.equal(row("hint_letters").top_layer, "settings.toml");
  assert.equal(row("newtab_ip_info").top_layer, "saved");
  assert.equal(row("newtab_ip_info").value, true);
  assert.equal(row("which_key_delay_ms").top_layer, "default");
  assert.deepEqual(row("newtab_clock").allowed, [true, false, "analog", "digital"]);
  assert.equal(row("newtab_clock").kind, "enum");
  assert.equal(row("newtab_links").settable, true);
  assert.equal(row("search_prefixes").settable, false);
  assert.equal(row("home_page").value, undefined);
});

test("an unknown action or layer is refused before anything is planned", async () => {
  const { messages, local, session } = await make();
  const bad_action = await messages.change({ type: "change_setting", name: "newtab_date", action: "toggle" as "set", value: false });
  const bad_layer = await messages.change({ type: "change_setting", name: "newtab_date", action: "set", value: false, layer: "perm" as "temp" });
  assert.deepEqual(bad_action, { ok: false, message: 'unknown action "toggle"' });
  assert.deepEqual(bad_layer, { ok: false, message: 'unknown layer "perm"' });
  assert.equal(local[SAVED_SETTINGS_STORAGE_KEY], undefined);
  assert.equal(session[TEMP_SETTINGS_STORAGE_KEY], undefined);
});

test("an enum list keeps the order it was sent in", async () => {
  const { messages, session } = await make();
  const order = ["history", "bookmarks"];
  const answer = await messages.change({ type: "change_setting", name: "open_completion", action: "set", value: order, layer: "temp" });
  assert.ok(answer.ok);
  assert.deepEqual(answer.setting.value, order);
  assert.deepEqual((session[TEMP_SETTINGS_STORAGE_KEY] as Record<string, unknown>).open_completion, order);
  const reversed = await messages.change({ type: "change_setting", name: "open_completion", action: "set", value: [...order].reverse(), layer: "temp" });
  assert.ok(reversed.ok);
  assert.deepEqual(reversed.setting.value, [...order].reverse());
});

test("newtab_links takes a whole list, and a bad list is refused", async () => {
  const { messages, session, startup } = await make();
  const links = [{ label: "Mail", url: "https://mail.test/", group: "Work" }, { label: "News", url: "https://news.test/" }];
  const set = await messages.change({ type: "change_setting", name: "newtab_links", action: "set", value: links, layer: "temp" });
  assert.ok(set.ok);
  assert.deepEqual((session[TEMP_SETTINGS_STORAGE_KEY] as Record<string, unknown>).newtab_links, links);
  assert.deepEqual((await startup.get_config()).settings.newtab_links, links);
  const bad = await messages.change({ type: "change_setting", name: "newtab_links", action: "set", value: [{ label: "x", url: "javascript:alert(1)" }], layer: "temp" });
  assert.equal(bad.ok, false);
  assert.deepEqual((session[TEMP_SETTINGS_STORAGE_KEY] as Record<string, unknown>).newtab_links, links);
  const reset = await messages.change({ type: "change_setting", name: "newtab_links", action: "reset" });
  assert.ok(reset.ok);
  assert.equal((session[TEMP_SETTINGS_STORAGE_KEY] as Record<string, unknown>).newtab_links, undefined);
});

test("a list during a change that then fails does not show the unpublished value", async () => {
  const { messages, state } = await make();
  state.fail_session_writes = 1;
  const changing = messages.change({ type: "change_setting", name: "bridge", action: "set", value: true });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const listing = messages.list();
  assert.equal((await changing).ok, false);
  const answer = await listing;
  assert.ok(answer.ok);
  assert.equal(answer.settings.find((row) => row.name === "bridge")!.top_layer, "default");
});

const ORIGIN = "moz-extension://abc/";

test("only a top-level extension page may send", () => {
  const page = { id: "test@desertfox", url: `${ORIGIN}help.html#/settings`, frameId: 0, tab: { url: `${ORIGIN}help.html` } };
  assert.equal(is_extension_page(page, "test@desertfox", ORIGIN), true);
  assert.equal(is_extension_page({ id: "test@desertfox", url: `${ORIGIN}help.html` }, "test@desertfox", ORIGIN), true);
  const content_script = { id: "test@desertfox", url: "https://example.com/", frameId: 0, tab: { url: "https://example.com/" } };
  assert.equal(is_extension_page(content_script, "test@desertfox", ORIGIN), false);
  assert.equal(is_extension_page({ ...page, id: "other@ext" }, "test@desertfox", ORIGIN), false);
  assert.equal(is_extension_page({ ...page, url: "moz-extension://abcd/x.html" }, "test@desertfox", ORIGIN), false);
  const embedded_cmdline = { id: "test@desertfox", url: `${ORIGIN}cmdline.html`, frameId: 4, tab: { url: "https://example.com/" } };
  assert.equal(is_extension_page(embedded_cmdline, "test@desertfox", ORIGIN), false);
  assert.equal(is_extension_page({ ...embedded_cmdline, frameId: 0 }, "test@desertfox", ORIGIN), false);
  assert.equal(is_extension_page({}, "test@desertfox", ORIGIN), false);
});

test("a temp theme pick from the popup, then desktop again, leaves the saved layer and the file as they were", async () => {
  const { messages, local, session } = await make({ theme: "desktop" });
  const pick = (value: string) => messages.change({ type: "change_setting", name: "theme", action: "set", value, layer: "temp" });
  const saved_before = JSON.stringify(local[SAVED_SETTINGS_STORAGE_KEY] ?? {});
  assert.ok((await pick("dracula")).ok);
  assert.deepEqual((session[TEMP_SETTINGS_STORAGE_KEY] as { theme?: string }).theme, "dracula");
  const back = await pick("desktop");
  assert.ok(back.ok, "desktop passes the one validator");
  assert.deepEqual((session[TEMP_SETTINGS_STORAGE_KEY] as { theme?: string }).theme, "desktop");
  assert.equal(JSON.stringify(local[SAVED_SETTINGS_STORAGE_KEY] ?? {}), saved_before, "the saved settings never changed");
});
