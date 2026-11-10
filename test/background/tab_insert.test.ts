import assert from "node:assert/strict";
import { test } from "node:test";
import { create_tab_insert } from "../../src/background/tab_insert.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";

const compiled = { format_version: COMPILED_KEYMAP_VERSION, modes: {}, mode_indicator: "badge", which_key_delay_ms: 0, site_rules: [{ regex: "^https://quiet\\.test/", all_off: true }] };

// Each storage call takes a few ticks, like the real one, so operations that are not ordered interleave.
const ticks = async () => {
  for (let tick = 0; tick < 5; tick++) await Promise.resolve();
};

function make(options: { cleared?: Promise<unknown> } = {}) {
  const data: Record<string, unknown> = { [COMPILED_KEYMAP_STORAGE_KEY]: compiled };
  const sent: string[] = [];
  const keymap_reads: string[] = [];
  const storage = {
    get: async (key: string) => {
      if (key === COMPILED_KEYMAP_STORAGE_KEY) keymap_reads.push(key);
      await ticks();
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    set: async (items: Record<string, unknown>) => {
      await ticks();
      Object.assign(data, items);
    },
    remove: async (key: string) => {
      await ticks();
      delete data[key];
    },
  };
  const tab_insert = create_tab_insert({
    storage: storage as never,
    modes_cleared: options.cleared ?? Promise.resolve(),
    frames: async () => [
      { frame_id: 0, url: "https://site.test/" },
      { frame_id: 1, url: "https://quiet.test/embed" },
      { frame_id: 2, url: "https://site.test/frame" },
    ],
    tab_url: async () => "https://site.test/",
    send_mode: async (tab_id, frame_id, mode) => void sent.push(`${tab_id}:${frame_id}:${mode}`),
  });
  return { tab_insert, sent, data, keymap_reads };
}

test("enter switches every frame except one under an all-off rule, and leave returns only those frames", async () => {
  const { tab_insert, sent } = make();
  await tab_insert.enter(4);
  assert.deepEqual(sent.sort(), ["4:0:insert", "4:2:insert"]);
  sent.length = 0;
  await tab_insert.leave(4);
  assert.deepEqual(sent.sort(), ["4:0:normal", "4:2:normal"]);
  sent.length = 0;
  await tab_insert.leave(4);
  assert.deepEqual(sent, []);
});

test("a frame that loads during the hold joins it and goes back to normal on leave", async () => {
  const { tab_insert, sent } = make();
  assert.equal(await tab_insert.join(4, 9), false);
  await tab_insert.enter(4);
  assert.equal(await tab_insert.join(4, 9), true);
  sent.length = 0;
  await tab_insert.leave(4);
  assert.deepEqual(sent.sort(), ["4:0:normal", "4:2:normal", "4:9:normal"]);
});

test("the hold and the switch wait until the modes of the last session are forgotten", async () => {
  let release!: () => void;
  const { tab_insert, sent } = make({ cleared: new Promise((resolve) => (release = () => resolve(undefined))) });
  const joined = tab_insert.join(4, 0);
  const entered = tab_insert.enter(4);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(sent, []);
  release();
  assert.equal(await joined, false);
  await entered;
  assert.equal(sent.length, 2);
});

test("enter reads the keymap once for all frames", async () => {
  const { tab_insert, keymap_reads } = make();
  await tab_insert.enter(4);
  assert.equal(keymap_reads.length, 1);
});

test("two frames that join at once both enter the hold", async () => {
  const { tab_insert, sent } = make();
  await tab_insert.enter(4);
  assert.deepEqual(await Promise.all([tab_insert.join(4, 5), tab_insert.join(4, 6)]), [true, true]);
  sent.length = 0;
  await tab_insert.leave(4);
  assert.deepEqual(sent.sort(), ["4:0:normal", "4:2:normal", "4:5:normal", "4:6:normal"]);
});

test("Escape on the top page: leave sent before the report still returns every frame", async () => {
  const { tab_insert, sent } = make();
  await tab_insert.enter(4);
  sent.length = 0;
  await Promise.all([tab_insert.leave(4), tab_insert.end_by_report(4)]);
  assert.deepEqual(sent.sort(), ["4:0:normal", "4:2:normal"]);
});

test("a report that the top frame left insert ends the hold without switching frames", async () => {
  const { tab_insert, sent } = make();
  await tab_insert.enter(4);
  sent.length = 0;
  await tab_insert.end_by_report(4);
  assert.equal(await tab_insert.join(4, 5), false);
  await tab_insert.leave(4);
  assert.deepEqual(sent, []);
});
