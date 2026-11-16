import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_FONT_ITEMS, MAX_FONT_LENGTH, parse_font_family } from "../../src/shared/theme/font_family.ts";

test("parse_font_family writes names quoted and generic keywords bare", () => {
  assert.equal(parse_font_family("Fira Code, monospace"), '"Fira Code", monospace');
  assert.equal(parse_font_family(`'JetBrains Mono' ,  "Noto Sans CJK JP", Sans-Serif`), '"JetBrains Mono", "Noto Sans CJK JP", sans-serif');
  assert.equal(parse_font_family('"Source Code Pro 2", system-ui'), '"Source Code Pro 2", system-ui');
});

test("parse_font_family takes names that are not CSS identifiers, bare or quoted", () => {
  assert.equal(parse_font_family("3270 Nerd Font"), '"3270 Nerd Font"');
  assert.equal(parse_font_family("0xProto Nerd Font, monospace"), '"0xProto Nerd Font", monospace');
  assert.equal(parse_font_family("Font Awesome 6 Free"), '"Font Awesome 6 Free"');
  assert.equal(parse_font_family("Source Sans 3"), '"Source Sans 3"');
  assert.equal(parse_font_family("M+ 1m"), '"M+ 1m"');
  assert.equal(parse_font_family("Noto Sans 日本"), '"Noto Sans 日本"');
  assert.equal(parse_font_family('"Source   Sans 3"'), '"Source Sans 3"');
  assert.equal(parse_font_family('"serif"'), '"serif"');
});

test("parse_font_family reads an empty value as unset", () => {
  assert.equal(parse_font_family(""), "");
  assert.equal(parse_font_family("   "), "");
});

test("parse_font_family refuses text that could leave the declaration", () => {
  for (const bad of ['a"b', '"a\\b"', '"a\nb"', "a\nb", '"a<b"', '"a{b"', '"a}b"', '"a;b"', "Foo /* x */", "var(--x)", "URL(x)", "Foo !important", "a, , b", "a,", '""', "Foo;", "a\"b", "'a", "x\\y", 5, undefined, null]) {
    assert.equal(parse_font_family(bad), undefined, JSON.stringify(bad));
  }
});

test("parse_font_family caps the item count and the length", () => {
  const names = (count: number) => Array.from({ length: count }, (_, index) => `F${index}`).join(", ");
  assert.notEqual(parse_font_family(names(MAX_FONT_ITEMS)), undefined);
  assert.equal(parse_font_family(names(MAX_FONT_ITEMS + 1)), undefined);
  assert.equal(parse_font_family(`"${"a".repeat(MAX_FONT_LENGTH)}"`), undefined);
});

test("parse_font_family keeps a bare generic keyword unquoted", () => {
  for (const keyword of ["monospace", "sans-serif", "system-ui", "ui-monospace", "serif"]) assert.equal(parse_font_family(keyword), keyword);
  assert.equal(parse_font_family("Fira Code, sans-serif"), '"Fira Code", sans-serif');
});
