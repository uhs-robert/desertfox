import assert from "node:assert/strict";
import { test } from "node:test";
import { make_register_handlers } from "../../src/commands/register.ts";
import { create_register_store } from "../../src/background/register_store.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import type { CommandContext } from "../../src/shared/command.ts";

const CTX: CommandContext = { tab_id: 1, window_id: 1, frame_id: 0, mode: "normal" };

function make({ private_window = false, clipboard = "" } = {}) {
  const values = new Map<string, unknown>();
  const area = {
    get: async (keys?: string | string[] | null) => Object.fromEntries([keys ?? []].flat().filter((key) => values.has(key as string)).map((key) => [key, values.get(key as string)])),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => values.set(key, value)),
    remove: async () => undefined,
  } as never;
  const store = create_register_store({ local: () => area, session: () => area, clipboard: { read: async () => clipboard, write: async () => undefined } });
  const toasts: string[] = [];
  const handlers = make_register_handlers({ store, is_private: async () => private_window, toast: async (_ctx, _kind, message) => void toasts.push(message) });
  return { store, handlers, toasts };
}

test("with no name, one toast names every register that holds something", async () => {
  const { store, handlers, toasts } = make();
  await store.write("a", "hello", false);
  await store.write("b", [{ id: "tab.next" }, { id: "tab.prev" }], false);
  await handlers.list(CTX, {});
  assert.deepEqual(toasts, ["a hello   b 2 steps"]);
});

test("with a name, the toast shows that register", async () => {
  const { store, handlers, toasts } = make();
  await store.write("a", "one\ntwo", false);
  await handlers.list(CTX, { name: " A " });
  assert.deepEqual(toasts, ["A one two"]);
});

test("a list with nothing to show and an empty register refuse", async () => {
  const { handlers } = make();
  await assert.rejects(handlers.list(CTX, {}), /No register holds anything/);
  await assert.rejects(handlers.list(CTX, { name: "a" }), /Register a is empty/);
});

test("the plus register shows the clipboard", async () => {
  const { handlers, toasts } = make({ clipboard: "copied" });
  await handlers.list(CTX, { name: "+" });
  assert.deepEqual(toasts, ["+ copied"]);
});

test("a private window lists its own registers", async () => {
  const { store, handlers, toasts } = make({ private_window: true });
  await store.write("a", "normal", false);
  await store.write("a", "private", true);
  await handlers.list(CTX, {});
  assert.deepEqual(toasts, ["a private"]);
});

test("the schema takes a register name or none, and refuses anything else", () => {
  const command = registry.get("register.list");
  assert.ok(command);
  for (const name of ["a", "Z", '"', "+", "_", "/", "/:direction"]) assert.ok(check_args(command, { name }, {}).ok, name);
  assert.ok(check_args(command, {}, {}).ok);
  for (const name of ["ab", "1", "@"]) assert.ok(!check_args(command, { name }, {}).ok, name);
});
