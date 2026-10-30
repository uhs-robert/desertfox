import assert from "node:assert/strict";
import { test } from "node:test";
import { merge_keymaps } from "../../src/background/keymap_merge.ts";

test("user binding overrides default and null removes one", () => {
  const merged = merge_keymaps(
    { normal: { J: { id: "tab.next" }, K: { id: "tab.prev" }, x: { id: "tab.close" } } },
    { normal: { J: { id: "tab.prev" }, K: null } },
  );
  assert.deepEqual(merged.normal, { J: { id: "tab.prev" }, x: { id: "tab.close" } });
});

test("modes from either side survive and generators come from the user", () => {
  const merged = merge_keymaps({ browser: { "<A-j>": { id: "tab.next" } } }, { insert: {}, search_keys: { a: "arch" } });
  assert.deepEqual(merged.browser, { "<A-j>": { id: "tab.next" } });
  assert.deepEqual(merged.insert, {});
  assert.deepEqual(merged.search_keys, { a: "arch" });
  assert.equal(merged.container_keys, undefined);
});
