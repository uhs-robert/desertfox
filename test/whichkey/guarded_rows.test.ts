import assert from "node:assert/strict";
import { test } from "node:test";
import { rows_for_page } from "../../src/content/whichkey/guarded_rows.ts";
import type { TreeLeaf } from "../../src/shared/prefix_tree.ts";
import type { WhichKeyRow } from "../../src/shared/messages.ts";

const row = (keys: string, command: string, chain?: TreeLeaf): WhichKeyRow => ({ keys, command, description: "", more: false, ...(chain ? { chain } : {}) });
const guarded: TreeLeaf = { kind: "leaf", steps: [], when_present: "#tree" };
const rows = [row("j", "Down"), row("za", "Fold", guarded), row("h", "Parent, else left", { ...guarded, otherwise: { kind: "leaf", steps: [], label: "Left" } })];
const body = {} as Element;
const root_with = (shown: boolean) => ({ querySelectorAll: () => (shown ? [{ checkVisibility: () => true, getClientRects: () => [{}] }] : []) }) as unknown as ParentNode;

test("a row whose guard fails with no fallback is dropped, and one with a fallback shows the fallback label", () => {
  assert.deepEqual(rows_for_page(rows, null, body, root_with(false)).map((entry) => [entry.keys, entry.command]), [["j", "Down"], ["h", "Left"]]);
});

test("rows whose guard holds keep their own label", () => {
  assert.deepEqual(rows_for_page(rows, null, body, root_with(true)).map((entry) => [entry.keys, entry.command]), [["j", "Down"], ["za", "Fold"], ["h", "Parent, else left"]]);
});

test("when every row is guarded and fails the list is empty", () => {
  assert.deepEqual(rows_for_page([rows[1]!], null, body, root_with(false)), []);
});
