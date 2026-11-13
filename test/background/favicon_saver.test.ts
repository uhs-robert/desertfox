import assert from "node:assert/strict";
import { test } from "node:test";
import { make_favicon_cache, FAVICON_ENTRY_MAX_CHARS } from "../../src/newtab/icon_cache.ts";
import { make_favicon_saver, type IconFetcher } from "../../src/background/favicon_saver.ts";

const PNG = "data:image/png;base64,PNG1";
const DATA_ICON = "data:image/png;base64,TAB1";
const DAY = 24 * 60 * 60 * 1000;

function fake_storage() {
  const data: Record<string, unknown> = {};
  const counts = { gets: 0, sets: 0 };
  return {
    data,
    counts,
    get: async (key: string) => (counts.gets++, key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => (counts.sets++, void Object.assign(data, items)),
    remove: async (key: string) => void delete data[key],
  };
}

function setup(fetch_icon?: IconFetcher, limits = { concurrent: 2, timeout_ms: 50 }) {
  const storage = fake_storage();
  const cache = make_favicon_cache(storage, () => {});
  const calls: string[] = [];
  let clock = 1_000_000;
    const saver = make_favicon_saver(cache, async (source, signal) => (fetch_icon ? fetch_icon(source, signal) : (calls.push(source), PNG)), () => clock, limits);
  return { storage, cache, saver, calls, advance: (ms: number) => void (clock += ms) };
}

const visit = (host: string, icon: string | undefined = `https://${host}/f.png`, incognito = false) => ({ url: `https://${host}/page`, icon, incognito });
const deferred = () => {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

test("a private tab, a non-web page and an unusable icon make no storage read and no fetch", async () => {
  const { saver, storage, calls } = setup();
  await saver.on_tab(visit("a.example", undefined, true));
  await saver.on_tab({ url: "about:newtab", icon: "https://a.example/f.png", incognito: false });
  await saver.on_tab(visit("a.example", ""));
  await saver.on_tab(visit("a.example", "chrome://branding/icon.png"));
  await saver.on_tab(visit("a.example", `data:image/png;base64,${"A".repeat(FAVICON_ENTRY_MAX_CHARS)}`));
  assert.deepEqual([storage.counts.gets, storage.counts.sets, calls.length], [0, 0, 0]);
});

test("an https icon is fetched once, stored as the PNG, and repeat events cost nothing", async () => {
  const { saver, cache, storage, calls } = setup();
  for (let n = 0; n < 5; n++) await saver.on_tab(visit("a.example"));
  assert.deepEqual(calls, ["https://a.example/f.png"]);
  assert.equal(storage.counts.sets, 1);
  assert.equal(storage.counts.gets, 2, "one read by the saver, one by the save; the repeats read nothing");
  assert.equal((await cache.read()).get("a.example"), PNG);
});

test("a stored icon that is still fresh and unchanged is not fetched after a restart", async () => {
  const first = setup();
  await first.saver.on_tab(visit("a.example"));
  const calls: string[] = [];
  const second = make_favicon_saver(first.cache, async (source) => (calls.push(source), PNG), () => 1_000_000 + DAY, { concurrent: 2, timeout_ms: 50 });
  await second.on_tab(visit("a.example"));
  assert.deepEqual(calls, []);
  await second.on_tab(visit("a.example", "https://a.example/new.png"));
  assert.deepEqual(calls, ["https://a.example/new.png"], "a changed address is fetched");
});

test("a stale entry is fetched again, and the same result writes nothing", async () => {
  const { saver, advance, calls, storage } = setup();
  await saver.on_tab(visit("a.example"));
  advance(8 * DAY);
  await saver.on_tab(visit("a.example"));
  assert.equal(calls.length, 2);
  assert.equal(storage.counts.sets, 1);
});

test("a data: icon is used directly with no fetch, and the same one does not rewrite", async () => {
  const { saver, cache, calls, storage } = setup();
  await saver.on_tab(visit("a.example", DATA_ICON));
  await saver.on_tab(visit("a.example", DATA_ICON));
  assert.equal(calls.length, 0);
  assert.equal(storage.counts.sets, 1);
  assert.equal((await cache.read()).get("a.example"), DATA_ICON);
});

test("at most one fetch per host is in flight", async () => {
  const gate = deferred();
  const calls: string[] = [];
  const { saver } = setup(async (source) => (calls.push(source), gate.promise));
  const events = [saver.on_tab(visit("a.example")), saver.on_tab(visit("a.example")), saver.on_tab(visit("a.example"))];
  await new Promise((resolve) => setTimeout(resolve, 10));
  gate.resolve(PNG);
  await Promise.all(events);
  assert.equal(calls.length, 1);
});

test("concurrent fetches are bounded, and a waiting one starts when a slot frees", async () => {
  const gates = new Map<string, ReturnType<typeof deferred>>();
  let active = 0;
  let peak = 0;
  const { saver, cache } = setup(async (source) => {
    active++;
    peak = Math.max(peak, active);
    const gate = deferred();
    gates.set(source, gate);
    try {
      return await gate.promise;
    } finally {
      active--;
    }
  }, { concurrent: 2, timeout_ms: 1000 });
  const hosts = ["a", "b", "c", "d"].map((name) => `${name}.example`);
  const events = hosts.map((host) => saver.on_tab(visit(host)));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(gates.size, 2);
  for (let round = 0; round < 4; round++) {
    for (const gate of gates.values()) gate.resolve(PNG);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await Promise.all(events);
  assert.equal(peak, 2);
  assert.equal((await cache.read()).size, 4);
});

test("a hung fetch times out, frees its slot, stores nothing and is not retried in a loop", async () => {
  let attempts = 0;
  const { saver, cache, advance } = setup(async (_source, signal) => {
    attempts++;
    return new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  }, { concurrent: 1, timeout_ms: 20 });
  await saver.on_tab(visit("a.example"));
  for (let n = 0; n < 5; n++) await saver.on_tab(visit("a.example"));
  assert.equal(attempts, 1);
  assert.equal((await cache.read()).size, 0);
  advance(2 * 60 * 60 * 1000);
  await saver.on_tab(visit("a.example"));
  assert.equal(attempts, 2, "after the retry delay it may try again");
  await saver.on_tab(visit("b.example"));
  assert.equal(attempts, 3, "the slot was freed");
});

test("a failed or non-image response stores nothing", async () => {
  const { saver, cache, storage } = setup(async () => Promise.reject(new Error("favicon is not an image")));
  await saver.on_tab(visit("a.example"));
  assert.equal(storage.counts.sets, 0);
  assert.equal((await cache.read()).size, 0);
});

test("a clear drops a fetch that finishes after it, and a later visit saves again", async () => {
  const gate = deferred();
  let first = true;
  const { saver, cache } = setup(async () => (first ? ((first = false), gate.promise) : PNG));
  const pending = saver.on_tab(visit("a.example"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  await saver.clear();
  gate.resolve(PNG);
  await pending;
  assert.equal((await cache.read()).size, 0, "the late fetch did not write back");
  await saver.on_tab(visit("a.example"));
  assert.equal((await cache.read()).get("a.example"), PNG);
});
