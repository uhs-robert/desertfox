import assert from "node:assert/strict";
import { test } from "node:test";
import { FAVICON_CACHE_KEY, FAVICON_CACHE_MAX_ENTRIES, FAVICON_ENTRY_MAX_CHARS, icons_by_host, make_favicon_cache, with_icon, type FaviconEntry } from "../src/newtab/icon_cache.ts";

const ICON = "data:image/png;base64,AAAA";
const entry = (host: string, icon = ICON, source = `key-${host}`): FaviconEntry => ({ host, icon, source });

function fake_storage(fail_set = false) {
  const data: Record<string, unknown> = {};
  const writes: number[] = [];
  return {
    data,
    writes,
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => {
      if (fail_set) throw new Error("QuotaExceededError");
      writes.push(1);
      Object.assign(data, items);
    },
    remove: async (key: string) => void delete data[key],
  };
}

test("the cache holds at most 200 sites and drops the oldest", () => {
  let entries: readonly FaviconEntry[] = [];
  for (let n = 0; n < FAVICON_CACHE_MAX_ENTRIES + 5; n++) entries = with_icon(entries, entry(`s${n}.example`));
  assert.equal(entries.length, FAVICON_CACHE_MAX_ENTRIES);
  assert.equal(entries[0]!.host, "s5.example");
});

test("a changed icon replaces the entry and moves it to the newest end", () => {
  let entries = with_icon(with_icon([], entry("a.example")), entry("b.example"));
  entries = with_icon(entries, entry("a.example", "data:image/png;base64,BBBB"));
  assert.deepEqual(entries.map((item) => item.host), ["b.example", "a.example"]);
  assert.equal(entries[1]!.icon, "data:image/png;base64,BBBB");
});

test("the same icon from the same source returns the same list, so nothing is written", () => {
  const before = with_icon([], entry("a.example"));
  assert.equal(with_icon(before, entry("a.example", ICON, "key-a.example")), before);
});

test("only a data: image within the per-entry cap is stored", () => {
  const big = `data:image/png;base64,${"A".repeat(FAVICON_ENTRY_MAX_CHARS)}`;
  for (const icon of [big, "https://a.example/i.png", "chrome://x/y.png", ""]) assert.deepEqual(with_icon([], entry("a.example", icon)), [], icon.slice(0, 30));
  assert.equal(with_icon([], entry("a.example", `data:image/png;base64,${"A".repeat(FAVICON_ENTRY_MAX_CHARS - 22)}`)).length, 1);
});

test("the stored list reads back as a map and skips bad entries", () => {
  const map = icons_by_host([entry("a.example"), { host: 5, icon: ICON }, entry("b.example", "https://x/y"), null]);
  assert.deepEqual([...map], [["a.example", ICON]]);
  assert.equal(icons_by_host("junk").size, 0);
});

test("saves, reads and clears through storage; saves that overlap both land", async () => {
  const storage = fake_storage();
  const cache = make_favicon_cache(storage);
  await Promise.all([cache.save(entry("a.example"), 0), cache.save(entry("b.example"), 0)]);
  assert.deepEqual([...(await cache.read()).keys()].sort(), ["a.example", "b.example"]);
  await cache.clear();
  assert.ok(!(FAVICON_CACHE_KEY in storage.data));
  assert.equal((await cache.read()).size, 0);
});

test("a save of an unchanged entry does not write the list again", async () => {
  const storage = fake_storage();
  const cache = make_favicon_cache(storage);
  await cache.save(entry("a.example"), 0);
  await cache.save(entry("a.example", ICON, "key-a.example"), 0);
  assert.equal(storage.writes.length, 1);
});

test("a save that began before a clear is dropped, even when it lands after", async () => {
  const storage = fake_storage();
  const cache = make_favicon_cache(storage);
  const started_in = cache.generation();
  await cache.clear();
  await cache.save(entry("late.example"), started_in);
  assert.ok(!(FAVICON_CACHE_KEY in storage.data));
  await cache.save(entry("later.example"), cache.generation());
  assert.deepEqual([...(await cache.read()).keys()], ["later.example"]);
});

test("a full storage warns once, not on every save", async () => {
  const warnings: string[] = [];
  const cache = make_favicon_cache(fake_storage(true), (message) => void warnings.push(message));
  for (const host of ["a", "b", "c"]) await cache.save(entry(`${host}.example`), 0);
  assert.equal(warnings.length, 1);
});
