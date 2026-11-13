import assert from "node:assert/strict";
import { test } from "node:test";
import { create_keymap_source, stored_keymap } from "../../src/background/keymap_source.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap } from "../../src/shared/prefix_tree.ts";

const map = (label: string) => ({ label }) as unknown as CompiledKeymap;
const label_of = (keymap: CompiledKeymap | undefined) => (keymap as unknown as { label?: string } | undefined)?.label;

// A storage whose reads wait for the test to release them, and an event the test fires by hand. `publish` writes and fires like the browser, with the event after the write.
function make() {
  let stored: unknown;
  const waiting: (() => void)[] = [];
  let hold = false;
  let fail_next = false;
  let reads = 0;
  const listeners: ((changes: Record<string, unknown>, area: string) => void)[] = [];
  const storage = {
    get: async (key: string) => {
      reads++;
      if (fail_next) {
        fail_next = false;
        throw new Error("storage unavailable");
      }
      const snapshot = { [key]: stored };
      if (hold) await new Promise<void>((resolve) => waiting.push(resolve));
      return snapshot;
    },
  };
  const changed = { addListener: (listener: (typeof listeners)[number]) => void listeners.push(listener) };
  const fire = (area = "local", key = COMPILED_KEYMAP_STORAGE_KEY) => listeners.forEach((listener) => listener({ [key]: {} }, area));
  return {
    storage: storage as never,
    changed: changed as never,
    reads: () => reads,
    set_stored: (value: unknown) => void (stored = value),
    publish: (value: unknown) => {
      stored = value;
      fire();
    },
    fire,
    hold: () => void (hold = true),
    release: () => {
      hold = false;
      waiting.splice(0).forEach((resolve) => resolve());
    },
    fail_next: () => void (fail_next = true),
  };
}

test("the second read comes from memory", async () => {
  const fake = make();
  fake.set_stored(map("a"));
  const source = create_keymap_source(fake.storage, fake.changed);
  assert.equal(label_of(await source.read()), "a");
  assert.equal(label_of(await source.read()), "a");
  assert.equal(fake.reads(), 1);
});

test("a hundred frames asking at once on a cold cache cost one storage read", async () => {
  const fake = make();
  fake.set_stored(map("a"));
  const source = create_keymap_source(fake.storage, fake.changed);
  const all = Promise.all(Array.from({ length: 100 }, () => source.read()));
  assert.equal(fake.reads(), 1);
  assert.ok((await all).every((keymap) => label_of(keymap) === "a"));
  assert.equal(fake.reads(), 1);
});

test("a change that fires during a fill read does not leave the stale map", async () => {
  const fake = make();
  fake.set_stored(map("old"));
  const source = create_keymap_source(fake.storage, fake.changed);
  fake.hold();
  const late = source.read();
  fake.publish(map("new"));
  fake.release();
  assert.equal(label_of(await late), "new");
  assert.equal(label_of(await source.read()), "new");
});

test("a publish followed at once by a read returns the new map", async () => {
  const fake = make();
  fake.set_stored(map("old"));
  const source = create_keymap_source(fake.storage, fake.changed);
  assert.equal(label_of(await source.read()), "old");
  fake.publish(map("new"));
  assert.equal(label_of(await source.read()), "new");
});

test("a change to another key or another area keeps the copy", async () => {
  const fake = make();
  fake.set_stored(map("a"));
  const source = create_keymap_source(fake.storage, fake.changed);
  await source.read();
  fake.fire("local", "something_else");
  fake.fire("session");
  await source.read();
  assert.equal(fake.reads(), 1);
});

test("a background restart starts empty and refills", async () => {
  const fake = make();
  fake.set_stored(map("a"));
  await create_keymap_source(fake.storage, fake.changed).read();
  const restarted = create_keymap_source(fake.storage, fake.changed);
  assert.equal(fake.reads(), 1);
  assert.equal(label_of(await restarted.read()), "a");
  assert.equal(fake.reads(), 2);
});

test("a failed read rejects every waiter and the next read tries again", async () => {
  const fake = make();
  fake.set_stored(map("a"));
  const source = create_keymap_source(fake.storage, fake.changed);
  fake.fail_next();
  const waiters = [source.read(), source.read()];
  await Promise.all(waiters.map((waiter) => assert.rejects(waiter, /unavailable/)));
  assert.equal(label_of(await source.read()), "a");
});

test("an empty store is cached as empty", async () => {
  const fake = make();
  const source = create_keymap_source(fake.storage, fake.changed);
  assert.equal(await source.read(), undefined);
  await source.read();
  assert.equal(fake.reads(), 1);
});

test("a storage that is not the browser's reads straight through", async () => {
  const fake = make();
  fake.set_stored(map("a"));
  assert.equal(label_of(await stored_keymap(fake.storage)), "a");
  fake.set_stored(map("b"));
  assert.equal(label_of(await stored_keymap(fake.storage)), "b");
});
