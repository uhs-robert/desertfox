// The table settings changed in the browser go into settings.toml: the popup's Disable and Enable on this site change one `[[site_rules]]` row, and the settings page writes the whole `[[newtab_links]]` list.
import assert from "node:assert/strict";
import "../../src/background/command_modules.ts";
import { test } from "node:test";
import { parse } from "smol-toml";
import { FILES_SOURCE_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY, TEMP_SETTINGS_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { outcome_note, replayed_on_folder } from "../../src/background/settings_file.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import { install_fake_browser, type Files } from "./config_fake_browser.ts";

type Startup = typeof import("../../src/background/startup.ts");
let fresh_count = 0;
const fresh_startup = async () => (await import(`../../src/background/startup.ts?tables_${fresh_count++}`)) as Startup;

const MINE = [
  "# My settings",
  'hint_letters = "abc" # home row',
  "",
  "# Forums hand j and k over",
  "[[site_rules]]",
  'site = "*://*.forum.test/*"',
  'pass = "j k" # their own keys',
  "",
  "# Links on the new tab page",
  "[[newtab_links]]",
  'label = "Docs" # the manual',
  'url = "https://docs.test/"',
  "",
  "[[newtab_links]]",
  'label = "Mail"',
  'url = "https://mail.test/"',
  'group = "Work"',
  "",
].join("\n");
const FORUM = "*://*.forum.test/*";
const NEWS = "*://*.news.test/*";
// Pages whose site patterns are FORUM, NEWS and a blog's.
const FORUM_PAGE = "https://forum.test/t/1";
const NEWS_PAGE = "https://www.news.test/today";
const BLOG_PAGE = "https://blog.test/";
const NEWS_ROW = '\n[[site_rules]]\nsite = "*://*.news.test/*"\noff = true\n';
const WITH_NEWS = MINE.replace("pass = \"j k\" # their own keys\n", `pass = "j k" # their own keys\n${NEWS_ROW}`);

const unsynced_of = (local: Record<string, unknown>) => local[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] ?? undefined;
const stored_settings = (local: Record<string, unknown>) => (local[FILES_SOURCE_STORAGE_KEY] as { files: Files }).files["settings.toml"];
const pause = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
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

const site_rules_in_force = async (startup: Startup) => JSON.parse(JSON.stringify((await startup.get_config()).settings.site_rules ?? [])) as unknown[];

test("Disable on this site adds one row after the file's rows, Enable takes it out again, and every other byte stays", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, startup } = await reloaded(host);
  assert.deepEqual(await startup.change_site_rule_in_file(NEWS_PAGE, "disable"), { kind: "written" });
  assert.equal(host.files["settings.toml"], WITH_NEWS);
  assert.equal(stored_settings(local), WITH_NEWS);
  assert.ok((await site_rules_in_force(startup)).some((row) => JSON.stringify(row) === JSON.stringify({ site: NEWS, off: true })));
  assert.deepEqual(await startup.change_site_rule_in_file(NEWS_PAGE, "disable"), { kind: "unchanged" });
  assert.deepEqual(await startup.change_site_rule_in_file(NEWS_PAGE, "enable"), { kind: "written" });
  assert.equal(host.files["settings.toml"], MINE);
  assert.deepEqual(await startup.change_site_rule_in_file(NEWS_PAGE, "enable"), { kind: "unchanged" });
  assert.equal(unsynced_of(local), undefined);
});

test("Enable removes the popup's rows for the site and keeps the user's rows for the same site and for a wider pattern", async () => {
  const text = `${MINE}\n[[site_rules]]\nsite = "${FORUM}"\noff = true\n\n# everywhere\n[[site_rules]]\nsite = "*://*/*"\npass = "q"\n\n[[site_rules]]\nsite = "${FORUM}"\n`;
  const host = { files: { "settings.toml": text } };
  const { startup } = await reloaded(host);
  assert.deepEqual(await startup.change_site_rule_in_file(FORUM_PAGE, "enable"), { kind: "written" });
  const rows = JSON.parse(JSON.stringify((parse(host.files["settings.toml"]) as { site_rules: unknown[] }).site_rules));
  assert.deepEqual(rows, [{ site: FORUM, pass: "j k" }, { site: "*://*/*", pass: "q" }]);
  assert.ok(host.files["settings.toml"].startsWith(MINE), "the rows before the removed ones stay byte for byte");
  assert.ok(host.files["settings.toml"].includes("# everywhere\n[[site_rules]]\nsite = \"*://*/*\"\npass = \"q\"\n"));
});

