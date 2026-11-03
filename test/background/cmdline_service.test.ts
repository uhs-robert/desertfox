import assert from "node:assert/strict";
import { test } from "node:test";
import { add_to_history, create_cmdline_service, HISTORY_LIMIT } from "../../src/background/cmdline_service.ts";

function make() {
  const data: Record<string, unknown> = {};
  const storage = {
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(data, items),
  } as unknown as Parameters<typeof create_cmdline_service>[0]["storage"];
  const service = create_cmdline_service({ storage, sources: async () => ({ search_engines: ["arch"], containers: [] }) });
  return { service };
}

test("history keeps order, oldest first", async () => {
  const { service } = make();
  for (const text of ["a", "b", "c"]) await service.record(text, false);
  assert.deepEqual((await service.open()).history, ["a", "b", "c"]);
});

test("history keeps the last 100 and drops the oldest", async () => {
  const { service } = make();
  for (let index = 0; index < HISTORY_LIMIT + 5; index++) await service.record(`cmd ${index}`, false);
  const { history } = await service.open();
  assert.equal(history.length, HISTORY_LIMIT);
  assert.equal(history[0], "cmd 5");
  assert.equal(history.at(-1), `cmd ${HISTORY_LIMIT + 4}`);
});

test("nothing from a private window is stored", async () => {
  const { service } = make();
  await service.record("secret", true);
  await service.record("open", false);
  assert.deepEqual((await service.open()).history, ["open"]);
});

test("a repeated command moves to the newest place", () => {
  assert.deepEqual(add_to_history(["a", "b", "c"], "a"), ["b", "c", "a"]);
});

test("records sent without waiting all land, in order", async () => {
  const { service } = make();
  await Promise.all(["a", "b", "c", "d"].map((text) => service.record(text, false)));
  assert.deepEqual((await service.open()).history, ["a", "b", "c", "d"]);
});

test("opening returns the lists that bare words read from", async () => {
  const { service } = make();
  assert.deepEqual((await service.open()).sources, { search_engines: ["arch"], containers: [] });
});
