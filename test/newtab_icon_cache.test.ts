import assert from "node:assert/strict";
import { test } from "node:test";
import { FAVICON_CACHE_KEY, FAVICON_CACHE_MAX_ENTRIES, FAVICON_MAX_CHARS, icons_by_host, make_favicon_cache, with_icon, type FaviconEntry } from "../src/newtab/icon_cache.ts";

const ICON = "data:image/png;base64,AAAA";
const visit = (host: string, icon: string | undefined | null = ICON, incognito = false) => ({ url: `https://${host}/page`, icon: icon ?? undefined, incognito });

function fake_storage() {
  const data: Record<string, unknown> = {};
  return { data, get: async (key: string) => (key in data ? { [key]: data[key] } : {}), set: async (items: Record<string, unknown>) => void Object.assign(data, items), remove: async (key: string) => void delete data[key] };
}

test("the cache holds at most 200 sites and drops the oldest", () => {
  let entries: readonly FaviconEntry[] = [];
  for (let n = 0; n < FAVICON_CACHE_MAX_ENTRIES + 5; n++) entries = with_icon(entries, visit(`s${n}.example`));
  assert.equal(entries.length, FAVICON_CACHE_MAX_ENTRIES);
  assert.equal(entries[0]!.host, "s5.example");
});

test("a site that loads again moves to the newest end and keeps one entry", () => {
  let entries = with_icon(with_icon([], visit("a.example")), visit("b.example"));
  entries = with_icon(entries, visit("a.example", "data:image/png;base64,BBBB"));
  assert.deepEqual(entries.map((entry) => entry.host), ["b.example", "a.example"]);
  assert.equal(entries[1]!.icon, "data:image/png;base64,BBBB");
});

test("only a small data: image is stored", () => {
  const big = `data:image/png;base64,${"A".repeat(FAVICON_MAX_CHARS)}`;
  for (const icon of [big, "https://a.example/i.png", "chrome://x/y.png", null]) assert.deepEqual(with_icon([], visit("a.example", icon)), [], String(icon).slice(0, 30));
  assert.equal(with_icon([], visit("a.example", `data:image/png;base64,${"A".repeat(FAVICON_MAX_CHARS - 22)}`)).length, 1);
});

test("a private tab and a non-web address store nothing", () => {
  assert.deepEqual(with_icon([], visit("a.example", ICON, true)), []);
  assert.deepEqual(with_icon([], { url: "about:newtab", icon: ICON, incognito: false }), []);
});

test("the stored list reads back as a map and skips bad entries", () => {
  const map = icons_by_host([{ host: "a.example", icon: ICON }, { host: 5, icon: ICON }, { host: "b.example", icon: "https://x/y" }, null]);
  assert.deepEqual([...map], [["a.example", ICON]]);
  assert.equal(icons_by_host("junk").size, 0);
});

test("the cache stores, reads, and clears through storage; stores that overlap both land", async () => {
  const storage = fake_storage();
  const cache = make_favicon_cache(storage);
  await Promise.all([cache.store(visit("a.example")), cache.store(visit("b.example")), cache.store(visit("p.example", ICON, true))]);
  assert.deepEqual([...(await cache.read()).keys()].sort(), ["a.example", "b.example"]);
  await cache.clear();
  assert.ok(!(FAVICON_CACHE_KEY in storage.data));
  assert.equal((await cache.read()).size, 0);
});
