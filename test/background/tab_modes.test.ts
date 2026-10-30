import assert from "node:assert/strict";
import { test } from "node:test";
import { forget_tab_mode, recall_tab_mode, remember_tab_mode, shortcut_allowed } from "../../src/background/tab_modes.ts";

function fake_storage() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(data, items),
    remove: async (key: string) => void delete data[key],
  } as unknown as Parameters<typeof remember_tab_mode>[0] & { data: Record<string, unknown> };
}

test("a tab's mode is stored, defaults to normal and is removed with the tab", async () => {
  const storage = fake_storage();
  assert.equal(await recall_tab_mode(storage, 4), "normal");
  await remember_tab_mode(storage, 4, "ignore");
  assert.equal(await recall_tab_mode(storage, 4), "ignore");
  await forget_tab_mode(storage, 4);
  assert.deepEqual(storage.data, {});
});

test("in ignore mode only a shortcut that can run there goes through", () => {
  const commands = { "tab.next": { modes: ["normal"] }, "mode.leave": { modes: ["normal", "ignore"] } } as const;
  const get = (id: string) => (commands as Record<string, { modes: readonly ("normal" | "ignore")[] }>)[id];
  assert.equal(shortcut_allowed("ignore", [{ id: "tab.next" }], get), false);
  assert.equal(shortcut_allowed("ignore", [{ id: "mode.leave" }], get), true);
  assert.equal(shortcut_allowed("normal", [{ id: "tab.next" }], get), true);
});
