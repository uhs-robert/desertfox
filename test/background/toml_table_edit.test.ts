import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "smol-toml";
import { remove_table_rows, set_table_rows } from "../../src/background/toml_table_edit.ts";
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
  // A comment over the first row is the list's, so it stays when that row goes. One between two rows is the later row's.
  const without_forum = set_table_rows(RULES, "site_rules", [rows[1], rows[2]] as never);
  assert.ok(without_forum.startsWith('# My settings\nhint_letters = "abc" # home row\n\n# Forums hand j and k over\n\n[[site_rules]]\nsite = "*://*.mail.test/*"'), without_forum);
  assert.ok(!without_forum.includes("pass ="));
  const without_docs = set_table_rows(RULES, "site_rules", [rows[0], rows[1]] as never);
  assert.ok(!without_docs.includes("# Docs") && without_docs.includes("[other]\na = 1\n"), without_docs);
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
  // An empty list is written as one, so it stays empty where a default has rows. Removing the list removes the key.
  assert.equal(set_table_rows(text, "newtab_links", []), "newtab_links = []\n# links\n");
  assert.equal(remove_table_rows(text, "newtab_links"), "# links\n");
});

test("a row first in a list with no kept row before it goes right above the first block, under the list's comment", () => {
  const text = 'a = 1\n\n# the links\n[[newtab_links]]\nlabel = "B"\nurl = "https://b.test/"\n';
  const after = set_table_rows(text, "newtab_links", [{ label: "A", url: "https://a.test/" }, { label: "B", url: "https://b.test/" }]);
  assert.equal(after, 'a = 1\n\n# the links\n[[newtab_links]]\nlabel = "A"\nurl = "https://a.test/"\n\n[[newtab_links]]\nlabel = "B"\nurl = "https://b.test/"\n');
});

