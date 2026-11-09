import assert from "node:assert/strict";
import "../src/background/command_modules.ts";
import { test } from "node:test";
import { load_effective_config } from "../src/background/config_load.ts";
import { create_settings_messages } from "../src/background/settings_message.ts";
import { CONFIG_STATUS_STORAGE_KEY, FILES_CONFIG_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY } from "../src/background/storage_keys.ts";
import { CONFIG_FORMAT_VERSION } from "../src/shared/config.ts";
import { mount_settings } from "../src/help/settings_page.ts";
import { control_of, create_settings_session, LAYER_LABEL, problem_with, value_of_text } from "../src/help/settings_model.ts";
import { touches_settings } from "../src/shared/storage_watch.ts";
import type { SettingListRow } from "../src/shared/messages.ts";

function install_fake_browser(file_settings: Record<string, unknown>) {
  const local: Record<string, unknown> = { [FILES_CONFIG_STORAGE_KEY]: { config: { format_version: CONFIG_FORMAT_VERSION, settings: file_settings }, warnings: [] } };
  const session: Record<string, unknown> = {};
  const area = (store: Record<string, unknown>) => ({
    get: async (key?: string | string[]) => {
      const keys = key === undefined ? Object.keys(store) : [key].flat();
      return Object.fromEntries(keys.filter((name) => name in store).map((name) => [name, structuredClone(store[name])]));
    },
    set: async (values: Record<string, unknown>) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      Object.assign(store, structuredClone(values));
    },
  });
  Object.assign(globalThis, {
    browser: {
      runtime: { id: "test@desertfox" },
      storage: { local: area(local), session: area(session) },
      tabs: { query: async () => [], sendMessage: async () => undefined },
      contextualIdentities: { query: async () => [] },
      commands: { update: async () => undefined, reset: async () => undefined },
    },
  });
  return { local, session };
}

// A session wired to the real background handlers over fake storage. `other_tab` sends the same messages, as a `:set` in another tab would.
async function make(file_settings: Record<string, unknown> = {}) {
  const fake = install_fake_browser(file_settings);
  const startup = (await import(`../src/background/startup.ts?help_settings_${Math.random()}`)) as typeof import("../src/background/startup.ts");
  await startup.get_config();
  const messages = create_settings_messages({ change_edits: startup.change_edits, read_layers: load_effective_config });
  const send = async (message: unknown) => {
    const request = message as { type: string };
    return request.type === "list_settings" ? messages.list() : messages.change(message as never);
  };
  const changes: (string | undefined)[] = [];
  const session = create_settings_session({ send, engines: ["google", "ddg"], on_change: (name) => changes.push(name) });
  await session.load();
  return { ...fake, session, messages, changes };
}

test("each setting kind gets its control", async () => {
  const rows = new Map<string, SettingListRow>();
  {
    const { session } = await make();
    for (const field of session.fields()) rows.set(field.row.name, field.row);
    const kind = (name: string) => control_of(rows.get(name)!, ["google"]).type;
    assert.equal(kind("newtab_date"), "checkbox");
    assert.equal(kind("which_key_border"), "select");
    assert.equal(kind("light_intensity"), "select");
    assert.equal(kind("history_completion_max"), "number");
    assert.equal(kind("home_page"), "text");
    assert.equal(kind("next_patterns"), "text_list");
    assert.equal(kind("site_rules"), "read_only");
    assert.equal(kind("open_completion"), "ordered_list");
    assert.equal(kind("default_engine"), "select");
    assert.equal(kind("palette"), "select");
    for (const name of ["search_prefixes", "container_prefixes", "newtab_links"]) assert.equal(kind(name), "read_only");
  }
});

test("an enum keeps its typed options, and a palette in force that no list names stays selectable", async () => {
  const { session } = await make({ palette: "my_theme" });
  const clock = session.field("newtab_clock")!.control;
  assert.ok(clock.type === "select" && clock.options.includes(true) && clock.options.includes("analog"));
  const palette = session.field("palette")!.control;
  assert.ok(palette.type === "select" && palette.options.includes("my_theme"));
});

test("checks as you type use the setting's own check", () => {
  assert.match(problem_with("history_completion_max", Number.NaN)!, /history_completion_max: expected/);
  assert.equal(problem_with("history_completion_max", 5), undefined);
  assert.deepEqual(value_of_text({ type: "text_list" }, " a \n\nb"), ["a", "b"]);
  assert.ok(Number.isNaN(value_of_text({ type: "number" }, "")));
});

test("only a write of the config status counts as a change", () => {
  assert.equal(touches_settings({ [CONFIG_STATUS_STORAGE_KEY]: {} }, "local"), true);
  assert.equal(touches_settings({ [CONFIG_STATUS_STORAGE_KEY]: {} }, "session"), false);
  assert.equal(touches_settings({ [SAVED_SETTINGS_STORAGE_KEY]: {} }, "local"), false);
  assert.equal(touches_settings({ other: {} }, "local"), false);
});

test("every layer has a tag label", () => {
  assert.deepEqual(Object.keys(LAYER_LABEL).sort(), ["default", "saved", "settings.toml", "temp"]);
});

