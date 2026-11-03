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

test("a reply older than the newest fetch is dropped, and its kind asks again when it comes back", async () => {
  const { live, asks, settle, ready } = make();
  live.read("tabs");
  live.read("bookmarks");
  assert.deepEqual(asks.map((ask) => ask.kind), ["tabs", "bookmarks"]);
  // The older reply lands after the newer one started, and after it too.
  asks[0]!.answer({ items: TABS });
  await settle();
  assert.equal(ready(), 0);
  asks[1]!.answer({ items: BOOKMARKS });
  await settle();
  assert.equal(ready(), 1);
  assert.deepEqual(live.read("bookmarks"), { loading: false, items: BOOKMARKS });
  assert.deepEqual(live.read("tabs"), { loading: true });
  assert.equal(asks.length, 3);
});

test("an older reply that lands after a newer one is dropped", async () => {
  const { live, asks, settle } = make();
  live.read("tabs");
  live.read("bookmarks");
  asks[1]!.answer({ items: BOOKMARKS });
  await settle();
  asks[0]!.answer({ items: TABS });
  await settle();
  assert.deepEqual(live.read("bookmarks"), { loading: false, items: BOOKMARKS });
  assert.deepEqual(live.read("tabs"), { loading: true });
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

test("a reply that arrives after the line closed lands nowhere", async () => {
  const { live, asks, settle, ready } = make();
  live.read("tabs");
  live.close();
  asks[0]!.answer({ items: TABS });
  await settle();
  assert.equal(ready(), 0);
});
