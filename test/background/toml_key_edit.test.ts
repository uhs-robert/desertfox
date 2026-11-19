import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "smol-toml";
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
  refused(() => set_top_level_key("theme = {a = 1}\n", "theme", "c"), /does not rewrite/);
  refused(() => set_top_level_key('theme = ["""a""", "b"]\n', "theme", "c"), /does not rewrite/);
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

test("a list goes in as a one-line array of strings, escaped as a basic string is", () => {
  assert.equal(set_top_level_key("a = 1\n", "next_patterns", ["next", 'say "hi"', "»"]), 'a = 1\nnext_patterns = ["next", "say \\"hi\\"", "»"]\n');
  assert.equal(set_top_level_key("a = 1\n", "hint_add", []), "a = 1\nhint_add = []\n");
});

test("a one-line array is replaced in place and keeps its trailing comment", () => {
  const text = '# Lists\nnext_patterns = ["next", "more"] # mine\nb = 2\n';
  assert.equal(set_top_level_key(text, "next_patterns", ["on"]), '# Lists\nnext_patterns = ["on"] # mine\nb = 2\n');
  assert.equal(set_top_level_key('hint_add = ["a]b", \'c]\']\n', "hint_add", ["x"]), 'hint_add = ["x"]\n');
});

test("an array over several lines becomes one line, and one with a comment inside is refused", () => {
  const text = 'a = 1\nnext_patterns = [\n  "next",\n  "more",\n]\nb = 2\n';
  assert.equal(set_top_level_key(text, "next_patterns", ["on"]), 'a = 1\nnext_patterns = ["on"]\nb = 2\n');
  refused(() => set_top_level_key('next_patterns = [\n  "next", # the usual\n  "more",\n]\n', "next_patterns", ["on"]), /does not rewrite/);
  refused(() => set_top_level_key('next_patterns = [\n  "next",\n', "next_patterns", ["on"]), /does not parse/);
});

test("a scalar can replace a list and a list a scalar, as a hand edit would", () => {
  assert.equal(set_top_level_key('theme = ["a"]\n', "theme", "nord"), 'theme = "nord"\n');
  assert.equal(set_top_level_key("hint_add = 3 # odd\n", "hint_add", ["a"]), 'hint_add = ["a"] # odd\n');
});

test("a remove drops a whole array, the lines and comments inside it too, and keeps the rest", () => {
  const text = '# Mine\na = 1\nnext_patterns = [\n  "next", # usual\n  "more",\n] # end\n# Rules\n[[site_rules]]\nsite = "x"\n';
  assert.equal(remove_top_level_key(text, "next_patterns"), '# Mine\na = 1\n# Rules\n[[site_rules]]\nsite = "x"\n');
  assert.equal(remove_top_level_key('a = 1\nhint_add = ["x"] # c\n', "hint_add"), "a = 1\n");
  refused(() => remove_top_level_key('a = 1\nhint_add = ["""x\n"""]\n', "hint_add"), /does not rewrite/);
});

test("quotes, backslashes, control characters, a hash and non-ASCII come back from a parse as written", () => {
  const values = ['[data-label="a\\b"]', "line one\nline\ttwo\r\u0001\u007f", "# not a comment", "é 東京 🌵  ", ['say "next"', "a\\b", "#", "tab\there"]] as const;
  for (const value of values) {
    const text = set_top_level_key('a = 1 # keep\n[[site_rules]]\nsite = "x"\n', "scroll_selector", value);
    assert.deepEqual(parse(text).scroll_selector, value, JSON.stringify(value));
    assert.ok(text.startsWith("a = 1 # keep\nscroll_selector = ") && text.endsWith('[[site_rules]]\nsite = "x"\n'), text);
  }
});