test("a list in a text without one goes at the end, and an inline array stays one", () => {
  assert.equal(set_table_rows("", "newtab_links", [{ label: "A", url: "https://a.test/" }]), '[[newtab_links]]\nlabel = "A"\nurl = "https://a.test/"\n');
  assert.equal(set_table_rows("a = 1", "newtab_links", [{ label: "A", url: "https://a.test/" }]), 'a = 1\n\n[[newtab_links]]\nlabel = "A"\nurl = "https://a.test/"');
  const inline = 'newtab_links = [{ label = "A", url = "https://a.test/" }] # mine\n[t]\nb = 2\n';
  assert.equal(set_table_rows(inline, "newtab_links", [{ label: "B", url: "https://b.test/" }]), 'newtab_links = [{ label = "B", url = "https://b.test/" }] # mine\n[t]\nb = 2\n');
  assert.equal(set_table_rows(inline, "newtab_links", []), "newtab_links = [] # mine\n[t]\nb = 2\n");
  assert.equal(remove_table_rows(inline, "newtab_links"), "[t]\nb = 2\n");
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

test("a row that moves takes its own comment and layout along, and the list's comment stays on top", () => {
  const text = '# the links\n[[newtab_links]]\nlabel = "A" # first\nurl = "https://a.test/"\n\n# the B link\n[[newtab_links]]\nlabel = "B"\nurl = "https://b.test/"\n\n# the C link\n[[newtab_links]]\nlabel = "C"\nurl = "https://c.test/"\n';
  const [a, b, c] = [{ label: "A", url: "https://a.test/" }, { label: "B", url: "https://b.test/" }, { label: "C", url: "https://c.test/" }];
  const moved = set_table_rows(text, "newtab_links", [a, c, b]);
  assert.equal(moved, '# the links\n[[newtab_links]]\nlabel = "A" # first\nurl = "https://a.test/"\n\n# the C link\n[[newtab_links]]\nlabel = "C"\nurl = "https://c.test/"\n\n# the B link\n[[newtab_links]]\nlabel = "B"\nurl = "https://b.test/"\n');
  assert.equal(set_table_rows(moved, "newtab_links", [a, b, c]), text);
});

test("a comment over the first row, after a root key or after another table stays when the rows go", () => {
  const link = '[[newtab_links]]\nlabel = "A"\nurl = "https://a.test/"\n';
  const second = '\n[[newtab_links]]\nlabel = "B"\nurl = "https://b.test/"\n';
  const section = `a = 1\n\n# Links for the new tab page. Keep work ones first.\n${link}${second}`;
  assert.equal(remove_table_rows(section, "newtab_links"), "a = 1\n\n# Links for the new tab page. Keep work ones first.\n");
  assert.ok(set_table_rows(section, "newtab_links", [{ label: "B", url: "https://b.test/" }]).includes("# Links for the new tab page. Keep work ones first.\n"));
  // A Reset on a file whose only other content is its top comment keeps the comment.
  assert.equal(remove_table_rows(`# My DesertFox settings\n# Written 2026\n${link}`, "newtab_links"), "# My DesertFox settings\n# Written 2026\n");
  assert.equal(remove_table_rows(`hint_letters = "abc"\n# --- links ---\n${link}`, "newtab_links"), 'hint_letters = "abc"\n# --- links ---\n');
  assert.equal(remove_table_rows(`[other]\nx = 1\n# note about x above\n${link}`, "newtab_links"), "[other]\nx = 1\n# note about x above\n");
});

test("a row added after the last one and removed again gives back a text without a final newline", () => {
  const text = '[[site_rules]]\nsite = "a"';
  const added = set_table_rows(text, "site_rules", [{ site: "a" }, OFF_ROW]);
  assert.ok(!added.endsWith("\n"));
  assert.equal(set_table_rows(added, "site_rules", [{ site: "a" }]), text);
});

test("thousands of rows change in one pass at the ends, and a large reorder in the middle is written anew and still checked", () => {
  const rows = Array.from({ length: 3000 }, (_, index) => ({ site: `*://*.s${index}.test/*`, off: true }));
  const text = set_table_rows("", "site_rules", rows);
  const started = performance.now();
  const added = set_table_rows(text, "site_rules", [...rows, OFF_ROW]);
  assert.equal(added, `${text}\n[[site_rules]]\nsite = "*://*.news.test/*"\noff = true\n`);
  assert.equal(set_table_rows(added, "site_rules", rows), text);
  const reversed = [rows[0]!, ...rows.slice(1, -1).reverse(), rows.at(-1)!];
  assert.deepEqual(rows_of(set_table_rows(text, "site_rules", reversed)), reversed);
  assert.ok(performance.now() - started < 10_000, `took ${Math.round(performance.now() - started)} ms`);
});

test("10,000 adjacent rows go in one Reset, and 10,000 new rows after one kept row land in order, each well under a second", () => {
  const rows = Array.from({ length: 10_000 }, (_, index) => ({ site: `*://*.s${index}.test/*` }));
  // No blank lines between the rows, so every removed row is followed by another removed one.
  const packed = `a = 1\n${rows.map((row) => `[[site_rules]]\nsite = "${row.site}"\n`).join("")}`;
  let started = performance.now();
  assert.equal(remove_table_rows(packed, "site_rules"), "a = 1\n");
  assert.ok(performance.now() - started < 1000, `the Reset took ${Math.round(performance.now() - started)} ms`);
  const one = 'a = 1\n\n[[site_rules]]\nsite = "*://*.kept.test/*"\n';
  started = performance.now();
  const grown = set_table_rows(one, "site_rules", [{ site: "*://*.kept.test/*" }, ...rows]);
  assert.ok(performance.now() - started < 1000, `the append took ${Math.round(performance.now() - started)} ms`);
  assert.deepEqual(rows_of(grown), [{ site: "*://*.kept.test/*" }, ...rows]);
});

test("a first row that starts the file is edited in place twice with the blank line under it kept", () => {
  const text = '[[links]]\nlabel = "Docs"\nurl = "https://a.test/"\n\n[[links]]\nlabel = "Mail"\nurl = "https://b.test/"\n';
  const rows = (parse(text) as { links: Record<string, string>[] }).links;
  const once = set_table_rows(text, "links", [{ ...rows[0]!, label: "Manual" }, rows[1]!] as never);
  assert.equal(once, text.replace('"Docs"', '"Manual"'));
  const twice = set_table_rows(once, "links", [{ ...rows[0]!, label: "Guide" }, rows[1]!] as never);
  assert.equal(twice, text.replace('"Docs"', '"Guide"'));
});

test("two new rows above a replaced first row are each followed by one blank line", () => {
  const text = '# c\n[[links]]\nlabel = "a"\n\n[[links]]\nlabel = "b"\n';
  const next = [{ label: "x" }, { label: "y" }, { label: "a2" }, { label: "b" }];
  assert.equal(set_table_rows(text, "links", next as never), '# c\n[[links]]\nlabel = "x"\n\n[[links]]\nlabel = "y"\n\n[[links]]\nlabel = "a2"\n\n[[links]]\nlabel = "b"\n');
});

test("a pass written as a multiline string is replaced by generated lines, never half-rewritten", () => {
  const text = '[[site_rules]]\nsite = "*://a.test/*"\npass = """j k"""\n';
  const out = set_table_rows(text, "site_rules", [{ site: "*://a.test/*", pass: "q" }] as never);
  assert.deepEqual(rows_of(out), [{ site: "*://a.test/*", pass: "q" }]);
});
