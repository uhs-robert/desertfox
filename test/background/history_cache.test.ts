import assert from "node:assert/strict";
import { test } from "node:test";
import { create_history_cache, listed_by_search, REFILL_AFTER } from "../../src/background/history_cache.ts";

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

test("the hidden-page check finds an address longer than the 255 characters Firefox matches", async () => {
  const long_url = `https://shop.test/search?q=${"a".repeat(300)}`;
  const stored = [{ url: long_url }, { url: `${long_url}&page=2` }];
  const search = async (text: string) => (text.length > 255 ? [] : stored.filter((item) => item.url.slice(0, 255).includes(text)));
  assert.equal(await listed_by_search(search, long_url), true);
  assert.equal(await listed_by_search(search, `${long_url}&other=1`), false);
});

// The browser's history is a list the test edits. A search or a one-row check answers from it when released, so events can arrive in between.
function browser(initial: Visit[], max = 100) {
  const history = [...initial];
  const gates: (() => void)[] = [];
  let hold_searches = false;
  let fail_searches = false;
  const log = { searches: 0, checks: 0 };
  const cache = create_history_cache({
    max,
    listed: async (url) => (log.checks++, history.some((item) => item.url === url)),
    search: async (count) => {
      log.searches++;
      const answer = [...history].sort((a, b) => b.lastVisitTime - a.lastVisitTime).slice(0, count);
      if (hold_searches) await new Promise<void>((resolve) => gates.push(resolve));
      if (fail_searches) throw new Error("no history");
      return answer;
    },
  });
  return {
    cache,
    history,
    log,
    hold: (value: boolean) => (hold_searches = value),
    fail: (value: boolean) => (fail_searches = value),
    release: () => gates.splice(0).forEach((open) => open()),
    // The page enters the browser's history first and then fires its event, as the browser does.
    visit: (item: Visit) => (history.push(item), cache.visited(item)),
  };
}

// Waits until the refill's search is in flight and gated, so an event sent next arrives during it.
async function refill_started(state: ReturnType<typeof browser>) {
  for (let turn = 0; turn < 1000 && state.log.searches < 2; turn++) await Promise.resolve();
  assert.equal(state.log.searches, 2);
}

test("up to the limit, new addresses are checked one at a time and no search runs again", async () => {
  const state = browser([visit(1)]);
  await state.cache.start();
  for (let n = 2; n <= 1 + REFILL_AFTER; n++) state.visit(visit(n));
  await state.cache.idle();
  assert.equal(state.log.searches, 1);
  assert.equal(state.log.checks, REFILL_AFTER);
  assert.equal(state.cache.read()?.length, 1 + REFILL_AFTER);
});

test("many visits to a few new addresses are checked one by one and cause no refill", async () => {
  const state = browser([visit(1)]);
  await state.cache.start();
  for (let n = 0; n < 3 * REFILL_AFTER; n++) state.visit(visit(2 + (n % 3), { lastVisitTime: 1000 + n }));
  await state.cache.idle();
  assert.equal(state.log.searches, 1);
  assert.equal(state.cache.read()?.length, 4);
});

test("past the limit one refill takes the place of the checks and the rows stay newest first", async () => {
  const state = browser([visit(1)], 1000);
  await state.cache.start();
  for (let n = 2; n <= 2000; n++) state.visit(visit(n));
  await state.cache.idle();
  assert.equal(state.log.searches, 2);
  assert.ok(state.log.checks <= REFILL_AFTER);
  const rows = state.cache.read()!;
  assert.equal(rows.length, 1000);
  assert.equal(rows[0]!.url, "https://site2000.test/");
  assert.deepEqual(rows.map((row) => row.last_visit), [...rows.map((row) => row.last_visit)].sort((a, b) => b - a));
});

test("a read during a refill gets the old rows whole, then the new ones", async () => {
  const state = browser([visit(1)]);
  await state.cache.start();
  state.hold(true);
  for (let n = 2; n <= 100; n++) state.visit(visit(n));
  await refill_started(state);
  assert.ok(state.cache.read()!.length <= REFILL_AFTER + 1);
  assert.equal(urls(state.cache)?.includes("100"), false);
  state.hold(false);
  state.release();
  await state.cache.idle();
  assert.equal(state.cache.read()?.length, 100);
});

