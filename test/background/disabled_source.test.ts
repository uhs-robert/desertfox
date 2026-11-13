import assert from "node:assert/strict";
import { test } from "node:test";
import { create_disabled_source } from "../../src/background/browser_deps.ts";
import { DISABLED_STORAGE_KEY } from "../../src/background/storage_keys.ts";

// A storage whose reads wait for the test to release them, and an event the test fires by hand.
function make(initial: boolean | undefined) {
  let stored = initial;
  let reads = 0;
  let hold = false;
  const waiting: (() => void)[] = [];
  const listeners: ((changes: Record<string, { newValue?: unknown }>, area: string) => void)[] = [];
  const storage = {
    get: async (key: string) => {
      reads++;
      const snapshot = stored === undefined ? {} : { [key]: stored };
      if (hold) await new Promise<void>((resolve) => waiting.push(resolve));
      return snapshot;
    },
  };
  const changed = { addListener: (listener: (typeof listeners)[number]) => void listeners.push(listener) };
  return {
    read: create_disabled_source(storage as never, changed as never),
    reads: () => reads,
    change: (value: boolean | undefined) => {
      stored = value;
      listeners.forEach((listener) => listener({ [DISABLED_STORAGE_KEY]: { newValue: value } }, "local"));
    },
    hold: () => void (hold = true),
    release: () => {
      hold = false;
      waiting.splice(0).forEach((resolve) => resolve());
    },
  };
}

test("the first read asks storage, later reads come from memory", async () => {
  const fake = make(true);
  assert.equal(await fake.read(), true);
  assert.equal(await fake.read(), true);
  assert.equal(fake.reads(), 1);
});

test("a key before the first fill reads storage, and a burst shares that one read", async () => {
  const fake = make(true);
  fake.hold();
  const first = fake.read();
  const second = fake.read();
  fake.release();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(fake.reads(), 1);
});

test("the flag follows storage.onChanged from on to off and back", async () => {
  const fake = make(undefined);
  assert.equal(await fake.read(), false);
  fake.change(true);
  assert.equal(await fake.read(), true);
  fake.change(undefined);
  assert.equal(await fake.read(), false);
  fake.change(true);
  assert.equal(await fake.read(), true);
  assert.equal(fake.reads(), 1);
});

test("a change during the first fill wins over the stale read", async () => {
  const fake = make(undefined);
  fake.hold();
  const pending = fake.read();
  fake.change(true);
  fake.release();
  assert.equal(await pending, true);
  assert.equal(await fake.read(), true);
});

test("a new source starts empty, as a restarted background does", async () => {
  const before = make(true);
  assert.equal(await before.read(), true);
  const after = make(undefined);
  assert.equal(await after.read(), false);
  assert.equal(after.reads(), 1);
});