test("site_rules in a settings.d file refuses both clicks and names the file, and nothing is written", async () => {
  const host = { files: { "settings.toml": MINE, "settings.d/10-sites.toml": `[[site_rules]]\nsite = "${NEWS}"\noff = true\n` } };
  const { local, sent, startup } = await reloaded(host);
  sent.length = 0;
  for (const action of ["disable", "enable"] as const) {
    await assert.rejects(startup.change_site_rule_in_file(NEWS_PAGE, action), (error: unknown) => error instanceof RuntimeRefusal && error.message === "settings.d/10-sites.toml sets site_rules, and it wins over settings.toml. Change it there.");
  }
  assert.equal(stored_settings(local), MINE);
  assert.deepEqual(sent.filter((message) => message.cmd === "write_config_file"), []);
});

test("a site_rules list saved in the browser goes away on the next click, and only its popup rows join the file", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, startup } = await reloaded(host);
  const mine = { site: "*://*.mine.test/*", off: true };
  // The list the popup used to save: a copy of the file's rows, here one since edited in the file, and its own row.
  await startup.change_edits(() => ({ saved: { site_rules: [{ site: FORUM, pass: "j" }, mine], newtab_date: false }, temp: {} }));
  assert.deepEqual(await startup.change_site_rule_in_file(NEWS_PAGE, "disable"), { kind: "written" });
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { newtab_date: false });
  assert.deepEqual(await site_rules_in_force(startup), [{ site: FORUM, pass: "j k" }, mine, { site: NEWS, off: true }]);
  assert.ok(host.files["settings.toml"].includes('pass = "j k" # their own keys\n\n[[site_rules]]\nsite = "*://*.mine.test/*"\noff = true\n\n[[site_rules]]\nsite = "*://*.news.test/*"\noff = true\n'));
});

test("a saved list that hides a file off row goes away on a click that changes no row, and the site is off after it", async () => {
  const host = { files: { "settings.toml": WITH_NEWS } };
  const { local, startup } = await reloaded(host);
  // The saved list from before the file held the news row hides that row.
  await startup.change_edits(() => ({ saved: { site_rules: [{ site: FORUM, pass: "j k" }] }, temp: {} }));
  assert.ok(!(await site_rules_in_force(startup)).some((row) => (row as { site: string }).site === NEWS));
  assert.deepEqual(await startup.change_site_rule_in_file(NEWS_PAGE, "disable"), { kind: "written" });
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  assert.equal(host.files["settings.toml"], WITH_NEWS);
  assert.ok((await site_rules_in_force(startup)).some((row) => JSON.stringify(row) === JSON.stringify({ site: NEWS, off: true })));
});

test("a click a file rule still overrules once the saved list goes is refused, and nothing changes", async () => {
  const keep_on = `${MINE}\n[[site_rules]]\nsite = "*://www.news.test/*"\noff = false\n`;
  const host = { files: { "settings.toml": keep_on } };
  const { local, sent, startup } = await reloaded(host);
  await startup.change_edits(() => ({ saved: { site_rules: [] }, temp: {} }));
  sent.length = 0;
  await assert.rejects(startup.change_site_rule_in_file(NEWS_PAGE, "disable"), (error: unknown) => error instanceof RuntimeRefusal && error.message === "Not disabled: an earlier rule in site_rules keeps this site on. Change it in settings.toml.");
  // A wider off rule that a click cannot remove keeps the site off.
  const all_off = `${MINE}\n[[site_rules]]\nsite = "*://*/*"\noff = true\n`;
  const off_host = { files: { "settings.toml": all_off } };
  const off_startup = (await reloaded(off_host)).startup;
  await assert.rejects(off_startup.change_site_rule_in_file(NEWS_PAGE, "enable"), (error: unknown) => error instanceof RuntimeRefusal && /^Not enabled/.test(error.message));
  assert.equal(host.files["settings.toml"], keep_on);
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], { site_rules: [] });
  assert.deepEqual(sent.filter((message) => message.cmd === "write_config_file"), []);
});

