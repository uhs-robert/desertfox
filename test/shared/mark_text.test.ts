import assert from "node:assert/strict";
import { test } from "node:test";
import { mark_list_rows, quickmark_list_rows } from "../../src/shared/mark_text.ts";

test("the marks rows leave out the previous position and keep the page's marks before the global ones", () => {
  const rows = mark_list_rows([{ key: "b", x: 0, y: 5 }, { key: "'", x: 0, y: 1 }, { key: "a", x: 3, y: 9 }, { key: "G", x: 0, y: 7, url: "https://github.com/x" }]);
  assert.deepEqual(rows, [
    { name: "b", description: "y 5" },
    { name: "a", description: "x 3 y 9" },
    { name: "G", description: "github.com/x  y 7" },
  ]);
});

test("the quickmark rows sort by key and drop the scheme", () => {
  assert.deepEqual(quickmark_list_rows({ w: "https://wiki.test", 3: "http://three.test", g: "https://github.com" }), [
    { name: "3", description: "three.test" },
    { name: "g", description: "github.com" },
    { name: "w", description: "wiki.test" },
  ]);
});
