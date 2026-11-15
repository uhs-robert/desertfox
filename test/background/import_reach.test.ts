import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { drop_consent_settings, preview_import } from "../../src/background/config_import.ts";
import { never_listed } from "../../src/background/bridge_run.ts";
import { CLASSIFIED_IDS, CLASSIFIED_PREFIXES, CONSENT_SETTINGS, import_reach, LOCAL_ONLY_IDS, ROW_CAP } from "../../src/background/import_reach.ts";
import { build_config, commands_of_registry } from "../../src/shared/config_build/build_config.ts";
import type { ConfigFiles } from "../../src/shared/config_build/source_files.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const commands = commands_of_registry(registry);
const reach_of = (files: ConfigFiles) => import_reach(build_config(files, commands), commands);
const runs = (reach: ReturnType<typeof reach_of>, group: keyof ReturnType<typeof reach_of>["keys"]) => reach.keys[group].rows.map(({ keys, where, run }) => `${keys} | ${where} | ${run}`);

test("engines, the default engine, pages, links and quickmarks become address rows", () => {
  const reach = reach_of({
    "search_engines.toml": '[duck]\nurl = "https://duck.test/?q={query}"\nlabel = "Duck"\n[other]\nurl = "https://other.test/?q={query}"\nlabel = "Other"\n',
    "settings.toml": 'default_engine = "duck"\nnew_tab_page = "https://tab.test/"\nhome_page = "https://home.test/"\n[[newtab_links]]\nlabel = "Mail"\nurl = "https://mail.test/"\n',
    "quickmarks.toml": 'g = "https://qm.test/"\n',
  });
  assert.deepEqual(reach.addresses.rows.map(({ what, url }) => `${what} = ${url}`).sort(), [
    "New tab link Mail = https://mail.test/",
    "Home page = https://home.test/",
    "New tab page = https://tab.test/",
    "Quickmark g = https://qm.test/",
    "Search engine duck (default) = https://duck.test/?q={query}",
    "Search engine other = https://other.test/?q={query}",
  ].sort());
});

test("the built-in new tab page and a plain config reach nothing", () => {
  const reach = reach_of({
    "settings.toml": 'new_tab_page = "desertfox"\nhint_letters = "asdf"\n',
    "keymap.toml": '[normal]\nzj = "tab.next"\nzt = "tab.prev"\n',
  });
  assert.equal(reach.addresses.rows.length, 0);
  assert.deepEqual(Object.values(reach.keys).map((list) => list.rows.length), [0, 0, 0]);
  assert.equal(reach.site_rows, 0);
});

test("clipboard and page keys land in their group in every mode, as a step, a labeled run or a nested list", () => {
  const reach = reach_of({
    "keymap.toml": [
      "[normal]",
      'zp = "page.clipboard paste"',
      'zk = "page.send_key --key=Enter --key-code=13"',
      'zo = "open @clipboard"',
      'zc = "open.clipboard"',
      'zq = { run = ["tab.next", "page.clipboard copy"], label = "Copy" }',
      'zr = ":open @clipboard"',
      "[insert]",
      '"<C-p>" = "text.edit_external"',
    ].join("\n"),
  });
  const got = runs(reach, "clipboard_or_page");
  assert.deepEqual(got.map((line) => line.split(" | ").slice(0, 2).join(" | ")).sort(), ["zc | normal mode", "zk | normal mode", "zo | normal mode", "zp | normal mode", "zq | normal mode", "zr | normal mode"]);
  for (const key of ["zo", "zr"]) assert.ok(got.some((line) => line.startsWith(`${key} |`) && line.includes("@clipboard")), key);
  assert.deepEqual(runs(reach, "host").map((line) => line.split(" | ").slice(0, 2).join(" | ")), ["<C-p> | insert mode"]);
});

test("a prompt that starts from the clipboard is listed with the clipboard in its text", () => {
  const reach = reach_of({ "keymap.toml": '[normal]\nzr = ":open @clipboard"\nzs = ":open"\n' });
  assert.deepEqual(reach.keys.clipboard_or_page.rows.map((row) => row.keys), ["zr"]);
  assert.match(reach.keys.clipboard_or_page.rows[0]!.run, /@clipboard/);
});

