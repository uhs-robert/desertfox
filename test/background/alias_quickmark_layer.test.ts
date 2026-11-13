import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { answer_config_transfer } from "../../src/background/config_transfer.ts";
import { load_layers } from "../../src/background/edit_layers.ts";
import { create_alias_messages } from "../../src/background/alias_message.ts";
import { create_quickmark_messages } from "../../src/background/quickmark_message.ts";
import { browser_quickmark_store } from "../../src/background/quickmark_store.ts";
import { ALIAS_EDITS_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import type { HostStartPending } from "../../src/shared/messages.ts";
import { answer_host_start_choice } from "../../src/background/host_start.ts";
import { write_zip } from "../../src/shared/zip.ts";
import { dropped_warning } from "../../src/background/engine_layer.ts";
import { install_fake_browser, type Files } from "./config_fake_browser.ts";

type Startup = typeof import("../../src/background/startup.ts");
const fresh_startup = async (tag: string) => (await import(`../../src/background/startup.ts?alias_quickmark_${tag}`)) as Startup;

const snippet_file = (id: string) => `// id: ${id}\n// label: Mine\n// intent: Run mine.\n// matches: https://a.test/*\nreturn 1;\n`;

async function started(tag: string, files: Files = { "settings.toml": "" }) {
  const host = { files };
  const browser = install_fake_browser(host);
  const startup = await fresh_startup(tag);
  await startup.get_config();
  await startup.reload_config();
  const aliases = create_alias_messages({ read_alias_state: startup.read_alias_state, change_layers: startup.change_layers });
  const quickmarks = create_quickmark_messages({ store: browser_quickmark_store, configured: async () => (await startup.get_config()).quickmarks });
  const export_all = async () => {
    const answer = await answer_config_transfer({ type: "export_config" }, {
      read_files: async () => host.files,
      read_saved: async () => ({}),
      read_keymap_edits: async () => ({ edits: {}, skipped: [] }),
      read_engine_edits: async () => {
        const state = await startup.read_engine_state();
        return { edits: state.kept, aliases: state.kept_aliases, skipped: state.dropped.map(dropped_warning) };
      },
      read_quickmarks: () => browser_quickmark_store.saved(false),
      remove: startup.remove_snippet,
    });
    assert.equal(answer.ok, true);
    return answer as Extract<typeof answer, { config_files: unknown }>;
  };
  return { host, startup, aliases, quickmarks, export_all, ...browser };
}

const up = { type: "change_aliases", action: "set", name: "up", target: "tab.prev" } as const;

test("an added alias is in the config and survives a reload, an import, a files editor save and a restart", async () => {
  const { startup, aliases, host, local } = await started("alias_survives");
  assert.equal((await aliases.change(up)).ok, true);
  assert.equal((await startup.get_config()).command_aliases.up, "tab.prev");

  host.files = { "command_aliases.toml": 'up = "tab.next"\nother = "tab.close"\n' };
  await startup.reload_config();
  assert.equal((await startup.get_config()).command_aliases.up, "tab.prev", "the layer wins over the file");
  assert.equal((await startup.get_config()).command_aliases.other, "tab.close");

  await startup.import_config({ kind: "zip", bytes: write_zip({ "command_aliases.toml": 'imported = "tab.next"\n' }) }, {});
  assert.equal((await startup.get_config()).command_aliases.up, "tab.prev");
  assert.equal((await startup.get_config()).command_aliases.imported, "tab.next");

  await startup.save_config_file("command_aliases.toml", 'saved = "tab.close"\n', 'imported = "tab.next"\n');
  assert.equal((await startup.get_config()).command_aliases.up, "tab.prev");

  const restarted = await fresh_startup("alias_survives_restart");
  assert.equal((await restarted.get_config()).command_aliases.up, "tab.prev");
  assert.deepEqual((await load_layers()).aliases, { up: "tab.prev" });
  assert.deepEqual(local[ALIAS_EDITS_STORAGE_KEY], { up: "tab.prev" });
});

test("a start that applies the folder, and the answer use_folder, keep the alias on top", async () => {
  const { host, aliases, local } = await started("alias_host_start", { "command_aliases.toml": 'file_one = "tab.next"\n' });
  await aliases.change(up);
  host.files = { "command_aliases.toml": 'file_two = "tab.next"\nup = "tab.close"\n' };
  const restarted = await fresh_startup("alias_host_start_restarted");
  await restarted.reload_config_at_start();
  const config = await restarted.get_config();
  assert.equal(config.command_aliases.up, "tab.prev");
  assert.equal(config.command_aliases.file_two, "tab.next");

  // A browser copy with an editor save asks, and using the folder keeps the alias too.
  await restarted.save_config_file("command_aliases.toml", 'typed = "tab.next"\n', 'file_two = "tab.next"\nup = "tab.close"\n');
  host.files = { "command_aliases.toml": 'file_three = "tab.next"\n' };
  const asked = await fresh_startup("alias_host_start_asked");
  await asked.reload_config_at_start();
  const pending = local[HOST_START_PENDING_STORAGE_KEY] as HostStartPending;
  assert.ok(pending);
  const answered = await answer_host_start_choice({ type: "host_start_choice", choice: "use_folder", host_digest: pending.host_digest, browser_digest: pending.browser_digest }, asked.choose_host_start);
  assert.equal(answered.ok, true);
  assert.equal((await asked.get_config()).command_aliases.up, "tab.prev");
  assert.equal((await asked.get_config()).command_aliases.file_three, "tab.next");
});

test("an alias the build refuses stores nothing and names the Aliases section", async () => {
  const { startup, aliases, local } = await started("alias_refused");
  for (const [name, target, pattern] of [["up", "tab.nope", /unknown command id/], ["tab.close", "tab.prev", /already used by a command/], ["two words", "tab.prev", /whitespace/]] as const) {
    const answer = await aliases.change({ type: "change_aliases", action: "set", name, target });
    assert.equal(answer.ok, false, name);
    assert.match(answer.message, pattern);
    assert.match(answer.message, /the Aliases section/);
    assert.doesNotMatch(answer.message, /zz-saved-edits/);
  }
  assert.equal(local[ALIAS_EDITS_STORAGE_KEY] === undefined || Object.keys(local[ALIAS_EDITS_STORAGE_KEY] as object).length === 0, true);
  assert.deepEqual((await startup.get_config()).command_aliases, {});
  assert.equal((await aliases.change({ type: "change_aliases", action: "set", name: "", target: "tab.prev" })).ok, false);
});

test("a file edit that breaks an alias drops it with a warning, the others stay, and it can still be removed", async () => {
  const { startup, aliases, local, export_all } = await started("alias_drop", { "snippets/one.js": snippet_file("mine.one") });
  assert.equal((await aliases.change({ type: "change_aliases", action: "set", name: "mine", target: "mine.one" })).ok, true);
  await aliases.change(up);
  assert.equal((await startup.get_config()).command_aliases.mine, "mine.one");

  await startup.remove_snippet("snippets/one.js");
  const config = await startup.get_config();
  assert.equal(config.command_aliases.mine, undefined);
  assert.equal(config.command_aliases.up, "tab.prev");
  assert.ok((local[WARNINGS_STORAGE_KEY] as string[]).some((warning) => warning.startsWith("aliases: mine left out")));
  const listed = await aliases.list();
  assert.ok(listed.ok);
  assert.match(listed.ok ? (listed.aliases.find((row) => row.name === "mine")?.left_out ?? "") : "", /unknown command id/);
  assert.equal(listed.ok && listed.aliases.find((row) => row.name === "up")?.left_out, undefined);

  // The export leaves the broken alias out and keeps the other.
  const exported = (await export_all()).config_files;
  assert.match(exported["command_aliases.d/zz-saved-edits.toml"]!, /up/);
  assert.doesNotMatch(exported["command_aliases.d/zz-saved-edits.toml"]!, /mine/);

  assert.equal((await aliases.change({ type: "change_aliases", action: "remove", name: "mine" })).ok, true);
  assert.equal((await aliases.change({ type: "change_aliases", action: "remove", name: "mine" })).ok, false);
  assert.deepEqual((await load_layers()).aliases, { up: "tab.prev" });
});

test("an engine edit and an alias edit keep each other, and a broken alias never blocks an engine", async () => {
  const { startup, aliases } = await started("alias_engine_mix", { "snippets/one.js": snippet_file("mine.one") });
  await aliases.change({ type: "change_aliases", action: "set", name: "mine", target: "mine.one" });
  await startup.change_layers("engines", () => ({ engines: { wiki: { url: "https://w.test/?q={query}" } } }));
  await startup.remove_snippet("snippets/one.js");
  const config = await startup.get_config();
  assert.ok(config.search_engines.wiki, "the engine stays while the alias is left out");
  assert.equal(config.command_aliases.mine, undefined);
  await startup.change_layers("engines", () => ({ engines: { wiki: { url: "https://w.test/?q={query}" }, more: { url: "https://m.test/?q={query}" } } }));
  assert.ok((await startup.get_config()).search_engines.more);
});

test("quickmarks of the form are the M store's: listed with their source, replaced, removed and exported", async () => {
  const { startup, quickmarks, export_all, host } = await started("quickmarks", { "quickmarks.toml": 'f = "https://file.test/"\ng = "https://file-g.test/"\n' });
  assert.equal((await quickmarks.change({ type: "change_quickmarks", action: "set", key: "m", url: "https://mail.test/" })).ok, true);
  assert.equal((await quickmarks.change({ type: "change_quickmarks", action: "set", key: "g", url: "https://saved-g.test/" })).ok, true);
  const listed = await quickmarks.list();
  assert.deepEqual(listed.ok && listed.quickmarks, [
    { key: "f", url: "https://file.test/", saved: false },
    { key: "g", url: "https://saved-g.test/", saved: true },
    { key: "m", url: "https://mail.test/", saved: true },
  ]);
  // `go<key>` reads the store over the config table: the same table the list shows.
  const table = await browser_quickmark_store.table((await startup.get_config()).quickmarks, false);
  assert.equal(table.g, "https://saved-g.test/");

  // The store survives a reload and a restart, and a file edit that changes the table.
  host.files = { "quickmarks.toml": 'f = "https://file2.test/"\n' };
  await startup.reload_config();
  const restarted = await fresh_startup("quickmarks_restart");
  assert.equal((await browser_quickmark_store.table((await restarted.get_config()).quickmarks, false)).m, "https://mail.test/");

  const exported = (await export_all()).config_files;
  assert.match(exported["quickmarks.d/zz-saved-edits.toml"]!, /m = "https:\/\/mail.test\/"/);
  assert.doesNotMatch(exported["quickmarks.d/zz-saved-edits.toml"]!, /file2/);
  assert.equal((await quickmarks.change({ type: "change_quickmarks", action: "remove", key: "m" })).ok, true);
  const refused = await quickmarks.change({ type: "change_quickmarks", action: "remove", key: "f" });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /quickmarks.toml/);
  // An import of the export gives the table back, in a browser of its own.
  const round = await started("quickmarks_round");
  await round.startup.import_config({ kind: "zip", bytes: write_zip(exported) }, {});
  assert.equal((await round.startup.get_config()).quickmarks.m, "https://mail.test/");
  assert.equal((await round.startup.get_config()).quickmarks.g, "https://saved-g.test/");

});

test("a quickmark with a bad key or no address is refused", async () => {
  const { quickmarks } = await started("quickmarks_refused");
  assert.equal((await quickmarks.change({ type: "change_quickmarks", action: "set", key: "ab", url: "https://a.test/" })).ok, false);
  assert.equal((await quickmarks.change({ type: "change_quickmarks", action: "set", key: "a", url: " " })).ok, false);
  const listed = await quickmarks.list();
  assert.deepEqual(listed.ok && listed.quickmarks, []);
});
