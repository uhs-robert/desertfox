import assert from "node:assert/strict";
import { test } from "node:test";
import { make_favicon_cache } from "../../src/newtab/icon_cache.ts";
import { make_favicon_saver, source_key, type IconRedraw } from "../../src/background/favicon_saver.ts";

const PNG = "data:image/png;base64,PNG1";
const raw = (name: string) => `data:image/x-icon;base64,${name}`;

function fake_storage() {
  const data: Record<string, unknown> = {};
  const counts = { gets: 0, sets: 0 };
  let gate: Promise<void> | undefined;
  return {
    data,
    counts,
    hold_next_get: () => {
      let release!: () => void;
      gate = new Promise<void>((resolve) => (release = resolve));
      return release;
    },
    get: async (key: string) => {
      counts.gets++;
      const held = gate;
      gate = undefined;
      const value = key in data ? { [key]: data[key] } : {};
      if (held) await held;
      return value;
    },
    set: async (items: Record<string, unknown>) => (counts.sets++, void Object.assign(data, items)),
    remove: async (key: string) => void delete data[key],
  };
}

function setup(redraw?: IconRedraw) {
  const storage = fake_storage();
  const cache = make_favicon_cache(storage, () => {});
  const calls: string[] = [];
  const saver = make_favicon_saver(cache, redraw ?? (async (source) => (calls.push(source), PNG)));
  return { storage, cache, saver, calls };
}

const visit = (host: string, icon: string = raw(host), incognito = false) => ({ url: `https://${host}/page`, icon, incognito });
const deferred = () => {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test("a private tab, a non-web page and an icon that is not a data: image make no storage read and no redraw", async () => {
  const { saver, storage, calls } = setup();
  await saver.on_tab(visit("a.example", raw("a"), true));
  await saver.on_tab({ url: "about:newtab", icon: raw("a"), incognito: false });
  await saver.on_tab(visit("a.example", ""));
  await saver.on_tab(visit("a.example", "https://a.example/f.png"));
  await saver.on_tab(visit("a.example", "chrome://branding/icon.png"));
  await saver.on_tab(visit("a.example", `data:image/png;base64,${"A".repeat(600 * 1024)}`));
  assert.deepEqual([storage.counts.gets, storage.counts.sets, calls.length], [0, 0, 0]);
});

test("a data: icon is redrawn once and stored, and repeat events cost no read and no redraw", async () => {
  const { saver, cache, storage, calls } = setup();
  for (let n = 0; n < 5; n++) await saver.on_tab(visit("a.example"));
  assert.equal(calls.length, 1);
  assert.deepEqual([storage.counts.gets, storage.counts.sets], [2, 1]);
  assert.equal((await cache.read()).get("a.example"), PNG);
});

test("after a restart an unchanged icon is not redrawn, and a changed one is", async () => {
  const first = setup();
  await first.saver.on_tab(visit("a.example"));
  const calls: string[] = [];
  const second = make_favicon_saver(first.cache, async (source) => (calls.push(source), PNG));
  await second.on_tab(visit("a.example"));
  assert.deepEqual(calls, []);
  await second.on_tab(visit("a.example", raw("changed")));
  assert.deepEqual(calls, [raw("changed")]);
});

test("a redraw that gives the stored PNG again writes nothing", async () => {
  const { saver, storage } = setup();
  await saver.on_tab(visit("a.example", raw("v1")));
  await saver.on_tab(visit("a.example", raw("v2")));
  await saver.on_tab(visit("a.example", raw("v1")));
  assert.equal(storage.counts.sets, 3, "each changed source key is a changed entry");
});

test("at most one redraw per host is in flight", async () => {
  const gate = deferred();
  const calls: string[] = [];
  const { saver } = setup(async (source) => (calls.push(source), gate.promise));
  const events = [saver.on_tab(visit("a.example")), saver.on_tab(visit("a.example")), saver.on_tab(visit("a.example"))];
  await tick();
  gate.resolve(PNG);
  await Promise.all(events);
  assert.equal(calls.length, 1);
});

test("a failed redraw stores nothing and the same icon is not tried again", async () => {
  let attempts = 0;
  const { saver, cache } = setup(async () => (attempts++, Promise.reject(new Error("cannot decode"))));
  for (let n = 0; n < 4; n++) await saver.on_tab(visit("a.example"));
  assert.equal(attempts, 1);
  assert.equal((await cache.read()).size, 0);
  await saver.on_tab(visit("a.example", raw("other")));
  assert.equal(attempts, 2, "a different icon is tried");
});

test("a clear drops a redraw that finishes after it, and a later visit saves again", async () => {
  const gate = deferred();
  let first = true;
  const { saver, cache } = setup(async () => (first ? ((first = false), gate.promise) : PNG));
  const pending = saver.on_tab(visit("a.example"));
  await tick();
  await saver.clear();
  gate.resolve(PNG);
  await pending;
  assert.equal((await cache.read()).size, 0, "the late redraw did not write back");
  await saver.on_tab(visit("a.example"));
  assert.equal((await cache.read()).get("a.example"), PNG);
});

test("a clear during the read of a known host does not leave the host marked done", async () => {
  const { saver, cache, storage, calls } = setup();
  await saver.on_tab(visit("a.example"));
  await saver.clear();
  // A second saver stands for the one after a restart, so it holds no memory of the host; the stored entry is what it reads.
  await cache.save({ host: "a.example", icon: PNG, source: source_key(raw("a.example")) }, cache.generation());
  const second = make_favicon_saver(cache, async (source) => (calls.push(source), PNG));
  const release = storage.hold_next_get();
  const pending = second.on_tab(visit("a.example"));
  await tick();
  await second.clear();
  release();
  await pending;
  const before = calls.length;
  await second.on_tab(visit("a.example"));
  assert.equal(calls.length, before + 1, "the host is saved again after the clear");
  assert.equal((await cache.read()).get("a.example"), PNG);
});

test("the handled memory is capped, and the oldest host drops first", async () => {
  const { saver, calls, storage } = setup();
  for (let n = 0; n < 510; n++) await saver.on_tab(visit(`h${n}.example`));
  const reads = storage.counts.gets;
  await saver.on_tab(visit("h509.example"));
  assert.equal(storage.counts.gets, reads, "a recent host stays handled and costs no read");
  await saver.on_tab(visit("h0.example"));
  assert.ok(storage.counts.gets > reads, "the oldest host was forgotten, so it reads the cache again");
  assert.ok(calls.length >= 510);
});
