import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { get_register_, set_register_ } from "../../../src/content/caret/registers.ts";

const stored = new Map<string, unknown>();
let incognito = false;
Object.assign(globalThis, {
  browser: {
    extension: { get inIncognitoContext() { return incognito; } },
    storage: {
      local: {
        get: async (key: string) => (stored.has(key) ? { [key]: stored.get(key) } : {}),
        set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => stored.set(key, value)),
      },
    },
  },
});

beforeEach(() => {
  stored.clear();
  incognito = false;
});

test("register / reads back what was set", async () => {
  await set_register_("/", "needle");
  assert.equal(await get_register_("/"), "needle");
  assert.deepEqual([...stored.values()], ["needle"]);
});

test("an unset register reads as undefined", async () => {
  assert.equal(await get_register_("never_set"), undefined);
});

test("a private window keeps a register in memory only", async () => {
  incognito = true;
  await set_register_("private_one", "secret");
  assert.equal(await get_register_("private_one"), "secret");
  assert.equal(stored.size, 0);
});
