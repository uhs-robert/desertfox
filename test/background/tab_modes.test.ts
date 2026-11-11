import assert from "node:assert/strict";
import { test } from "node:test";
import { forget_all_tab_modes, forget_mode_on_navigation, forget_tab_mode, recall_tab_mode, remember_reported_mode, remember_tab_mode, shortcut_allowed, read_insert_hold, write_insert_hold } from "../../src/background/tab_modes.ts";

function fake_storage() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (key: string | null) => (key === null ? { ...data } : key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(data, items),
    remove: async (keys: string | string[]) => void [keys].flat().forEach((key) => delete data[key]),
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
  assert.equal(shortcut_allowed("ignore", [{ id: "tab.next" }], get, false), false);
  assert.equal(shortcut_allowed("ignore", [{ id: "mode.leave" }], get, false), true);
  assert.equal(shortcut_allowed("normal", [{ id: "tab.next" }], get, false), true);
});

test("loading a new page forgets the tab's mode, other updates keep it", async () => {
  const storage = fake_storage();
  await remember_tab_mode(storage, 4, "ignore");
  await forget_mode_on_navigation(storage, 4, { status: "complete" });
  assert.equal(await recall_tab_mode(storage, 4), "ignore");
  await forget_mode_on_navigation(storage, 4, { status: "loading" });
  assert.equal(await recall_tab_mode(storage, 4), "normal");
});

test("starting the background clears every tab mode and nothing else", async () => {
  const storage = fake_storage();
  await remember_tab_mode(storage, 4, "ignore");
  await remember_tab_mode(storage, 9, "insert");
  await storage.set({ other_key: 1 });
  await forget_all_tab_modes(storage);
  assert.deepEqual(storage.data, { other_key: 1 });
});

test("only the top frame's report sets the tab's mode", async () => {
  const storage = fake_storage();
  await remember_reported_mode(storage, 4, 0, "ignore");
  await remember_reported_mode(storage, 4, 3, "insert");
  assert.equal(await recall_tab_mode(storage, 4), "ignore");
});

test("while off no shortcut runs, ignore-capable ones included", () => {
  const get = () => ({ modes: ["normal", "ignore"] as const });
  assert.equal(shortcut_allowed("normal", [{ id: "tab.next" }], get, true), false);
  assert.equal(shortcut_allowed("ignore", [{ id: "mode.leave" }], get, true), false);
});

test("a navigation ends the insert hold", async () => {
  const storage = fake_storage();
  await write_insert_hold(storage, 4);
  await forget_mode_on_navigation(storage, 4, { status: "loading" });
  assert.equal(await read_insert_hold(storage, 4), false);
});
