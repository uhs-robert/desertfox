import assert from "node:assert/strict";
import { test } from "node:test";
import { create_history_cache } from "../../src/background/history_cache.ts";

type Visit = { url: string; title?: string; lastVisitTime: number; visitCount?: number };
const visit = (n: number, extra: Partial<Visit> = {}): Visit => ({ url: `https://site${n}.test/`, title: `Site ${n}`, lastVisitTime: n, visitCount: 1, ...extra });
const urls = (cache: ReturnType<typeof create_history_cache>) => cache.read()?.map((row) => row.url.replace(/\D/g, ""));

// The search answer is held until the test releases it, so events can arrive mid-fill.
function make(initial: Visit[], max = 100, hidden: string[] = []) {
  let release: () => void = () => {};
  let fail = false;
  let searches = 0;
  const gate = (): Promise<void> => new Promise((resolve) => (release = resolve));
  let hold = false;
  const cache = create_history_cache({
    max,
    listed: async (url) => !hidden.includes(url),
    search: async () => {
      searches++;
      if (hold) await gate();
      if (fail) throw new Error("no history");
      return [...initial].sort((a, b) => b.lastVisitTime - a.lastVisitTime);
    },
  });
  return { cache, searches: () => searches, hold: () => (hold = true), release: () => release(), fail: (value: boolean) => (fail = value) };
}

test("the fill holds the rows newest first and keeps the last visit and the count", async () => {
  const { cache } = make([visit(1), visit(3, { visitCount: 7 }), visit(2)]);
  await cache.start();
  assert.deepEqual(urls(cache), ["3", "2", "1"]);
  assert.deepEqual(cache.read()?.[0], { url: "https://site3.test/", title: "Site 3", last_visit: 3, visit_count: 7 });
});

test("a read before the fill ends is undefined, so the caller falls back", async () => {
  const state = make([visit(1)]);
  state.hold();
  const started = state.cache.start();
  assert.equal(state.cache.read(), undefined);
  assert.equal(state.searches(), 1);
  state.release();
  await started;
  assert.deepEqual(urls(state.cache), ["1"]);
});

test("the first read starts the fill when start never ran", async () => {
  const { cache, searches } = make([visit(1)]);
  assert.equal(cache.read(), undefined);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(searches(), 1);
});

test("events during the fill apply after it, in arrival order", async () => {
  const state = make([visit(1), visit(2)]);
  state.hold();
  const started = state.cache.start();
  state.cache.visited(visit(3));
  state.cache.visit_removed({ allHistory: false, urls: ["https://site2.test/"] });
  state.cache.visited(visit(2, { lastVisitTime: 9 }));
  state.cache.title_changed({ url: "https://site3.test/", title: "Renamed" });
  state.release();
  await started;
  assert.deepEqual(urls(state.cache), ["2", "3", "1"]);
  assert.equal(state.cache.read()?.[1]?.title, "Renamed");
});

test("a removal during the fill drops a page the fill already read", async () => {
  const state = make([visit(1), visit(2)]);
  state.hold();
  const started = state.cache.start();
  state.cache.visit_removed({ allHistory: false, urls: ["https://site1.test/"] });
  state.release();
  await started;
  assert.deepEqual(urls(state.cache), ["2"]);
});

test("removing all history during the fill empties the cache and later visits enter", async () => {
  const state = make([visit(1), visit(2)]);
  state.hold();
  const started = state.cache.start();
  state.cache.visit_removed({ allHistory: true, urls: [] });
  state.cache.visited(visit(5));
  state.release();
  await started;
  assert.deepEqual(urls(state.cache), ["5"]);
});

test("a visit moves its page to the front and updates the count", async () => {
  const { cache } = make([visit(1), visit(2), visit(3)]);
  await cache.start();
  cache.visited({ url: "https://site1.test/", lastVisitTime: 10, visitCount: 2 });
  await cache.idle();
  assert.deepEqual(urls(cache), ["1", "3", "2"]);
  assert.deepEqual(cache.read()?.[0], { url: "https://site1.test/", title: "Site 1", last_visit: 10, visit_count: 2 });
});

test("a late older visit does not push a row back, and a new url lands in time order", async () => {
  const { cache } = make([visit(5), visit(1)]);
  await cache.start();
  cache.visited(visit(5, { lastVisitTime: 2 }));
  cache.visited(visit(3));
  await cache.idle();
  assert.deepEqual(urls(cache), ["5", "3", "1"]);
  assert.equal(cache.read()?.[0]?.last_visit, 5);
});

test("a title change and a removal update the rows", async () => {
  const { cache } = make([visit(1), visit(2)]);
  await cache.start();
  cache.title_changed({ url: "https://site1.test/", title: "New" });
  cache.visit_removed({ allHistory: false, urls: ["https://site2.test/"] });
  assert.deepEqual(cache.read()?.map((row) => row.title), ["New"]);
});

test("allHistory clears the cache", async () => {
  const { cache } = make([visit(1), visit(2)]);
  await cache.start();
  cache.visit_removed({ allHistory: true, urls: [] });
  assert.deepEqual(cache.read(), []);
});

test("the cache keeps the newest rows up to its cap", async () => {
  const { cache } = make([visit(1), visit(2), visit(3)], 3);
  await cache.start();
  cache.visited(visit(4));
  cache.visited(visit(0));
  await cache.idle();
  assert.deepEqual(urls(cache), ["4", "3", "2"]);

  cache.visit_removed({ allHistory: false, urls: ["https://site4.test/"] });
  assert.deepEqual(urls(cache), ["3", "2"]);
  cache.visited(visit(6));
  await cache.idle();
  assert.deepEqual(urls(cache), ["6", "3", "2"]);
});

test("a failed fill falls back, drops the held events and the next read fills again", async () => {
  const state = make([visit(1)]);
  state.fail(true);
  await state.cache.start();
  state.fail(false);
  state.cache.visited(visit(2));
  const filling = state.cache.start();
  assert.equal(state.cache.read(), undefined);
  await filling;
  await state.cache.idle();
  assert.deepEqual(urls(state.cache), ["1"]);
});

test("an event wake builds a new cache from the browser history", async () => {
  const history = [visit(1), visit(2)];
  const first = make(history);
  await first.cache.start();
  history.push(visit(3));
  const woken = make(history);
  await woken.cache.start();
  assert.deepEqual(urls(woken.cache), ["3", "2", "1"]);
});

test("a visit to a page the search does not list stays out, and a listed new page enters", async () => {
  const { cache } = make([visit(1)], 100, ["https://site2.test/"]);
  await cache.start();
  cache.visited(visit(2));
  cache.visited(visit(3));
  await cache.idle();
  assert.deepEqual(urls(cache), ["3", "1"]);
});

test("events behind a pending check keep their order", async () => {
  const { cache } = make([visit(1)], 100, ["https://site2.test/"]);
  await cache.start();
  cache.visited(visit(3));
  cache.visit_removed({ allHistory: false, urls: ["https://site3.test/"] });
  cache.visited(visit(4));
  cache.title_changed({ url: "https://site4.test/", title: "Four" });
  await cache.idle();
  assert.deepEqual(cache.read()?.map((row) => `${row.url.replace(/\D/g, "")}:${row.title}`), ["4:Four", "1:Site 1"]);
});

test("a hidden page seen during the fill stays out", async () => {
  const state = make([visit(1)], 100, ["https://site2.test/"]);
  state.hold();
  const started = state.cache.start();
  state.cache.visited(visit(2));
  state.release();
  await started;
  assert.deepEqual(urls(state.cache), ["1"]);
});