test("a settings key lands in settings, and naming a consent setting adds the note flag", () => {
  const reach = reach_of({
    "keymap.toml": '[normal]\nzb = "settings.set bridge true"\nzh = "settings.toggle host_auto_update"\nzn = "settings.set new_tab_page https://evil.test/"\nzi = "settings.set newtab_ip_info true"\n',
  });
  const by_key = Object.fromEntries(reach.keys.settings.rows.map((row) => [row.keys, row]));
  assert.equal(by_key.zb?.names_consent, true);
  assert.equal(by_key.zh?.names_consent, true);
  assert.equal(by_key.zi?.names_consent, true);
  assert.equal(by_key.zn?.names_consent, undefined);
  assert.match(by_key.zn!.run, /new_tab_page/);
});

test("native host and permission keys land in host", () => {
  const reach = reach_of({ "keymap.toml": '[normal]\nzn = "native.install"\nzp = "permissions.grant nativeMessaging"\n[insert]\nze = "text.edit_external"\n' });
  assert.deepEqual(reach.keys.host.rows.map((row) => row.keys).sort(), ["ze", "zn", "zp"]);
});

test("a site row bind and a site mode bind are walked and name their site", () => {
  const reach = reach_of({
    "settings.toml": [
      "[[site_rules]]",
      'site = "a.test"',
      '[site_rules.bind]',
      'zb = "settings.set bridge true"',
      "[[site_rules]]",
      'site = "b.test"',
      '[site_rules.modes.m]',
      'label = "M"',
      '[site_rules.modes.m.bind]',
      'zv = ["tab.next", "page.clipboard paste"]',
      "[[site_rules]]",
      'site = "c.test"',
      "off = true",
    ].join("\n"),
  });
  assert.deepEqual(runs(reach, "settings").map((line) => line.split(" | ").slice(0, 2).join(" | ")), ["zb | site a.test"]);
  assert.deepEqual(runs(reach, "clipboard_or_page").map((line) => line.split(" | ").slice(0, 2).join(" | ")), ['zv | site b.test, mode "m"']);
  assert.equal(reach.site_rows, 2);
});

test("a key with a fixed address, in a site row too, is an address row", () => {
  const reach = reach_of({
    "keymap.toml": '[normal]\nzo = "open https://one.test/"\n',
    "settings.toml": '[[site_rules]]\nsite = "a.test"\n[site_rules.bind]\nzo = "open https://two.test/"\n',
  });
  assert.deepEqual(reach.addresses.rows.map(({ what, url }) => `${what} ${url}`).sort(), ["Key zo in normal mode opens https://one.test/", "Key zo in site a.test opens https://two.test/"]);
});

test("a modifier that adds an address is listed, because it reaches every key of its group", () => {
  const reach = reach_of({ "keymap.toml": '[modifiers]\n";u" = { url = "https://mod.test/" }\n' });
  assert.deepEqual(reach.addresses.rows.map((row) => row.url), ["https://mod.test/"]);
});

test("search, container and site generator keys add no key row: their engine URL is already an address row", () => {
  const reach = reach_of({
    "search_engines.toml": '[duck]\nurl = "https://duck.test/?q={query}"\nlabel = "Duck"\nhosts = ["duck.test"]\n',
    "keymap.toml": '[search_keys]\nd = "duck"\n[site_keys]\nd = ["duck"]\n',
  });
  assert.deepEqual(reach.addresses.rows.map((row) => row.what), ["Search engine duck"]);
  assert.deepEqual(Object.values(reach.keys).map((list) => list.rows.length), [0, 0, 0]);
});

test("an alias to a risky command is listed with the command line name", () => {
  const reach = reach_of({ "command_aliases.toml": 'inst = "native.install"\nfine = "tab.next"\n' });
  assert.deepEqual(runs(reach, "host"), [":inst | command line | native.install"]);
});

test("a list stops at the cap and counts the rest", () => {
  const bindings = Array.from({ length: 30 }, (_, index) => `"z${index.toString(36)}" = "page.clipboard paste"`);
  const reach = reach_of({ "keymap.toml": `[normal]\n${bindings.join("\n")}\n` });
  assert.equal(reach.keys.clipboard_or_page.rows.length, ROW_CAP);
  assert.equal(reach.keys.clipboard_or_page.more, 30 - ROW_CAP);
});

test("every classified id is a registered command, and every command the bridge never runs is classified or named local only", () => {
  const ids = new Set(commands.map((command) => command.id));
  for (const id of [...CLASSIFIED_IDS, ...LOCAL_ONLY_IDS]) assert.ok(ids.has(id), `${id} is not a registered command`);
  for (const id of ids) {
    if (CLASSIFIED_PREFIXES.some((prefix) => id.startsWith(prefix))) assert.ok(CLASSIFIED_IDS.includes(id), `${id} is not classified`);
    if (never_listed(id)) assert.ok(CLASSIFIED_IDS.includes(id) || LOCAL_ONLY_IDS.includes(id), `${id} is never run through the bridge: classify it in import_reach.ts or add it to LOCAL_ONLY_IDS`);
  }
  assert.deepEqual(LOCAL_ONLY_IDS.filter((id) => CLASSIFIED_IDS.includes(id)), []);
});

