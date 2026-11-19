import assert from "node:assert/strict";
import { test } from "node:test";
import { ask_item_start, create_tab_item } from "../../src/background/tab_item.ts";

// Each storage call takes a few ticks, like the real one, so operations that are not ordered interleave.
const ticks = async () => {
  for (let tick = 0; tick < 5; tick++) await Promise.resolve();
};

function make() {
  const data: Record<string, unknown> = {};
  const steps: string[] = [];
  const storage = {
    get: async (key: string) => {
      await ticks();
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    set: async (items: Record<string, unknown>) => {
      await ticks();
      Object.assign(data, structuredClone(items));
    },
    remove: async (key: string) => {
      await ticks();
      delete data[key];
    },
  };
  const tab_item = create_tab_item({
    storage: storage as never,
    send_step: async (tab_id, on, frame_id, from) => void steps.push(`${tab_id}:${on ? "on" : "off"}:${frame_id ?? "all"}${from === undefined ? "" : `:from ${from}`}`),
  });
  return { tab_item, steps, data };
}

test("the first frame to report item starts the mode in every other frame, and a second frame that reports it only joins", async () => {
  const { tab_item, steps } = make();
  await tab_item.reported(4, 0, "item");
  assert.deepEqual(steps, ["4:on:all:from 0"]);
  await tab_item.reported(4, 7, "item", true);
  assert.deepEqual(steps, ["4:on:all:from 0"]);
});

test("a frame of the hold that reports normal ends the mode for the other frames and not for itself, from any frame", async () => {
  const { tab_item, steps } = make();
  await tab_item.reported(4, 0, "item");
  await tab_item.reported(4, 7, "item", true);
  await tab_item.reported(4, 9, "item", true);
  steps.length = 0;
  await tab_item.reported(4, 7, "normal");
  assert.deepEqual(steps.sort(), ["4:off:0", "4:off:9"]);
  steps.length = 0;
  await tab_item.reported(4, 0, "normal");
  assert.deepEqual(steps, [], "the hold ended once, so a late report of normal ends nothing again");
});

test("a field in a frame (insert) ends the mode for the other frames", async () => {
  const { tab_item, steps } = make();
  await tab_item.reported(4, 0, "item");
  await tab_item.reported(4, 7, "item", true);
  steps.length = 0;
  await tab_item.reported(4, 7, "insert");
  assert.deepEqual(steps, ["4:off:0"]);
});

test("a hint or the command line opened in the mode keeps it, and a report of normal from a frame outside the hold ends nothing", async () => {
  const { tab_item, steps, data } = make();
  await tab_item.reported(4, 0, "item");
  steps.length = 0;
  await tab_item.reported(4, 0, "cmdline");
  await tab_item.reported(4, 0, "hint");
  await tab_item.reported(4, 3, "normal");
  assert.deepEqual(steps, []);
  assert.ok(data["desertfox_tab_item_4"]);
  await tab_item.reported(4, 0, "item");
  assert.deepEqual(steps, []);
});

test("a step that arrives after the hold ended sends that frame back to normal and starts no hold", async () => {
  const { tab_item, steps, data } = make();
  await tab_item.reported(4, 0, "item");
  await tab_item.reported(4, 0, "normal");
  steps.length = 0;
  await tab_item.reported(4, 7, "item", true);
  assert.deepEqual(steps, ["4:off:7"]);
  assert.equal(data["desertfox_tab_item_4"], undefined);
});

test("a frame that starts while the hold is on joins it, and one that starts after the end does not", async () => {
  const { tab_item, steps } = make();
  assert.equal(await tab_item.join(4, 5), false);
  await tab_item.reported(4, 0, "item");
  assert.equal(await tab_item.join(4, 5), true);
  steps.length = 0;
  await tab_item.reported(4, 0, "normal");
  assert.deepEqual(steps, ["4:off:5"], "the joined frame is in the hold, so the end reaches it");
  assert.equal(await tab_item.join(4, 6), false);
});

test("a frame that reloads in the hold joins again, and the report of normal that its new document sends first does not end the hold", async () => {
  const { tab_item, steps, data } = make();
  await tab_item.reported(4, 0, "item");
  await tab_item.reported(4, 7, "item", true);
  steps.length = 0;
  assert.equal(await tab_item.join(4, 7), true);
  await tab_item.reported(4, 7, "normal");
  assert.deepEqual(steps, []);
  assert.ok(data["desertfox_tab_item_4"]);
  await tab_item.reported(4, 7, "item", true);
  // It has taken the mode, so a normal now is the user leaving.
  await tab_item.reported(4, 7, "normal");
  assert.deepEqual(steps, ["4:off:0"]);
});

test("a child frame of the hold that commits a new document keeps the hold through the normal report that comes before its join", async () => {
  const { tab_item, steps, data } = make();
  await tab_item.reported(4, 0, "item");
  await tab_item.reported(4, 7, "item", true);
  steps.length = 0;
  await tab_item.committed(4, 7);
  await tab_item.reported(4, 7, "normal");
  assert.deepEqual(steps, []);
  assert.equal(await tab_item.join(4, 7), true);
  await tab_item.reported(4, 7, "item", true);
  assert.deepEqual(data["desertfox_tab_item_4"], { frames: [0, 7], rejoined: [] });
  await tab_item.reported(4, 7, "normal");
  assert.deepEqual(steps, ["4:off:0"], "back in the mode, a normal is the user leaving");
});

test("a commit marks only a child frame of a live hold", async () => {
  const { tab_item, data } = make();
  await tab_item.committed(4, 7);
  assert.equal(data["desertfox_tab_item_4"], undefined);
  await tab_item.reported(4, 0, "item");
  await tab_item.committed(4, 0);
  await tab_item.committed(4, 9);
  assert.deepEqual(data["desertfox_tab_item_4"], { frames: [0] });
});

test("the start goes to the tab only while it still shows the completed address", async () => {
  const sent: unknown[] = [];
  const ask = (wanted: { selector?: string } | undefined, now: { url?: string; status?: string } | undefined) =>
    ask_item_start({ start_for: async () => wanted, tab_now: async () => now, send_start: async (tab_id, args) => void sent.push([tab_id, args]) }, 4, "https://a.test/");
  await ask({ selector: "li" }, { url: "https://a.test/", status: "complete" });
  await ask({}, { url: "https://b.test/", status: "complete" });
  await ask({}, { url: "https://a.test/", status: "loading" });
  await ask({}, undefined);
  await ask(undefined, { url: "https://a.test/", status: "complete" });
  assert.deepEqual(sent, [[4, { selector: "li" }]]);
});

test("a load of the page ends the mode in every frame, and an address change of the page keeps it", async () => {
  const { tab_item, steps, data } = make();
  await tab_item.reported(4, 0, "item");
  await tab_item.reported(4, 7, "item", true);
  steps.length = 0;
  await tab_item.navigated(4, { url: "https://a.test/#x" });
  await tab_item.navigated(4, { status: "loading", url: "https://a.test/replaced" });
  assert.deepEqual(steps, []);
  assert.ok(data["desertfox_tab_item_4"]);
  await tab_item.navigated(4, { status: "loading" });
  assert.deepEqual(steps.sort(), ["4:off:0", "4:off:7"]);
  assert.equal(data["desertfox_tab_item_4"], undefined);
});

test("holds are per tab: a frame that leaves in one tab ends nothing in another", async () => {
  const { tab_item, steps } = make();
  await tab_item.reported(4, 0, "item");
  await tab_item.reported(5, 0, "item");
  steps.length = 0;
  await tab_item.reported(4, 0, "normal");
  assert.deepEqual(steps, []);
  await tab_item.reported(5, 3, "normal");
  assert.deepEqual(steps, []);
  await tab_item.forget(5);
  await tab_item.reported(5, 0, "normal");
  assert.deepEqual(steps, []);
});

test("reports that arrive together run one after another", async () => {
  const { tab_item, steps } = make();
  await Promise.all([tab_item.reported(4, 0, "item"), tab_item.reported(4, 7, "item", true), tab_item.reported(4, 9, "item", true)]);
  assert.deepEqual(steps, ["4:on:all:from 0"], "one start for three frames");
});

test("a frame that never answers its step holds up no later report or join, in this tab or another", { timeout: 2000 }, async () => {
  const data: Record<string, unknown> = {};
  const storage = {
    get: async (key: string) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(data, structuredClone(items)),
    remove: async (key: string) => void delete data[key],
  };
  const tab_item = create_tab_item({ storage: storage as never, send_step: () => new Promise(() => {}) });
  await tab_item.reported(4, 0, "item");
  await tab_item.reported(4, 7, "item", true);
  await tab_item.reported(4, 0, "normal");
  await tab_item.reported(5, 0, "item");
  assert.equal(await tab_item.join(5, 3), true);
});
