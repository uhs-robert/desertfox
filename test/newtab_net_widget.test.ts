import assert from "node:assert/strict";
import { test } from "node:test";
import { fetch_text, load_cached, net_cache_key, peek_cached, type NetEnv } from "../src/newtab/net_widget.ts";

function fake_env(options: { respond?: (url: string, init: RequestInit) => Promise<Response>; start?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const store: Record<string, unknown> = {};
  const clock = { now: options.start ?? 1_000_000 };
  const env: NetEnv = {
    fetch: (async (input: string, init: RequestInit) => {
      calls.push({ url: String(input), init });
      return options.respond ? options.respond(String(input), init) : new Response("ok");
    }) as typeof fetch,
    now: () => clock.now,
    storage: { get: async (key) => ({ [key]: store[key] }), set: async (items) => void Object.assign(store, items) },
  };
  return { env, calls, store, clock };
}

const is_text = (stored: unknown): stored is string => typeof stored === "string";
const spec = (produce: () => Promise<string | undefined>, key = "k") => ({ name: "card", key, ttl_ms: 1000, max_age_ms: 10_000, produce, is_value: is_text });

test("fetch_text sends no credentials or referrer, and returns the body", async () => {
  const { env, calls } = fake_env();
  assert.equal(await fetch_text("https://x.example/", env), "ok");
  assert.equal(calls[0]!.init.credentials, "omit");
  assert.equal(calls[0]!.init.referrerPolicy, "no-referrer");
});

test("fetch_text returns undefined for a bad status and for a thrown error", async () => {
  assert.equal(await fetch_text("https://x.example/", fake_env({ respond: async () => new Response("no", { status: 500 }) }).env), undefined);
  assert.equal(await fetch_text("https://x.example/", fake_env({ respond: async () => Promise.reject(new Error("offline")) }).env), undefined);
});

test("fetch_text gives up after the timeout by aborting the request", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { env } = fake_env({ respond: (_url, init) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted")))) });
  const pending = fetch_text("https://x.example/", env);
  context.mock.timers.tick(5000);
  assert.equal(await pending, undefined);
});

test("load_cached fetches once, stores the value and shows it", async () => {
  const { env, store } = fake_env();
  const shown: string[] = [];
  await load_cached(spec(async () => "fresh"), env, (value) => shown.push(value));
  assert.deepEqual(shown, ["fresh"]);
  assert.ok(net_cache_key("card") in store);
});

test("load_cached inside the TTL shows the stored value and does not fetch", async () => {
  const { env, clock } = fake_env();
  await load_cached(spec(async () => "first"), env, () => {});
  clock.now += 999;
  let produced = 0;
  const shown: string[] = [];
  await load_cached(spec(async () => (produced++, "second")), env, (value) => shown.push(value));
  assert.equal(produced, 0);
  assert.deepEqual(shown, ["first"]);
});

test("load_cached past the TTL shows the stale value first, then the fresh one", async () => {
  const { env, clock } = fake_env();
  await load_cached(spec(async () => "first"), env, () => {});
  clock.now += 1000;
  const shown: string[] = [];
  await load_cached(spec(async () => "second"), env, (value) => shown.push(value));
  assert.deepEqual(shown, ["first", "second"]);
});

test("load_cached keeps the stale value when the refresh fails, and ignores a value of another key", async () => {
  const { env, clock } = fake_env();
  await load_cached(spec(async () => "first"), env, () => {});
  clock.now += 5000;
  const shown: string[] = [];
  await load_cached(spec(async () => undefined), env, (value) => shown.push(value));
  assert.deepEqual(shown, ["first"]);
  const other: string[] = [];
  await load_cached(spec(async () => undefined, "other"), env, (value) => other.push(value));
  assert.deepEqual(other, [], "a failure with no usable stored value draws nothing");
});

test("a broken store only costs a fetch", async () => {
  const { env } = fake_env();
  env.storage = { get: async () => Promise.reject(new Error("no storage")), set: async () => Promise.reject(new Error("no storage")) };
  const shown: string[] = [];
  await load_cached(spec(async () => "fresh"), env, (value) => shown.push(value));
  assert.deepEqual(shown, ["fresh"]);
});

test("a stored value older than max_age_ms is not shown, and a failed refresh draws nothing", async () => {
  const { env, clock } = fake_env();
  await load_cached(spec(async () => "first"), env, () => {});
  clock.now += 10_000;
  const shown: string[] = [];
  await load_cached(spec(async () => undefined), env, (value) => shown.push(value));
  assert.deepEqual(shown, []);
});

test("two cards keep their own storage keys, so one write never erases the other", async () => {
  const { env, store } = fake_env();
  await Promise.all([load_cached({ ...spec(async () => "a"), name: "one" }, env, () => {}), load_cached({ ...spec(async () => "b"), name: "two" }, env, () => {})]);
  assert.deepEqual([net_cache_key("one") in store, net_cache_key("two") in store], [true, true]);
});

test("peek_cached matches a key prefix and the age limit only", async () => {
  const { env, clock } = fake_env();
  await load_cached(spec(async () => "first", "geo:1,2|metric"), env, () => {});
  assert.equal(await peek_cached("card", "geo:", 10_000, is_text, env), "first");
  assert.equal(await peek_cached("card", "city:", 10_000, is_text, env), undefined);
  assert.equal(await peek_cached("card", "geo:", 10_000, is_text, env, "|metric"), "first");
  assert.equal(await peek_cached("card", "geo:", 10_000, is_text, env, "|auto"), undefined, "a key made for another units setting is not previewed");
  clock.now += 10_000;
  assert.equal(await peek_cached("card", "geo:", 10_000, is_text, env), undefined);
});