test("a bare row for the site already turns it off, so Disable changes nothing and says so truly", async () => {
  const bare = `${MINE}\n[[site_rules]]\nsite = "${NEWS}"\n`;
  const host = { files: { "settings.toml": bare } };
  const { startup } = await reloaded(host);
  assert.deepEqual(await startup.change_site_rule_in_file(NEWS_PAGE, "disable"), { kind: "unchanged" });
  assert.equal(host.files["settings.toml"], bare);
  // Enable removes the bare row, as it is the popup's shape.
  assert.deepEqual(await startup.change_site_rule_in_file(NEWS_PAGE, "enable"), { kind: "written" });
  assert.equal(host.files["settings.toml"], MINE);
});

test("without a host, or with one that lacks the verb, the click applies and its note says the file waits", async () => {
  const hosts: { files: Files; granted?: boolean; old_host?: boolean }[] = [{ files: { "settings.toml": MINE }, granted: true }, { files: { "settings.toml": MINE }, old_host: true }];
  for (const host of hosts) {
    const { local, startup } = await reloaded(host);
    if ("granted" in host) host.granted = false;
    const outcome = await startup.change_site_rule_in_file(NEWS_PAGE, "disable");
    assert.ok(outcome.kind === "waiting", JSON.stringify(outcome));
    assert.ok(!outcome_note(outcome).includes("saved to"), outcome_note(outcome));
    assert.equal(host.files["settings.toml"], MINE);
    assert.equal(stored_settings(local), WITH_NEWS);
    assert.deepEqual(unsynced_of(local), { "settings.toml": MINE });
    assert.ok((await site_rules_in_force(startup)).length > 0);
  }
});

test("two quick clicks on two sites and a disable then enable of one land in order, with one follow-up write", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { fake, sent, startup } = await reloaded(host);
  const held = hold_writes(fake);
  const first = startup.change_site_rule_in_file(NEWS_PAGE, "disable");
  await writes_held(held, 1);
  const second = startup.change_site_rule_in_file(BLOG_PAGE, "disable");
  const third = startup.change_site_rule_in_file(NEWS_PAGE, "enable");
  await pause();
  assert.equal(held.length, 1, "a second write went out while the first was out");
  held.shift()!();
  await writes_held(held, 1);
  held.shift()!();
  assert.deepEqual(await Promise.all([first, second, third]), [{ kind: "written" }, { kind: "written" }, { kind: "written" }]);
  assert.equal(sent.filter((message) => message.cmd === "write_config_file").length, 2);
  assert.equal(host.files["settings.toml"], MINE.replace("pass = \"j k\" # their own keys\n", 'pass = "j k" # their own keys\n\n[[site_rules]]\nsite = "*://*.blog.test/*"\noff = true\n'));
});

test("an editor save of another key during a row write keeps both, and one that changes site_rules is never overwritten", async () => {
  const hand = MINE.replace('"abc"', '"hand"');
  const host = { files: { "settings.toml": MINE } };
  const { local, fake, startup } = await reloaded(host);
  const send = fake.runtime.sendNativeMessage;
  let held = hold_writes(fake);
  const click = startup.change_site_rule_in_file(NEWS_PAGE, "disable");
  await writes_held(held, 1);
  host.files = { "settings.toml": hand };
  fake.runtime.sendNativeMessage = send;
  held.shift()!();
  assert.deepEqual(await click, { kind: "written" });
  assert.equal(host.files["settings.toml"], WITH_NEWS.replace('"abc"', '"hand"'));
  assert.equal(stored_settings(local), host.files["settings.toml"]);

  const own_rules = host.files["settings.toml"].replace('pass = "j k"', 'pass = "j"');
  held = hold_writes(fake);
  const enable = startup.change_site_rule_in_file(NEWS_PAGE, "enable");
  await writes_held(held, 1);
  host.files = { "settings.toml": own_rules };
  fake.runtime.sendNativeMessage = send;
  held.shift()!();
  assert.deepEqual(await enable, { kind: "conflict" });
  assert.equal(host.files["settings.toml"], own_rules);
});

test("an import between a click and its write says the file was not written, and `,r` writes a waiting click first", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { startup } = await reloaded(host);
  const click = startup.change_site_rule_in_file(NEWS_PAGE, "disable");
  const imported = startup.import_config({ kind: "folder", entries: [{ path: "keymap.toml", text: "" }] }, {});
  const [outcome] = await Promise.all([click, imported]);
  assert.deepEqual(outcome, { kind: "replaced", by: "import", written: false });
  await startup.reload_config();
  const again = startup.change_site_rule_in_file(NEWS_PAGE, "disable");
  const reload = startup.reload_config();
  assert.deepEqual((await Promise.all([again, reload]))[0], { kind: "written" });
  assert.equal(host.files["settings.toml"], WITH_NEWS);
});

