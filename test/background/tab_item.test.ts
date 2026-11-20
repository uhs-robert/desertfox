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

test("the start goes only to the top document that completed at the address, and only when one is wanted", async () => {
  const sent: unknown[] = [];
  const ask = (wanted: { selectors: string[] } | undefined, top: { url?: string; documentId?: string } | undefined, after_read?: () => void) =>
    ask_item_start({ start_for: async () => (after_read?.(), wanted), top_document: async () => top, send_start: async (tab_id, document_id, start) => void sent.push([tab_id, document_id, start]) }, 4, "https://a.test/");
  await ask({ selectors: ["li"] }, { url: "https://a.test/", documentId: "d1" });
  await ask({ selectors: [] }, { url: "https://b.test/", documentId: "d2" });
  await ask({ selectors: [] }, undefined);
  await ask({ selectors: [] }, { url: "https://a.test/" });
  await ask(undefined, { url: "https://a.test/", documentId: "d3" });
  // A reload at the same address during the read: the send still names the document that completed, which Firefox no longer delivers to.
  const top = { url: "https://a.test/", documentId: "d4" };
  await ask({ selectors: [] }, top, () => (top.documentId = "d5"));
  assert.deepEqual(sent, [[4, "d1", { selectors: ["li"] }], [4, "d4", { selectors: [] }]]);
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

// Records each step with its tab, frame and the reporter it skips, in the order the frames receive them. A send to `stuck_tab` or `stuck_frame` never answers. With `held` every other send answers, and so lands, only when released, in order, and with `slow_offs` only the off steps wait for that.
function item_with_recorded_steps({ stuck_tab = -1, stuck_frame = -1, held = false, slow_offs = false } = {}) {
  const data: Record<string, unknown> = {};
  const storage = {
    get: async (key: string) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(data, structuredClone(items)),
    remove: async (key: string) => void delete data[key],
  };
  const delivered: { tab: number; on: boolean; frame: number | "all"; from: number | undefined }[] = [];
  const releases: (() => void)[] = [];
  let calls = 0;
  const tab_item = create_tab_item({
    storage: storage as never,
    send_step: (tab, on, frame_id, from) => {
      calls++;
      const step = { tab, on, frame: frame_id ?? ("all" as const), from };
      if (tab === stuck_tab || frame_id === stuck_frame) return new Promise(() => {});
      if (!held && !(slow_offs && !on)) return (delivered.push(step), Promise.resolve());
      return new Promise<void>((resolve) => releases.push(() => (delivered.push(step), resolve())));
    },
  });
  const release_all = async () => {
    while (releases.length > 0) {
      releases.shift()!();
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  // The mode each frame of tab 4 ends in, after every step that landed.
  const final_mode = (frame: number): boolean | undefined => delivered.filter((step) => step.tab === 4 && (step.frame === frame || (step.frame === "all" && step.from !== frame))).at(-1)?.on;
  return { tab_item, delivered, release_all, final_mode, data, calls: () => calls };
}

test("a frame that never answers its step holds up no later report or join, in this tab or another", { timeout: 2000 }, async () => {
  const { tab_item, delivered } = item_with_recorded_steps({ stuck_tab: 4 });
  await tab_item.reported(4, 0, "item");
  await tab_item.reported(4, 7, "item", true);
  await tab_item.reported(4, 0, "normal");
  await tab_item.reported(5, 0, "item");
  assert.equal(await tab_item.join(5, 3), true);
  assert.deepEqual(delivered, [{ tab: 5, on: true, frame: "all", from: 0 }], "tab 5's step goes out past tab 4's stuck one");
});

test("an off step still on its way when a new hold starts cannot land after the new hold's on step", async () => {
  const { tab_item, delivered, release_all, data } = item_with_recorded_steps({ slow_offs: true });
  await tab_item.reported(4, 0, "item");
  await tab_item.reported(4, 7, "item", true);
  delivered.length = 0;
  await tab_item.reported(4, 0, "normal");
  await tab_item.reported(4, 0, "item");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delivered.length, 0, "the new on step waits behind the slow off step");
  await release_all();
  assert.deepEqual(delivered.map((step) => `${step.on ? "on" : "off"}:${step.frame}`), ["off:7", "on:all"]);
  assert.ok(data["desertfox_tab_item_4"], "the new hold survives");
});

// Frame 0 starts a new hold on its own while the off step of the hold it left still waits. The step on of its new hold skips it, so that old off must not go out after it.
test("a frame that starts a new hold while an off step to it waits stays in the mode", async () => {
  const { tab_item, release_all, final_mode, data } = item_with_recorded_steps({ held: true });
  await tab_item.reported(4, 0, "item");
  await tab_item.reported(4, 7, "item", true);
  await tab_item.reported(4, 7, "normal");
  await tab_item.reported(4, 0, "item");
  await release_all();
  assert.deepEqual((data["desertfox_tab_item_4"] as { frames: number[] }).frames, [0]);
  assert.notEqual(final_mode(0), false, "no off step reaches frame 0 after its new hold started");
});

test("waiting steps that a newer one covers are dropped, so the latest start still reaches every frame", async () => {
  const { tab_item, delivered, release_all, final_mode, data } = item_with_recorded_steps({ held: true });
  for (let cycle = 0; cycle < 20; cycle++) {
    await tab_item.reported(4, 0, "item");
    await tab_item.reported(4, 7, "item", true);
    await tab_item.reported(4, 0, "normal");
  }
  await tab_item.reported(4, 0, "item");
  await release_all();
  assert.ok(data["desertfox_tab_item_4"], "storage holds a live hold");
  assert.equal(final_mode(7), true, "frame 7 ends in the mode");
  assert.equal(delivered.length, 2, "the first start went out, and the last start covered every step queued behind it");
});

test("steps still waiting when the page loads never reach the new page", async () => {
  const { tab_item, release_all, calls } = item_with_recorded_steps({ held: true });
  await tab_item.reported(4, 0, "item");
  await tab_item.reported(4, 7, "item", true);
  await tab_item.reported(4, 0, "normal");
  await tab_item.navigated(4, { status: "loading" });
  await release_all();
  assert.equal(calls(), 1, "the off step to frame 7 waited behind the start and was skipped");
});

test("a frame of the old page that never answers its step off at a load holds up nothing on the new page", { timeout: 2000 }, async () => {
  const { tab_item, delivered } = item_with_recorded_steps({ stuck_frame: 7 });
  await tab_item.reported(4, 0, "item");
  await tab_item.reported(4, 7, "item", true);
  await tab_item.navigated(4, { status: "loading" });
  await tab_item.reported(4, 0, "item");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(delivered.at(-1), { tab: 4, on: true, frame: "all", from: 0 });
});

test("steps still waiting when the tab closes never go out", async () => {
  const { tab_item, release_all, calls } = item_with_recorded_steps({ held: true });
  await tab_item.reported(4, 0, "item");
  await tab_item.reported(4, 7, "item", true);
  await tab_item.reported(4, 0, "normal");
  await tab_item.forget(4);
  await release_all();
  assert.equal(calls(), 1);
});
