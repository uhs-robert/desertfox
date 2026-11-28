import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_HEADING_CHARS, MAX_HEADINGS, MAX_HEADINGS_BYTES, parse_page_headings } from "../../src/shared/browser_module_headings.ts";

test("the module's heading rows are read as level and cleaned text, and a bad entry is skipped", () => {
  const value = JSON.stringify([[1, " Title\u0000\n x "], [7, "no"], [0, "no"], [2.5, "no"], ["2", "no"], [2], [3, 4], [2, "x".repeat(300)], "junk", null]);
  const rows = parse_page_headings(value)!;
  assert.deepEqual(rows[0], { level: 1, text: "Title x" });
  assert.equal(rows.length, 2);
  assert.equal(rows[1]!.text.length, MAX_HEADING_CHARS);
});

test("a reply that is not a list, not JSON, missing or over the byte cap is refused whole, and only the first MAX_HEADINGS rows are read", () => {
  for (const bad of [undefined, "", "{", "{}", "3", JSON.stringify([[1, "x".repeat(MAX_HEADINGS_BYTES)]])]) assert.equal(parse_page_headings(bad), undefined, String(bad).slice(0, 20));
  const many = JSON.stringify(Array.from({ length: MAX_HEADINGS + 50 }, () => [2, "h"]));
  assert.equal(parse_page_headings(many)?.length, MAX_HEADINGS);
});
