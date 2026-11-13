import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { load_layers } from "../../src/background/edit_layers.ts";
import type { KeymapEdits } from "../../src/background/edit_layers.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeLeaf } from "../../src/shared/prefix_tree.ts";
import { FILES_SOURCE_STORAGE_KEY, KEYMAP_EDITS_STORAGE_KEY, TEMP_SETTINGS_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { write_zip } from "../../src/shared/zip.ts";
import { install_fake_browser, type Files } from "./config_fake_browser.ts";

type Startup = typeof import("../../src/background/startup.ts");
const fresh_startup = async (tag: string) => (await import(`../../src/background/startup.ts?layers_${tag}`)) as Startup;

// The command id a key runs in the stored compiled keymap, or undefined when the key is unbound.
const bound = (local: Record<string, unknown>, mode: "normal" | "browser", keys: string) => {
  const node = (local[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap).modes[mode]?.children[keys];
  return node?.kind === "leaf" ? (node as TreeLeaf).steps[0]!.invocation.id : undefined;
};

const set_keymap = (startup: Startup, edits: KeymapEdits) => startup.change_layers("keymap", () => edits);

async function started(tag: string, files: Files = {}) {
  const host = { files };
  const browser = install_fake_browser(host);
  const startup = await fresh_startup(tag);
  await startup.get_config();
  await startup.reload_config();
  return { host, startup, ...browser };
}

test("a key edit wins over keymap.toml and survives a reload, an import, a files editor save and a restart", async () => {
  const { startup, local, host } = await started("survives", { "keymap.toml": '[normal]\nJ = "tab.prev"\n' });
  assert.equal(bound(local, "normal", "J"), "tab.prev");
  await set_keymap(startup, { normal: { J: "tab.close" } });
  assert.equal(bound(local, "normal", "J"), "tab.close");

  host.files = { "keymap.toml": '[normal]\nJ = "tab.goto"\n' };
  await startup.reload_config();
  assert.equal(bound(local, "normal", "J"), "tab.close");

  await startup.import_config({ kind: "zip", bytes: write_zip({ "keymap.toml": '[normal]\nJ = "tab.next"\n' }) }, {});
  assert.equal(bound(local, "normal", "J"), "tab.close");

  const base = (local[FILES_SOURCE_STORAGE_KEY] as { files: Files }).files["keymap.toml"]!;
  await startup.save_config_file("keymap.toml", '[normal]\nJ = "tab.goto"\nK = "tab.next"\n', base);
  assert.equal(bound(local, "normal", "J"), "tab.close");
  assert.equal(bound(local, "normal", "K"), "tab.next");

  const restarted = await fresh_startup("survives_restart");
  await restarted.get_config();
  assert.equal(bound(local, "normal", "J"), "tab.close");
});

test('"" unbinds a default, and dropping the edit brings the default back', async () => {
  const { startup, local } = await started("unbind");
  assert.equal(bound(local, "normal", "K"), "tab.prev");
  await set_keymap(startup, { normal: { K: "" } });
  assert.equal(bound(local, "normal", "K"), undefined);
  await set_keymap(startup, {});
  assert.equal(bound(local, "normal", "K"), "tab.prev");
});

test("a stored edit layer keeps only known modes, good sequences and text", async () => {
  const { local } = install_fake_browser({ files: {} });
  local[KEYMAP_EDITS_STORAGE_KEY] = {
    normal: { J: "tab.close", "": "tab.next", "a b": "tab.next", "<x>": "tab.next", K: 1 },
    nope: { J: "tab.next" },
    insert: ["tab.next"],
    browser: { J: "tab.next", "<A-x>": "tab.next" },
  };
  assert.deepEqual(await load_layers(), { keymap: { normal: { J: "tab.close" }, browser: { "<A-x>": "tab.next" } } });
  local[KEYMAP_EDITS_STORAGE_KEY] = "junk";
  assert.deepEqual(await load_layers(), { keymap: {} });
});

test("a failed publish puts the stored layer back and republishes the old keymap", async () => {
  const { startup, local, fake } = await started("rollback");
  await set_keymap(startup, { normal: { J: "tab.close" } });
  const working = fake.tabs.query;
  fake.tabs.query = async () => {
    throw new Error("tabs down");
  };
  await assert.rejects(set_keymap(startup, { normal: { J: "tab.goto" } }), /tabs down/);
  fake.tabs.query = working;
  assert.deepEqual(local[KEYMAP_EDITS_STORAGE_KEY], { normal: { J: "tab.close" } });
  assert.equal(bound(local, "normal", "J"), "tab.close");
  // The queue goes on after the failure.
  await set_keymap(startup, { normal: { J: "tab.prev" } });
  assert.equal(bound(local, "normal", "J"), "tab.prev");
});

test("key edits and :set share one queue, so changes started together all land", async () => {
  const { startup, local, session, fake } = await started("queue");
  // A slow write: a change that did not wait for the one before would read the layer before that one wrote it.
  const working = fake.storage.local.set;
  fake.storage.local.set = async (values) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return working(values);
  };
  const add = (keys: string, text: string) => startup.change_layers("keymap", (current) => ({ ...current, normal: { ...current.normal, [keys]: text } }));
  await Promise.all([add("J", "tab.close"), startup.change_edits((current) => ({ ...current, temp: { hint_letters: "xy" } })), add("K", "tab.goto")]);
  fake.storage.local.set = working;
  assert.deepEqual(local[KEYMAP_EDITS_STORAGE_KEY], { normal: { J: "tab.close", K: "tab.goto" } });
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], { hint_letters: "xy" });
  assert.equal(bound(local, "normal", "J"), "tab.close");
  assert.equal(bound(local, "normal", "K"), "tab.goto");
});

test("a browser edit moves the Firefox shortcuts, a normal edit leaves them, and a rollback puts them back", async () => {
  const { startup, fake } = await started("slots");
  const updates: { name: string; shortcut: string }[] = [];
  (fake.commands as { update: (detail: { name: string; shortcut: string }) => Promise<void> }).update = async (detail) => void updates.push(detail);
  const shortcuts = () => updates.map((update) => update.shortcut).sort();

  await set_keymap(startup, { normal: { J: "tab.close" } });
  assert.equal(updates.length, 0);

  await set_keymap(startup, { browser: { "<A-x>": "tab.close" } });
  assert.ok(shortcuts().includes("Alt+X"), JSON.stringify(updates));

  updates.length = 0;
  const working = fake.tabs.query;
  fake.tabs.query = async () => {
    throw new Error("tabs down");
  };
  await assert.rejects(set_keymap(startup, { browser: { "<A-y>": "tab.close" } }), /tabs down/);
  fake.tabs.query = working;
  // The failed publish took Alt+Y, and the rollback planned the slots again with Alt+X.
  const last_x = updates.findLastIndex((update) => update.shortcut === "Alt+X");
  const last_y = updates.findLastIndex((update) => update.shortcut === "Alt+Y");
  assert.ok(last_y >= 0 && last_y < last_x, JSON.stringify(updates));
});
