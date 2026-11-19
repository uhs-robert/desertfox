import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "smol-toml";
import { set_table_rows } from "../../src/background/toml_table_edit.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";

const RULES = [
  "# My settings",
  'hint_letters = "abc" # home row',
  "",
  "# Forums hand j and k over",
  "[[site_rules]]",
  'site = "https://forum.test/*"',
  'pass = "j k" # their own keys',
  "",
  "[[site_rules]]",
  'site = "*://*.mail.test/*"',
  "off = true",
  "",
  "# Docs",
  "[[site_rules]]",
  'site = "*://docs.test/*"',
  "[site_rules.keymap.normal]",
  'x = "tab.close"',
  "",
  "[other]",
  "a = 1",
  "",
].join("\n");

const rows_of = (text: string): unknown[] => JSON.parse(JSON.stringify((parse(text) as { site_rules?: unknown[] }).site_rules ?? []));
const OFF_ROW = { site: "*://*.news.test/*", off: true };

test("an added row goes after the last row and keeps every other byte, and removing it gives the text back", () => {
  const added = set_table_rows(RULES, "site_rules", [...rows_of(RULES), OFF_ROW] as never);
  assert.equal(added, RULES.replace('x = "tab.close"\n', 'x = "tab.close"\n\n[[site_rules]]\nsite = "*://*.news.test/*"\noff = true\n'));
  assert.equal(set_table_rows(added, "site_rules", rows_of(RULES) as never), RULES);
});

test("a removed row takes only its own lines, and the comments around it stay", () => {
  const rows = rows_of(RULES);
  const without_mail = set_table_rows(RULES, "site_rules", [rows[0], rows[2]] as never);
  assert.equal(without_mail, RULES.replace('[[site_rules]]\nsite = "*://*.mail.test/*"\noff = true\n\n', ""));
  // The first row's own inline comment and the comment above it are kept with it.
  const without_forum = set_table_rows(RULES, "site_rules", [rows[1], rows[2]] as never);
  assert.ok(without_forum.includes("# Forums hand j and k over\n\n[[site_rules]]\nsite = \"*://*.mail.test/*\""), without_forum);
  assert.ok(!without_forum.includes("pass ="));
});

test("of two rows that share a site, only the one that equals the removed row goes", () => {
  const text = '[[site_rules]]\nsite = "*://*.a.test/*"\npass = "j"\n\n[[site_rules]]\nsite = "*://*.a.test/*"\noff = true\n\n[[site_rules]]\nsite = "*://*.a.test/*"\noff = true\n';
  const after = set_table_rows(text, "site_rules", [{ site: "*://*.a.test/*", pass: "j" }, { site: "*://*.a.test/*", off: true }]);
  assert.deepEqual(rows_of(after), [{ site: "*://*.a.test/*", pass: "j" }, { site: "*://*.a.test/*", off: true }]);
  assert.ok(after.startsWith('[[site_rules]]\nsite = "*://*.a.test/*"\npass = "j"\n'));
});

test("a whole new list keeps the rows that stay, moves none it need not, and writes the rest in their place", () => {
  const text = '# links\n[[newtab_links]]\nlabel = "A" # first\nurl = "https://a.test/"\n\n[[newtab_links]]\nlabel = "B"\nurl = "https://b.test/"\n\n[[newtab_links]]\nlabel = "C"\nurl = "https://c.test/"\n';
  const next = [{ label: "A", url: "https://a.test/" }, { label: "New", url: "https://n.test/", group: "G" }, { label: "C", url: "https://c.test/" }];
  const after = set_table_rows(text, "newtab_links", next);
  assert.deepEqual(rows_of(after.replaceAll("newtab_links", "site_rules")), next);
  assert.ok(after.includes('label = "A" # first'), after);
  assert.ok(after.includes('[[newtab_links]]\nlabel = "New"\nurl = "https://n.test/"\ngroup = "G"\n'), after);
  // An empty list removes the key, so a list that was never written reads the same.
  const emptied = set_table_rows(text, "newtab_links", []);
  assert.equal(emptied, "# links\n");
});

test("a row first in a list with no kept row before it goes above the first block and its comment", () => {
  const text = 'a = 1\n\n# the B link\n[[newtab_links]]\nlabel = "B"\nurl = "https://b.test/"\n';
  const after = set_table_rows(text, "newtab_links", [{ label: "A", url: "https://a.test/" }, { label: "B", url: "https://b.test/" }]);
  assert.equal(after, 'a = 1\n\n[[newtab_links]]\nlabel = "A"\nurl = "https://a.test/"\n\n# the B link\n[[newtab_links]]\nlabel = "B"\nurl = "https://b.test/"\n');
});

test("a list in a text without one goes at the end, and an inline array stays one", () => {
  assert.equal(set_table_rows("", "newtab_links", [{ label: "A", url: "https://a.test/" }]), '[[newtab_links]]\nlabel = "A"\nurl = "https://a.test/"\n');
  assert.equal(set_table_rows("a = 1", "newtab_links", [{ label: "A", url: "https://a.test/" }]), 'a = 1\n\n[[newtab_links]]\nlabel = "A"\nurl = "https://a.test/"');
  const inline = 'newtab_links = [{ label = "A", url = "https://a.test/" }] # mine\n[t]\nb = 2\n';
  assert.equal(set_table_rows(inline, "newtab_links", [{ label: "B", url: "https://b.test/" }]), 'newtab_links = [{ label = "B", url = "https://b.test/" }] # mine\n[t]\nb = 2\n');
  assert.equal(set_table_rows(inline, "newtab_links", []), "[t]\nb = 2\n");
});

test("quotes, backslashes, newlines and non-ASCII in values and keys parse back exactly", () => {
  const row = { site: '*://*.q"\\.test/*', bind: { "<C-d>": "scroll.down", "é": 'say "hi"\n東京 \u007f' }, zoom: 1.5 };
  const after = set_table_rows("x = 1\r\n", "site_rules", [row]);
  assert.deepEqual(rows_of(after), [row]);
  assert.ok(after.includes("\r\n[[site_rules]]\r\n"), "the new lines take the text's line endings");
});

test("a layout the scan misreads, a key inside a table and text that does not parse are refused, never written", () => {
  const text = '[[site_rules]]\nsite = "a"\nnote = """\n[[site_rules]]\n"""\n';
  assert.throws(() => set_table_rows(text, "site_rules", []), RuntimeRefusal);
  assert.throws(() => set_table_rows("[t]\nsite_rules = 3\n", "site_rules", [OFF_ROW]), RuntimeRefusal);
  assert.throws(() => set_table_rows("a = \n", "site_rules", [OFF_ROW]), (error: unknown) => error instanceof RuntimeRefusal && /does not parse/.test(error.message));
});
