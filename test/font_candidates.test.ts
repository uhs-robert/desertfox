import assert from "node:assert/strict";
import { test } from "node:test";
import { FONT_CANDIDATES, MAX_FONT_NAMES, merge_font_names, probe_fonts } from "../src/shared/font_candidates.ts";
import type { MeasureWidth } from "../src/shared/font_candidates.ts";
import { parse_font_family } from "../src/shared/theme/font_family.ts";

// A browser that has the named fonts: a font shorthand with a quoted installed name measures differently from the bare generic it falls back to.
const browser_with = (installed: string[]): MeasureWidth => (font) => {
  const name = /"([^"]+)"/.exec(font)?.[1];
  const generic = font.endsWith("monospace") ? 600 : 500;
  return name !== undefined && installed.includes(name) ? generic + 37 : generic;
};

test("the probe keeps the candidates the browser has", () => {
  assert.deepEqual(probe_fonts(["Fira Code", "Nope Sans", "Hack"], browser_with(["Hack", "Fira Code"])), ["Fira Code", "Hack"]);
});

test("a browser with none of the fonts gives an empty list", () => {
  assert.deepEqual(probe_fonts(FONT_CANDIDATES, browser_with([])), []);
});

test("a name that matches one generic's width is still found by the other generic", () => {
  const measure: MeasureWidth = (font) => (font.includes('"Odd"') ? (font.endsWith("monospace") ? 600 : 520) : font.endsWith("monospace") ? 600 : 500);
  assert.deepEqual(probe_fonts(["Odd"], measure), ["Odd"]);
});

test("every built-in candidate is a name the font setting accepts, once", () => {
  for (const name of FONT_CANDIDATES) assert.notEqual(parse_font_family(name), undefined, name);
  assert.equal(new Set(FONT_CANDIDATES.map((name) => name.toLowerCase())).size, FONT_CANDIDATES.length);
});

test("merge puts the host's spelling first, drops repeats and names the setting refuses, and sorts", () => {
  assert.deepEqual(merge_font_names(["noto sans", "Cantarell", 'Bad"Name', "Two,Names", ""], ["Noto Sans", "hack"]), ["Cantarell", "hack", "noto sans"]);
});

test("merge cuts the list to the cap", () => {
  const many = Array.from({ length: MAX_FONT_NAMES + 50 }, (_, index) => `Font ${String(index).padStart(5, "0")}`);
  assert.equal(merge_font_names(many).length, MAX_FONT_NAMES);
});
