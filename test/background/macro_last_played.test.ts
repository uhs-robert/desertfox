import assert from "node:assert/strict";
import { test } from "node:test";
import { create_last_played } from "../../src/background/macro_last_played.ts";

function make() {
  const values = new Map<string, unknown>();
  const area = {
    get: async (key: string) => (values.has(key) ? { [key]: values.get(key) } : {}),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => values.set(key, value)),
    remove: async (key: string) => void values.delete(key),
  } as never;
  return create_last_played({ session: () => area });
}

test("a normal and a private pointer are kept apart", async () => {
  const pointer = make();
  await pointer.write("a", false);
  assert.equal(await pointer.read(true), undefined);
  await pointer.write("b", true);
  assert.deepEqual([await pointer.read(false), await pointer.read(true)], ["a", "b"]);
});

test("the private pointer clears with the last private window and the normal one stays", async () => {
  const pointer = make();
  await pointer.write("a", false);
  await pointer.write("b", true);
  await pointer.clear_private_without_window(async () => true);
  assert.equal(await pointer.read(true), "b");
  await pointer.clear_private_without_window(async () => false);
  assert.deepEqual([await pointer.read(false), await pointer.read(true)], ["a", undefined]);
});
