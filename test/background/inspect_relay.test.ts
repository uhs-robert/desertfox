import assert from "node:assert/strict";
import { test } from "node:test";
import { create_inspect_relay, PICK_EXPIRY_MS, TOOLBOX_CLOSED_MESSAGE } from "../../src/background/inspect_relay.ts";
import type { RelayPort } from "../../src/background/inspect_relay.ts";

// One storage object stands for `storage.session`, so a second relay on it is a restarted background.
function make_storage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  return { data, storage: { get: async (key: string) => ({ [key]: data[key] }), set: async (items: Record<string, unknown>) => void Object.assign(data, items) } as never };
}

function make_port(fails = false) {
  const sent: unknown[] = [];
  let disconnect = () => {};
  const port: RelayPort = {
    postMessage: (message) => {
      if (fails) throw new Error("port closed");
      sent.push(message);
    },
  };
  return { port, sent, on_disconnect: (listener: () => void) => void (disconnect = listener), disconnect: () => disconnect() };
}

function make(initial: Record<string, unknown> = {}) {
  const { data, storage } = make_storage(initial);
  const clock = { now: 1_000_000 };
  const relay = create_inspect_relay(storage, () => clock.now);
  return { data, storage, clock, relay };
}

const PENDING = "desertfox_inspect_pending";

test("a pick with the toolbox open goes straight to its port and stores nothing", async () => {
  const { relay, data } = make();
  const devtools = make_port();
  await relay.connected(5, devtools.port, devtools.on_disconnect);
  assert.deepEqual(await relay.pick(5), { ok: true });
  assert.deepEqual(devtools.sent, [{ type: "devtools_pick" }]);
  assert.equal(data[PENDING] === undefined || Object.keys(data[PENDING] as object).length === 0, true);
});

test("a pick before the devtools page connects waits in storage, answers with the toast, and drains on connect", async () => {
  const { relay, data } = make();
  assert.deepEqual(await relay.pick(5), { ok: false, message: TOOLBOX_CLOSED_MESSAGE });
  assert.deepEqual(Object.keys(data[PENDING] as object), ["5"]);
  const devtools = make_port();
  await relay.connected(5, devtools.port, devtools.on_disconnect);
  assert.deepEqual(devtools.sent, [{ type: "devtools_pick" }]);
  assert.deepEqual(data[PENDING], {});
});

test("a pick older than 60 s is dropped on connect", async () => {
  const { relay, clock, data } = make();
  await relay.pick(5);
  clock.now += PICK_EXPIRY_MS;
  const devtools = make_port();
  await relay.connected(5, devtools.port, devtools.on_disconnect);
  assert.deepEqual(devtools.sent, []);
  assert.deepEqual(data[PENDING], {});
});

test("a pick just under 60 s old still goes out", async () => {
  const { relay, clock } = make();
  await relay.pick(5);
  clock.now += PICK_EXPIRY_MS - 1;
  const devtools = make_port();
  await relay.connected(5, devtools.port, devtools.on_disconnect);
  assert.equal(devtools.sent.length, 1);
});

test("a newer pick of the tab replaces the waiting one and restarts the 60 s", async () => {
  const { relay, clock } = make();
  await relay.pick(5);
  clock.now += 50_000;
  await relay.pick(5);
  clock.now += 50_000;
  const devtools = make_port();
  await relay.connected(5, devtools.port, devtools.on_disconnect);
  assert.equal(devtools.sent.length, 1);
});

test("after a disconnect a pick waits again, and a reconnect drains it", async () => {
  const { relay } = make();
  const first = make_port();
  await relay.connected(5, first.port, first.on_disconnect);
  first.disconnect();
  assert.deepEqual(await relay.pick(5), { ok: false, message: TOOLBOX_CLOSED_MESSAGE });
  assert.deepEqual(first.sent, []);
  const second = make_port();
  await relay.connected(5, second.port, second.on_disconnect);
  assert.equal(second.sent.length, 1);
  assert.deepEqual(await relay.pick(5), { ok: true });
  assert.equal(second.sent.length, 2);
});

