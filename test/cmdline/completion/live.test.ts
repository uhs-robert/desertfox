import assert from "node:assert/strict";
import { test } from "node:test";
import { create_live_source } from "../../../src/cmdline/completion/live.ts";
import type { LiveKind } from "../../../src/cmdline/completion/live.ts";
import type { CompleteItemsAnswer } from "../../../src/shared/messages.ts";

const TABS = [{ number: 1, title: "One", url: "https://one.test/" }];
const BOOKMARKS = [{ title: "Mark", url: "https://mark.test/" }];

// Each ask waits until the test answers it, so replies can come in any order.
function make() {
  const asks: { kind: LiveKind; answer: (value: CompleteItemsAnswer | undefined) => void; fail: () => void }[] = [];
  let ready = 0;
  const live = create_live_source({
    ask: (kind) => new Promise((resolve, reject) => void asks.push({ kind, answer: resolve, fail: () => reject(new Error("gone")) })),
    on_ready: () => void ready++,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { live, asks, settle, ready: () => ready };
}

test("nothing is asked until a subject reads, and each kind is asked once", async () => {
  const { live, asks, settle, ready } = make();
  assert.equal(asks.length, 0);
  assert.deepEqual(live.read("tabs"), { loading: true });
  assert.deepEqual(live.read("tabs"), { loading: true });
  assert.equal(asks.length, 1);
  asks[0]!.answer({ items: TABS });
  await settle();
  assert.equal(ready(), 1);
  assert.deepEqual(live.read("tabs"), { loading: false, items: TABS });
  assert.equal(asks.length, 1);
});

test("two kinds in flight both land, whichever answers first", async () => {
  const { live, asks, settle, ready } = make();
  live.read("tabs");
  live.read("bookmarks");
  assert.deepEqual(asks.map((ask) => ask.kind), ["tabs", "bookmarks"]);
  asks[1]!.answer({ items: BOOKMARKS });
  await settle();
  asks[0]!.answer({ items: TABS });
  await settle();
  assert.equal(ready(), 2);
  assert.deepEqual(live.read("bookmarks"), { loading: false, items: BOOKMARKS });
  assert.deepEqual(live.read("tabs"), { loading: false, items: TABS });
  assert.equal(asks.length, 2);
});

test("a stale reply for a kind is dropped and the newer fetch of that kind lands", async () => {
  const { live, asks, settle, ready } = make();
  live.read("tabs");
  live.read("bookmarks");
  // The line closed and reopened: the first tabs fetch is stale and a second one runs.
  live.close();
  live.read("tabs");
  assert.deepEqual(asks.map((ask) => ask.kind), ["tabs", "bookmarks", "tabs"]);
  asks[0]!.answer({ items: [] });
  await settle();
  assert.equal(ready(), 0);
  assert.deepEqual(live.read("tabs"), { loading: true });
  asks[2]!.answer({ items: TABS });
  await settle();
  assert.deepEqual(live.read("tabs"), { loading: false, items: TABS });
  // The stale bookmarks reply is dropped too.
  asks[1]!.answer({ items: BOOKMARKS });
  await settle();
  assert.equal(ready(), 1);
});

test("a refused or failed fetch caches an empty list", async () => {
  const { live, asks, settle, ready } = make();
  live.read("tabs");
  asks[0]!.answer(undefined);
  await settle();
  assert.deepEqual(live.read("tabs"), { loading: false, items: [] });
  live.read("bookmarks");
  asks[1]!.fail();
  await settle();
  assert.deepEqual(live.read("bookmarks"), { loading: false, items: [] });
  assert.equal(ready(), 2);
});

test("close drops every kind in flight, and a reply after close does nothing", async () => {
  const { live, asks, settle, ready } = make();
  live.read("tabs");
  live.read("bookmarks");
  live.close();
  asks[0]!.answer({ items: TABS });
  asks[1]!.answer({ items: BOOKMARKS });
  await settle();
  assert.equal(ready(), 0);
  assert.deepEqual(live.read("tabs"), { loading: true });
  assert.deepEqual(live.read("bookmarks"), { loading: true });
});

test("a failed open fetch caches no rows", async () => {
  const { live, asks, settle } = make();
  live.read("open");
  asks[0]!.fail();
  await settle();
  assert.deepEqual(live.read("open"), { loading: false, items: { rows: [], history_max: 0 } });
});
