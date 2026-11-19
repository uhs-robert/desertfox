import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import { remove_top_level_key, set_top_level_key } from "../../src/background/toml_key_edit.ts";

const refused = (run: () => unknown, pattern: RegExp) => assert.throws(run, (error: unknown) => error instanceof RuntimeRefusal && pattern.test(error.message));

test("a set replaces only the value and keeps the comments, blank lines, order and inline comment", () => {
  const text = '# My settings\n\nhint_letters = "abc"   # home row\ntheme = "nord" # dark one\n\n# Rules below\n[[site_rules]]\nsite = "*://x/*"\n';
  assert.equal(set_top_level_key(text, "theme", "gruvbox"), text.replace('theme = "nord"', 'theme = "gruvbox"'));
});

test("a set keeps a quoted key, a literal string value and odd spacing", () => {
  assert.equal(set_top_level_key("\"theme\"='nord'\n", "theme", "a"), '"theme"="a"\n');
  assert.equal(set_top_level_key("  theme   =   'it\"s'  # c\n", "theme", "b"), '  theme   =   "b"  # c\n');
  assert.equal(set_top_level_key('theme = "a \\" # not a comment" # real\n', "theme", "b"), 'theme = "b" # real\n');
});

test("a missing key goes after the last top-level line, above the comment that leads into the first table", () => {
  const text = 'hint_letters = "abc"\n\n# Rules\n[[site_rules]]\nsite = "*://x/*"\n';
  assert.equal(set_top_level_key(text, "theme", "nord"), 'hint_letters = "abc"\ntheme = "nord"\n\n# Rules\n[[site_rules]]\nsite = "*://x/*"\n');
});

test("a missing key in a file with no table goes after the last key, before trailing comments", () => {
  assert.equal(set_top_level_key('a = 1\nb = 2\n# end\n', "theme", "nord"), 'a = 1\nb = 2\ntheme = "nord"\n# end\n');
});

test("a commented-out key stays a comment and a real line is added", () => {
  const text = '# theme = "old"\nhint_letters = "abc"\n';
  assert.equal(set_top_level_key(text, "theme", "nord"), '# theme = "old"\nhint_letters = "abc"\ntheme = "nord"\n');
});

test("CRLF text gets CRLF lines and keeps every CR", () => {
  const text = 'a = 1\r\n\r\n# Rules\r\n[[site_rules]]\r\nsite = "x"\r\n';
  assert.equal(set_top_level_key(text, "theme", "nord"), 'a = 1\r\ntheme = "nord"\r\n\r\n# Rules\r\n[[site_rules]]\r\nsite = "x"\r\n');
  assert.equal(set_top_level_key('theme = "a"\r\nb = 1\r\n', "theme", "c"), 'theme = "c"\r\nb = 1\r\n');
});

test("a file with no final newline keeps none, and its last line stays whole", () => {
  assert.equal(set_top_level_key("a = 1", "theme", "nord"), 'a = 1\ntheme = "nord"');
  assert.equal(set_top_level_key('theme = "x"', "theme", "nord"), 'theme = "nord"');
  assert.equal(set_top_level_key("", "theme", "nord"), 'theme = "nord"\n');
  assert.equal(set_top_level_key("# only a comment", "theme", "nord"), 'theme = "nord"\n# only a comment');
});

test("a key set twice is refused", () => {
  // smol-toml refuses the duplicate as well, so the refusal names the parse.
  refused(() => set_top_level_key('theme = "a"\ntheme = "b"\n', "theme", "c"), /does not parse/);
});

test("a key inside a table and a dotted key are refused", () => {
  refused(() => set_top_level_key('a = 1\n[newtab]\ntheme = "x"\n', "theme", "c"), /inside a table/);
  refused(() => set_top_level_key("a = 1\n", "newtab.theme", "c"), /top-level keys only/);
});

test("a value this editor does not rewrite is refused and the text is never half changed", () => {
  refused(() => set_top_level_key('theme = """\nx"""\n', "theme", "c"), /does not rewrite/);
  refused(() => set_top_level_key("theme = [\n1]\n", "theme", "c"), /does not rewrite/);
});

test("a key line inside a multi-line string is never taken for the key", () => {
  const text = 'note = """\ntheme = "fake"\n"""\n';
  refused(() => set_top_level_key(text, "theme", "c"), /cannot edit safely/);
});

test("text that does not parse is refused", () => {
  refused(() => set_top_level_key("a = \n", "theme", "c"), /does not parse/);
});

test("strings with quotes, backslashes and control characters round-trip through a parse", () => {
  const value = 'a"b\\c\td\x7f';
  const edited = set_top_level_key("", "theme", value);
  assert.match(edited, /\\u007f/);
});

test("numbers and booleans are written bare", () => {
  assert.equal(set_top_level_key("a = 1\n", "b", 5), "a = 1\nb = 5\n");
  assert.equal(set_top_level_key("a = 1\n", "b", true), "a = 1\nb = true\n");
});

test("a remove drops the one line and keeps the rest byte for byte", () => {
  const text = '# top\r\ntheme = "nord" # mine\r\n\r\nb = 1\r\n';
  assert.equal(remove_top_level_key(text, "theme"), "# top\r\n\r\nb = 1\r\n");
  assert.equal(remove_top_level_key("b = 1\n# theme = \"x\"\n", "theme"), "b = 1\n# theme = \"x\"\n");
  assert.equal(remove_top_level_key('b = 1\ntheme = "x"', "theme"), "b = 1\n");
});