test("twelve harmless engines before new_tab_page still show the new tab page", () => {
  const engines = Array.from({ length: 12 }, (_, index) => `[e${index}]\nurl = "https://e${index}.test/?q={query}"\nlabel = "E${index}"\n`).join("\n");
  const reach = reach_of({ "search_engines.toml": engines, "settings.toml": 'new_tab_page = "https://evil.test/"\n' });
  assert.equal(reach.addresses.rows.length, ROW_CAP);
  assert.equal(reach.addresses.rows[0]!.what, "New tab page");
  assert.equal(reach.addresses.more, 1);
});

test("twelve harmless setting keys before a consent key still show the consent key first", () => {
  const toggles = Array.from({ length: 12 }, (_, index) => `"z${index.toString(36)}" = "settings.toggle strip_tracking"`).join("\n");
  const reach = reach_of({ "keymap.toml": `[normal]\n${toggles}\nzzb = "settings.set bridge true"\n` });
  assert.equal(reach.keys.settings.rows.length, ROW_CAP);
  assert.equal(reach.keys.settings.rows[0]!.keys, "zzb");
  assert.equal(reach.keys.settings.rows[0]!.names_consent, true);
});

test("twelve plain key rows before a host key show the host key, and clipboard keys come before address keys", () => {
  const pastes = Array.from({ length: 12 }, (_, index) => `"z${index.toString(36)}" = "page.clipboard paste"`).join("\n");
  const reach = reach_of({ "keymap.toml": `[normal]\n${pastes}\nzzn = "native.install"\n` });
  assert.equal(reach.keys.host.rows[0]!.keys, "zzn");
  const opens = Array.from({ length: 12 }, (_, index) => `"o${index.toString(36)}" = "open https://o${index}.test/"`).join("\n");
  const mixed = reach_of({ "keymap.toml": `[normal]\n${opens}\nzzp = "page.clipboard paste"\n`, "settings.toml": 'home_page = "https://home.test/"\n' });
  assert.equal(mixed.addresses.rows[0]!.what, "Home page");
  assert.equal(mixed.keys.clipboard_or_page.rows[0]!.keys, "zzp");
});

test("register.paste of the system clipboard register is a clipboard key, and a named register is not", () => {
  const reach = reach_of({ "keymap.toml": '[insert]\n"<C-v>" = "register.paste +"\n"<C-b>" = "register.paste a"\n' });
  assert.deepEqual(reach.keys.clipboard_or_page.rows.map((row) => row.keys), ["<C-v>"]);
});

test("a modifier whose args name a consent setting or the clipboard register is listed", () => {
  const reach = reach_of({ "keymap.toml": '[modifiers]\n",z" = { name = "bridge" }\n",c" = { register = "+" }\n' });
  assert.deepEqual(reach.keys.settings.rows.map((row) => [row.keys, row.names_consent]), [[",z", true]]);
  assert.deepEqual(reach.keys.clipboard_or_page.rows.map((row) => row.keys), [",c"]);
});

test("preview_import returns the reach, and the consent settings, newtab_ip_info too, are still dropped", () => {
  const files = { "settings.toml": 'bridge = true\nbridge_share_tabs = true\nhost_auto_update = true\nnewtab_ip_info = true\nnew_tab_page = "https://tab.test/"\n', "keymap.toml": '[normal]\nzp = "page.clipboard paste"\n' };
  const preview = preview_import(files, {}, commands);
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.warnings.filter((warning) => warning.includes("is not imported")).length, 4);
  assert.deepEqual(preview.reach.addresses.rows.map((row) => row.url), ["https://tab.test/"]);
  assert.deepEqual(preview.reach.keys.clipboard_or_page.rows.map((row) => row.keys), ["zp"]);
  const { files: kept } = drop_consent_settings(files);
  for (const key of CONSENT_SETTINGS) assert.ok(!kept["settings.toml"]!.includes(key));
});

test("a build with a problem returns an empty reach", () => {
  const preview = preview_import({ "keymap.toml": '[normal]\nzp = "no.such.command"\n' }, {}, commands);
  assert.equal(preview.ok && preview.problems.length > 0, true);
  if (preview.ok) assert.equal(preview.reach.keys.clipboard_or_page.rows.length, 0);
});