test("the late disconnect of a replaced port does not remove the new port", async () => {
  const { relay } = make();
  const old = make_port();
  await relay.connected(5, old.port, old.on_disconnect);
  const fresh = make_port();
  await relay.connected(5, fresh.port, fresh.on_disconnect);
  old.disconnect();
  assert.deepEqual(await relay.pick(5), { ok: true });
  assert.equal(fresh.sent.length, 1);
});

test("a port that throws on send makes the pick wait instead of being lost", async () => {
  const { relay, data } = make();
  const dead = make_port(true);
  await relay.connected(5, dead.port, dead.on_disconnect);
  assert.deepEqual(await relay.pick(5), { ok: false, message: TOOLBOX_CLOSED_MESSAGE });
  assert.deepEqual(Object.keys(data[PENDING] as object), ["5"]);
  const live = make_port();
  await relay.connected(5, live.port, live.on_disconnect);
  assert.equal(live.sent.length, 1);
});

test("a pick that cannot be sent on connect stays stored", async () => {
  const { relay, data } = make();
  await relay.pick(5);
  const dead = make_port(true);
  await relay.connected(5, dead.port, dead.on_disconnect);
  assert.deepEqual(Object.keys(data[PENDING] as object), ["5"]);
});

test("two tabs with toolboxes open get only their own picks", async () => {
  const { relay } = make();
  const one = make_port();
  const two = make_port();
  await relay.connected(1, one.port, one.on_disconnect);
  await relay.connected(2, two.port, two.on_disconnect);
  await relay.pick(2);
  assert.equal(one.sent.length, 0);
  assert.equal(two.sent.length, 1);
  await relay.pick(1);
  assert.equal(one.sent.length, 1);
  assert.equal(two.sent.length, 1);
});

test("two tabs waiting each drain to their own page", async () => {
  const { relay } = make();
  await relay.pick(1);
  await relay.pick(2);
  const two = make_port();
  await relay.connected(2, two.port, two.on_disconnect);
  assert.equal(two.sent.length, 1);
  const one = make_port();
  await relay.connected(1, one.port, one.on_disconnect);
  assert.equal(one.sent.length, 1);
});

test("a navigation drops the waiting pick of its tab only", async () => {
  const { relay } = make();
  await relay.pick(1);
  await relay.pick(2);
  await relay.forget(1);
  const one = make_port();
  await relay.connected(1, one.port, one.on_disconnect);
  assert.deepEqual(one.sent, []);
  const two = make_port();
  await relay.connected(2, two.port, two.on_disconnect);
  assert.equal(two.sent.length, 1);
});

test("a background restart keeps a waiting pick, and the page's reconnect drains it", async () => {
  const before = make();
  await before.relay.pick(5);
  const restarted = create_inspect_relay(before.storage, () => before.clock.now);
  const devtools = make_port();
  await restarted.connected(5, devtools.port, devtools.on_disconnect);
  assert.deepEqual(devtools.sent, [{ type: "devtools_pick" }]);
});

test("a restarted background has no ports until the pages reconnect, so a pick waits", async () => {
  const before = make();
  const devtools = make_port();
  await before.relay.connected(5, devtools.port, devtools.on_disconnect);
  const restarted = create_inspect_relay(before.storage, () => before.clock.now);
  assert.deepEqual(await restarted.pick(5), { ok: false, message: TOOLBOX_CLOSED_MESSAGE });
  const again = make_port();
  await restarted.connected(5, again.port, again.on_disconnect);
  assert.equal(again.sent.length, 1);
});

test("stored data of the wrong shape reads as no pending pick", async () => {
  const { relay } = make({ [PENDING]: "x" });
  const devtools = make_port();
  await relay.connected(5, devtools.port, devtools.on_disconnect);
  assert.deepEqual(devtools.sent, []);
});