const LINKS = [
  { label: "Docs", url: "https://docs.test/" },
  { label: 'Say "hi" \\ é 東京', url: "https://new.test/?q=a#b", group: "Ünï" },
  { label: "Mail", url: "https://mail.test/", group: "Work" },
];

test("the settings page's link list keeps each link that stays, writes the new one in its place, and reloads as the exact list", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, startup } = await reloaded(host);
  await startup.change_edits(() => ({ saved: { newtab_links: [{ label: "Old", url: "https://old.test/" }] }, temp: { newtab_links: [] } }));
  assert.deepEqual(await startup.set_in_settings_file("newtab_links", LINKS), { kind: "written" });
  const text = host.files["settings.toml"];
  assert.ok(text.includes('label = "Docs" # the manual\nurl = "https://docs.test/"\n\n[[newtab_links]]\nlabel = "Say \\"hi\\" \\\\ é 東京"\nurl = "https://new.test/?q=a#b"\ngroup = "Ünï"\n\n[[newtab_links]]\nlabel = "Mail"'), text);
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  const reloaded_startup = await fresh_startup();
  await reloaded_startup.reload_config();
  assert.deepEqual(JSON.parse(JSON.stringify((await reloaded_startup.get_config()).settings.newtab_links)), LINKS);
});

test("a Reset of the link list removes every link row from settings.toml, never writes the default, and drops the browser edits", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { local, session, startup } = await reloaded(host);
  await startup.change_edits(() => ({ saved: { newtab_links: [] }, temp: { newtab_links: [] } }));
  assert.deepEqual(await startup.unset_in_settings_file("newtab_links"), { kind: "written" });
  // The comment over the first link row is the list's, so it stays.
  assert.equal(host.files["settings.toml"], MINE.slice(0, MINE.indexOf("[[newtab_links]]")));
  assert.ok(!host.files["settings.toml"].includes("newtab_links"));
  assert.deepEqual(local[SAVED_SETTINGS_STORAGE_KEY], {});
  assert.deepEqual(session[TEMP_SETTINGS_STORAGE_KEY], {});
  assert.deepEqual(await startup.unset_in_settings_file("newtab_links"), { kind: "not_set" });
});

test("a cleared link list is written as an empty list, stays empty after a reload, and a Reset then removes it", async () => {
  const host = { files: { "settings.toml": MINE } };
  const { startup } = await reloaded(host);
  assert.deepEqual(await startup.set_in_settings_file("newtab_links", []), { kind: "written" });
  assert.equal(host.files["settings.toml"], MINE.slice(0, MINE.indexOf("[[newtab_links]]")).replace('# home row\n', "# home row\nnewtab_links = []\n"));
  const reloaded_startup = await fresh_startup();
  await reloaded_startup.reload_config();
  assert.deepEqual((await reloaded_startup.get_config()).settings.newtab_links, []);
  assert.deepEqual(await reloaded_startup.unset_in_settings_file("newtab_links"), { kind: "written" });
  assert.ok(!host.files["settings.toml"].includes("newtab_links"));
});

test("a link list a settings.d file sets is refused by name", async () => {
  const host = { files: { "settings.toml": MINE, "settings.d/20-links.toml": '[[newtab_links]]\nlabel = "D"\nurl = "https://d.test/"\n' } };
  const { startup } = await reloaded(host);
  await assert.rejects(startup.set_in_settings_file("newtab_links", LINKS), (error: unknown) => error instanceof RuntimeRefusal && /settings\.d\/20-links\.toml sets newtab_links/.test(error.message));
});

test("a table change is put onto the folder's text where the folder kept the base rows", () => {
  const hand = MINE.replace('"abc"', '"hand"');
  assert.equal(replayed_on_folder(MINE, WITH_NEWS, hand), WITH_NEWS.replace('"abc"', '"hand"'));
  assert.equal(replayed_on_folder(MINE, WITH_NEWS, MINE.replace('pass = "j k"', 'pass = "j"')), undefined);
});
