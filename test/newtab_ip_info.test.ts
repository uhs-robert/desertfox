import assert from "node:assert/strict";
import { test } from "node:test";
import { net_cache_key, type NetEnv } from "../src/newtab/net_widget.ts";
import { forget_ip_info, IP_TRACE_URL, is_ip_address, parse_trace, run_ip_info, start_ip_info, type IpInfo, type IpInfoDeps } from "../src/newtab/ip_info.ts";

const TRACE = "fl=1\nh=1.1.1.1\nip=203.0.113.7\nts=1\nloc=NO\ncolo=OSL\n";

function fake_deps(over: { is_private?: boolean; fail_fetch?: boolean; body?: string; now?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const store: Record<string, unknown> = {};
  const net: NetEnv = {
    fetch: (async (input: string, init: RequestInit) => {
      calls.push({ url: String(input), init });
      if (over.fail_fetch) throw new Error("offline");
      return new Response(over.body ?? TRACE);
    }) as typeof fetch,
    now: () => over.now ?? 5_000_000,
    storage: { get: async (key) => ({ [key]: store[key] }), set: async (items) => void Object.assign(store, items) },
  };
  const deps: IpInfoDeps = { page_is_private: async () => over.is_private ?? false, net };
  return { deps, calls, store };
}

const collect = async (on: boolean | undefined, deps: IpInfoDeps) => {
  const shown: IpInfo[] = [];
  await run_ip_info({ newtab_ip_info: on } as never, deps, (info) => shown.push(info));
  return shown;
};

test("with newtab_ip_info off or unset nothing is fetched", async () => {
  const { deps, calls } = fake_deps();
  assert.deepEqual(await collect(false, deps), []);
  assert.deepEqual(await collect(undefined, deps), []);
  assert.deepEqual(calls, []);
});

test("a private page sends nothing, and a failed privacy read counts as private", async () => {
  const { deps, calls } = fake_deps({ is_private: true });
  assert.deepEqual(await collect(true, deps), []);
  const failing = { ...deps, page_is_private: async () => Promise.reject(new Error("no window")) };
  assert.deepEqual(await collect(true, failing), []);
  assert.deepEqual(calls, []);
});

test("the request goes to the trace page with no credentials, referrer or redirect, and draws the ip and country", async () => {
  const { deps, calls, store } = fake_deps();
  assert.deepEqual(await collect(true, deps), [{ ip: "203.0.113.7", country: "NO" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, IP_TRACE_URL);
  assert.equal(calls[0]!.init.credentials, "omit");
  assert.equal(calls[0]!.init.referrerPolicy, "no-referrer");
  assert.equal(calls[0]!.init.redirect, "error");
  assert.deepEqual(Object.keys(store), [net_cache_key("ip")]);
  assert.notEqual(net_cache_key("ip"), net_cache_key("weather"));
});

test("a stored answer under a minute old draws without a request", async () => {
  const first = fake_deps();
  await collect(true, first.deps);
  const second = fake_deps();
  Object.assign(second.store, first.store);
  assert.deepEqual(await collect(true, second.deps), [{ ip: "203.0.113.7", country: "NO" }]);
  assert.equal(second.calls.length, 0);
});

test("a stored answer older than a minute draws first, then each new tab refreshes it", async () => {
  const first = fake_deps({ now: 5_000_000 });
  await collect(true, first.deps);
  const later = fake_deps({ now: 5_000_000 + 61_000, body: "ip=198.51.100.9\nloc=SE" });
  Object.assign(later.store, first.store);
  assert.deepEqual(await collect(true, later.deps), [{ ip: "203.0.113.7", country: "NO" }, { ip: "198.51.100.9", country: "SE" }]);
  assert.equal(later.calls.length, 1);
  // A failed refresh keeps the stored answer on screen, and past the one hour age limit it is not drawn.
  const offline = fake_deps({ now: 5_000_000 + 61_000, fail_fetch: true });
  Object.assign(offline.store, first.store);
  assert.deepEqual(await collect(true, offline.deps), [{ ip: "203.0.113.7", country: "NO" }]);
  const expired = fake_deps({ now: 5_000_000 + 3_600_001, fail_fetch: true });
  Object.assign(expired.store, first.store);
  assert.deepEqual(await collect(true, expired.deps), []);
});

test("a stored value that is not an address and a country code is never drawn", async () => {
  const { deps, store } = fake_deps({ fail_fetch: true });
  store[net_cache_key("ip")] = { key: "trace", at: 5_000_000, value: { ip: "dead", country: "NO" } };
  assert.deepEqual(await collect(true, deps), []);
});

test("is_ip_address takes real IPv4 and IPv6 forms only", () => {
  for (const good of ["203.0.113.7", "0.0.0.0", "255.255.255.255", "2001:db8::1", "::1", "::", "::ffff:192.0.2.1", "fe80:0:0:0:1:2:3:4"]) assert.equal(is_ip_address(good), true, good);
  for (const bad of ["dead", "1.2.3", "256.1.1.1", "01.2.3.4", "1.2.3.4.5", "1:2", ":::", "12345::1", "2001:db8::1::2", "ab", "..", "::g"]) assert.equal(is_ip_address(bad), false, bad);
});

test("forget_ip_info removes only the card's own key", async () => {
  const removed: string[] = [];
  await forget_ip_info(async (key) => void removed.push(key));
  assert.deepEqual(removed, [net_cache_key("ip")]);
});

test("a failed fetch, a bad status text and a captive page draw nothing and do not throw", async () => {
  assert.deepEqual(await collect(true, fake_deps({ fail_fetch: true }).deps), []);
  assert.deepEqual(await collect(true, fake_deps({ body: "<html>sign in</html>" }).deps), []);
  assert.deepEqual(await collect(true, fake_deps({ body: "ip=<script>\nloc=NO" }).deps), []);
});

test("parse_trace takes ip and loc only, and accepts IPv6", () => {
  assert.deepEqual(parse_trace("ip=2001:db8::1\nloc=SE\nuag=x=y"), { ip: "2001:db8::1", country: "SE" });
  assert.equal(parse_trace("loc=NO"), undefined);
  assert.equal(parse_trace("ip=1.2.3.4\nloc=Norway"), undefined);
});

test("a stopped run sends no request and writes no cache", async () => {
  const { deps, calls, store } = fake_deps();
  const slot = { replaceChildren: () => assert.fail("a stopped run drew") } as unknown as HTMLElement;
  const run = start_ip_info(slot, { newtab_ip_info: true }, deps);
  run.stop();
  await run.finished;
  assert.deepEqual(store, {});
  assert.equal(calls.length, 0, "the privacy read is async, so the stop lands before the fetch");
});

test("a draw that throws never rejects the finished promise", async () => {
  const { deps, calls } = fake_deps();
  const slot = { replaceChildren: () => assert.fail("the draw failed") } as unknown as HTMLElement;
  const run = start_ip_info(slot, { newtab_ip_info: true }, deps);
  await run.finished;
  assert.equal(calls.length, 1, "the request ran, so the draw is what threw");
});

test("a run stopped while its request is out draws nothing and writes no cache", async () => {
  const { deps, store } = fake_deps();
  let release: () => void = () => {};
  let started: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const request_started = new Promise<void>((resolve) => (started = resolve));
  const slow = { ...deps, net: { ...deps.net, fetch: (async (input: string, init: RequestInit) => (started(), await gate, deps.net.fetch(input, init))) as typeof fetch } };
  const slot = { replaceChildren: () => assert.fail("a stopped run drew") } as unknown as HTMLElement;
  const run = start_ip_info(slot, { newtab_ip_info: true }, slow);
  await request_started;
  run.stop();
  release();
  await run.finished;
  assert.deepEqual(store, {});
});
