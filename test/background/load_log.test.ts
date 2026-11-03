import assert from "node:assert/strict";
import { test } from "node:test";
import { create_load_log } from "../../src/background/load_log.ts";

// A store whose reads and writes each take a turn, so two unserialized records interleave.
function slow_storage(options: { fail_writes?: boolean } = {}) {
  const data: Record<string, unknown> = {};
  const turn = () => new Promise((resolve) => setImmediate(resolve));
  return {
    data,
    get: async (key: string) => {
      await turn();
      return { [key]: data[key] };
    },
    set: async (items: Record<string, unknown>) => {
      await turn();
      if (options.fail_writes) throw new Error("quota");
      Object.assign(data, items);
    },
  };
}

test("records made at the same time are all kept", async () => {
  const storage = slow_storage();
  const log = create_load_log(storage, "loads");
  void log.record("a");
  void log.record("b");
  await log.record("c");
  assert.deepEqual(storage.data.loads, ["a", "b", "c"]);
});

test("a failed write does not reject the record or lose later ones", async () => {
  const storage = slow_storage({ fail_writes: true });
  const log = create_load_log(storage, "loads");
  await log.record("a");
  storage.set = async (items) => void Object.assign(storage.data, items);
  await log.record("b");
  assert.deepEqual(storage.data.loads, ["b"]);
});
