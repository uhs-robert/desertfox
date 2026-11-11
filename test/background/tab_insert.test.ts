import assert from "node:assert/strict";
import { test } from "node:test";
import { create_tab_insert } from "../../src/background/tab_insert.ts";
import { read_insert_hold } from "../../src/background/tab_modes.ts";

// Each storage call takes a few ticks, like the real one, so operations that are not ordered interleave.
const ticks = async () => {
  for (let tick = 0; tick < 5; tick++) await Promise.resolve();
};

function make(options: { cleared?: Promise<unknown>; send_fails?: boolean } = {}) {
  const data: Record<string, unknown> = {};
  const sent: string[] = [];
  const storage = {
    get: async (key: string) => {
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
    send_mode: async (tab_id, mode) => {
      sent.push(`${tab_id}:${mode}`);
      if (options.send_fails) throw new Error("Could not establish connection. Receiving end does not exist.");
    },
  });
  return { tab_insert, sent, data, storage };
}

test("enter sends insert once to the whole tab, and leave sends normal once, then nothing", async () => {
  const { tab_insert, sent } = make();
  await tab_insert.enter(4);
  assert.deepEqual(sent, ["4:insert"]);
  sent.length = 0;
  await tab_insert.leave(4);
  assert.deepEqual(sent, ["4:normal"]);
  sent.length = 0;
  await tab_insert.leave(4);
  assert.deepEqual(sent, []);
});

test("a tab with no content script still holds, and a failed send does not reject enter or leave", async () => {
  const { tab_insert, storage } = make({ send_fails: true });
  await tab_insert.enter(4);
  assert.equal(await read_insert_hold(storage as never, 4), true);
  await tab_insert.leave(4);
  assert.equal(await read_insert_hold(storage as never, 4), false);
});

test("a frame that loads during the hold joins it, and one that loads after leave does not", async () => {
  const { tab_insert, sent } = make();
  assert.equal(await tab_insert.join(4, 9), false);
  await tab_insert.enter(4);
  assert.equal(await tab_insert.join(4, 9), true);
  sent.length = 0;
  await tab_insert.leave(4);
  assert.deepEqual(sent, ["4:normal"]);
  assert.equal(await tab_insert.join(4, 10), false);
});

test("holds are kept per tab", async () => {
  const { tab_insert, sent } = make();
  await tab_insert.enter(4);
  assert.equal(await tab_insert.join(5, 0), false);
  await tab_insert.leave(5);
  assert.deepEqual(sent, ["4:insert"]);
  assert.equal(await tab_insert.join(4, 0), true);
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
  assert.deepEqual(sent, ["4:insert"]);
});

test("frames that join at once all see the hold", async () => {
  const { tab_insert, sent } = make();
  await tab_insert.enter(4);
  assert.deepEqual(await Promise.all([tab_insert.join(4, 5), tab_insert.join(4, 6)]), [true, true]);
  sent.length = 0;
  await tab_insert.leave(4);
  assert.deepEqual(sent, ["4:normal"]);
});

test("Escape on the top page returns the tab whichever of leave and the report arrives first, and only once", async () => {
  for (const order of ["leave first", "report first"]) {
    const { tab_insert, sent } = make();
    await tab_insert.enter(4);
    sent.length = 0;
    const steps = [() => tab_insert.leave(4), () => tab_insert.top_frame_left_insert(4, "normal")];
    if (order === "report first") steps.reverse();
    await Promise.all(steps.map((step) => step()));
    assert.deepEqual(sent, ["4:normal"], order);
  }
});

test("a leave sent right after enter goes out after the insert, never before", async () => {
  const { tab_insert, sent } = make();
  await Promise.all([tab_insert.enter(4), tab_insert.leave(4)]);
  assert.deepEqual(sent, ["4:insert", "4:normal"]);
});

test("a top frame report of ignore ends the hold without sending", async () => {
  const { tab_insert, sent } = make();
  await tab_insert.enter(4);
  sent.length = 0;
  await tab_insert.top_frame_left_insert(4, "ignore");
  assert.equal(await tab_insert.join(4, 5), false);
  await tab_insert.leave(4);
  assert.deepEqual(sent, []);
});