test("a change saves, shows the saved tag, and reset returns to the file value", async () => {
  const { session, local } = await make({ which_key_border: "round" });
  assert.equal(session.field("which_key_border")!.row.top_layer, "settings.toml");
  await session.commit("which_key_border", "chamfer");
  assert.equal(session.field("which_key_border")!.row.value, "chamfer");
  assert.equal(session.field("which_key_border")!.row.top_layer, "saved");
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { which_key_border: "chamfer" });
  await session.reset("which_key_border");
  assert.equal(session.field("which_key_border")!.row.value, "round");
  assert.equal(session.field("which_key_border")!.row.top_layer, "settings.toml");
});

test("an invalid value shows its error and sends nothing", async () => {
  const { session, local } = await make();
  await session.commit("history_completion_max", -3);
  assert.match(session.field("history_completion_max")!.error!, /expected/);
  assert.equal(local[SAVED_SETTINGS_STORAGE_KEY], undefined);
});

test("a temp edit shows temp, a saved edit of the same setting takes over, and reset clears both", async () => {
  const { session, messages } = await make({ hint_letters: "ab" });
  await messages.change({ type: "change_setting", name: "hint_letters", action: "set", value: "qw", layer: "temp" });
  await session.refresh();
  assert.equal(session.field("hint_letters")!.row.top_layer, "temp");
  assert.equal(session.field("hint_letters")!.row.value, "qw");
  await session.commit("hint_letters", "zx");
  assert.equal(session.field("hint_letters")!.row.top_layer, "saved");
  assert.equal(session.field("hint_letters")!.row.value, "zx");
  await messages.change({ type: "change_setting", name: "hint_letters", action: "set", value: "tq", layer: "temp" });
  await session.refresh();
  assert.equal(session.field("hint_letters")!.row.top_layer, "temp");
  await session.reset("hint_letters");
  assert.equal(session.field("hint_letters")!.row.top_layer, "settings.toml");
  assert.equal(session.field("hint_letters")!.row.value, "ab");
});

test("a change from another tab shows after a refresh", async () => {
  const { session, messages } = await make();
  await messages.change({ type: "change_setting", name: "newtab_date", action: "set", value: false });
  await session.refresh();
  assert.equal(session.field("newtab_date")!.row.value, false);
  assert.equal(session.field("newtab_date")!.row.top_layer, "saved");
});

test("a refresh leaves a field with a typed draft alone and updates the others", async () => {
  const { session, messages } = await make();
  session.draft("hint_letters", "typing");
  await messages.change({ type: "change_setting", name: "hint_letters", action: "set", value: "other", layer: "saved" });
  await messages.change({ type: "change_setting", name: "newtab_date", action: "set", value: false });
  await session.refresh();
  assert.equal(session.field("hint_letters")!.draft!.value, "typing");
  assert.notEqual(session.field("hint_letters")!.row.value, "other");
  assert.equal(session.field("newtab_date")!.row.value, false);
});

test("a refresh that began before an edit does not overwrite the edit's answer", async () => {
  const { session } = await make();
  const stale = session.refresh();
  await session.commit("newtab_date", false);
  await stale;
  assert.equal(session.field("newtab_date")!.row.value, false);
  assert.equal(session.field("newtab_date")!.row.top_layer, "saved");
});

test("unmounting stops the listener, and a load that ends after it adds none", async () => {
  const { messages } = await make();
  const added: unknown[] = [];
  const removed: unknown[] = [];
  const events = { addListener: (listener: unknown) => added.push(listener), removeListener: (listener: unknown) => removed.push(listener) };
  // The container has no group boxes, so the session loads and nothing is drawn.
  const container = { querySelector: () => null, prepend: () => undefined } as never;
  let last_send: Promise<unknown> = Promise.resolve();
  const send = (message: unknown) => (last_send = (message as { type: string }).type === "list_settings" ? messages.list() : messages.change(message as never));
  // The send has answered and the load's continuation has run.
  const settled = async () => {
    await last_send;
    await new Promise((resolve) => setImmediate(resolve));
  };
  const stop_late = mount_settings(container, send, [], events);
  stop_late();
  await settled();
  assert.equal(added.length, 0);
  const stop = mount_settings(container, send, [], events);
  await settled();
  assert.equal(added.length, 1);
  stop();
  assert.equal(removed.at(-1), added[0]);
});

test("typing while a save is in flight keeps the new draft and its check", async () => {
  const { session } = await make();
  const saving = session.commit("hint_letters", "ab");
  session.draft("hint_letters", "a");
  await saving;
  assert.deepEqual(session.field("hint_letters")!.draft, { value: "a" });
  assert.match(session.field("hint_letters")!.error!, /expected/);
  assert.equal(session.field("hint_letters")!.row.value, "ab");
});

test("a rejected send reads as a refusal for load and refresh", async () => {
  const failing = create_settings_session({ send: async () => { throw new Error("background gone"); }, engines: [], on_change: () => undefined });
  assert.equal(await failing.load(), false);
  await failing.refresh();
  assert.deepEqual(failing.fields(), []);
});

test("two quick edits of one field end on the second value", async () => {
  const { session } = await make();
  const first = session.commit("history_completion_max", 4);
  const second = session.commit("history_completion_max", 9);
  await Promise.all([first, second]);
  assert.equal(session.field("history_completion_max")!.row.value, 9);
  assert.equal(session.field("history_completion_max")!.draft, undefined);
});