test("a visit that arrives during a refill applies after it, in order", async () => {
  const state = browser([visit(1)]);
  await state.cache.start();
  state.hold(true);
  for (let n = 2; n <= 100; n++) state.visit(visit(n));
  await refill_started(state);
  state.visit(visit(500));
  state.visit(visit(2, { lastVisitTime: 600 }));
  state.hold(false);
  state.release();
  await state.cache.idle();
  const found = urls(state.cache)!;
  assert.deepEqual(found.slice(0, 3), ["2", "500", "100"]);
  assert.equal(found.length, 100);
  assert.equal(state.log.searches, 2);
});

test("a removal that arrives during a refill still removes a page the search listed", async () => {
  const state = browser([visit(1)]);
  await state.cache.start();
  state.hold(true);
  for (let n = 2; n <= 100; n++) state.visit(visit(n));
  await refill_started(state);
  state.cache.visit_removed({ allHistory: false, urls: ["https://site50.test/"] });
  state.hold(false);
  state.release();
  await state.cache.idle();
  assert.equal(urls(state.cache)?.includes("50"), false);
  assert.equal(state.cache.read()?.length, 99);
});

test("a removal held before the refill is not applied twice and the page stays gone", async () => {
  const state = browser([visit(1)]);
  await state.cache.start();
  for (let n = 2; n <= 100; n++) state.visit(visit(n));
  state.history.splice(state.history.findIndex((item) => item.url === "https://site7.test/"), 1);
  state.cache.visit_removed({ allHistory: false, urls: ["https://site7.test/"] });
  await state.cache.idle();
  assert.equal(urls(state.cache)?.includes("7"), false);
  assert.equal(state.cache.read()?.length, 99);
});

test("a history clear during a refill leaves the cache empty", async () => {
  const state = browser([visit(1)]);
  await state.cache.start();
  state.hold(true);
  for (let n = 2; n <= 100; n++) state.visit(visit(n));
  await refill_started(state);
  state.history.length = 0;
  state.cache.visit_removed({ allHistory: true, urls: [] });
  state.hold(false);
  state.release();
  await state.cache.idle();
  assert.deepEqual(state.cache.read(), []);
});

test("a clear held with the queue empties the cache and later visits still enter", async () => {
  const state = browser([visit(1)]);
  await state.cache.start();
  for (let n = 2; n <= 100; n++) state.visit(visit(n));
  state.history.length = 0;
  state.cache.visit_removed({ allHistory: true, urls: [] });
  await state.cache.idle();
  assert.deepEqual(state.cache.read(), []);
  state.visit(visit(200));
  await state.cache.idle();
  assert.deepEqual(urls(state.cache), ["200"]);
});

test("at the cap a refill keeps only the newest rows", async () => {
  const state = browser([visit(1), visit(2), visit(3)], 10);
  await state.cache.start();
  for (let n = 4; n <= 200; n++) state.visit(visit(n));
  await state.cache.idle();
  assert.deepEqual(urls(state.cache), ["200", "199", "198", "197", "196", "195", "194", "193", "192", "191"]);
});

test("a refill that fails keeps the rows, drops the unchecked addresses and still applies the events held with them", async () => {
  const state = browser([visit(1), visit(2)]);
  await state.cache.start();
  state.fail(true);
  for (let n = 3; n <= 10; n++) state.visit(visit(n));
  // Sent while the queue drains, so these are held and not applied at once.
  state.cache.title_changed({ url: "https://site1.test/", title: "Renamed" });
  state.cache.visit_removed({ allHistory: false, urls: ["https://site2.test/"] });
  for (let n = 11; n <= 100; n++) state.visit(visit(n));
  await state.cache.idle();
  assert.equal(state.log.searches, 2);
  const kept = urls(state.cache)!;
  assert.equal(kept.includes("100"), false);
  assert.equal(kept.includes("2"), false);
  assert.equal(state.cache.read()?.find((row) => row.url === "https://site1.test/")?.title, "Renamed");
  state.fail(false);
  state.visit(visit(300));
  await state.cache.idle();
  assert.equal(urls(state.cache)?.[0], "300");
});

test("events queued behind a fill that has many new addresses end in one more search and a full list", async () => {
  const state = browser([visit(1)]);
  state.hold(true);
  const started = state.cache.start();
  for (let n = 2; n <= 100; n++) state.visit(visit(n));
  state.hold(false);
  state.release();
  await started;
  await state.cache.idle();
  assert.equal(state.cache.read()?.length, 100);
});
