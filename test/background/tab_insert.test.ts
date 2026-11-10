import assert from "node:assert/strict";
import { test } from "node:test";
import { create_tab_insert } from "../../src/background/tab_insert.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";

const compiled = { format_version: COMPILED_KEYMAP_VERSION, modes: {}, mode_indicator: "badge", which_key_delay_ms: 0, site_rules: [{ regex: "^https://quiet\\.test/", all_off: true }] };

function make(options: { cleared?: Promise<unknown> } = {}) {
  const data: Record<string, unknown> = { [COMPILED_KEYMAP_STORAGE_KEY]: compiled };
  const sent: string[] = [];
  const storage = {
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(data, items),
    remove: async (key: string) => void delete data[key],
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
  return { tab_insert, sent, data };
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
