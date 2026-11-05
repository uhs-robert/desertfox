import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ROW_TEXT, row_of } from "../../src/content/hints/list_view.ts";

const heading = (local: string, text: string, level?: string) =>
  ({ localName: local, textContent: text, innerText: text, getAttribute: (name: string) => (name === "aria-level" ? (level ?? null) : null) }) as unknown as Element;

test("a row holds the level and the text with its whitespace collapsed", () => {
  assert.deepEqual(row_of(heading("h3", "  Install\n   the   tool ")), { level: 3, text: "Install the tool" });
});

test("a long heading is cut with dots", () => {
  const { text } = row_of(heading("h1", "x".repeat(MAX_ROW_TEXT + 50)));
  assert.equal(text.length, MAX_ROW_TEXT + 3);
  assert.ok(text.endsWith("..."));
});

test("a row shows the rendered text, not the script text in the heading", () => {
  const element = { localName: "h2", textContent: "Title var x = 1", innerText: "Title", getAttribute: () => null } as unknown as Element;
  assert.equal(row_of(element).text, "Title");
});
