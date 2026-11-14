import assert from "node:assert/strict";
import { test } from "node:test";
import type { NetEnv } from "../src/newtab/net_widget.ts";
import { describe_code, forecast_url, geocode_url, parse_forecast, parse_geocode, round_coordinate, run_weather, start_weather, type WeatherDeps, type WeatherSettings, type WeatherView } from "../src/newtab/weather.ts";

const FORECAST = JSON.stringify({ current: { temperature_2m: 12.4, weather_code: 3 } });
const GEOCODE = JSON.stringify({ results: [{ name: "Oslo", latitude: 59.91273, longitude: 10.74609 }] });

function fake_deps(over: Partial<WeatherDeps> & { allowed?: boolean; is_private?: boolean; fail_fetch?: boolean } = {}) {
  const urls: string[] = [];
  const store: Record<string, unknown> = {};
  const net: NetEnv = {
    fetch: (async (input: string) => {
      urls.push(String(input));
      if (over.fail_fetch) throw new Error("offline");
      return new Response(String(input).includes("geocoding") ? GEOCODE : FORECAST);
    }) as typeof fetch,
    now: () => 5_000_000,
    storage: { get: async (key) => ({ [key]: store[key] }), set: async (items) => void Object.assign(store, items) },
  };
  const calls = { permission_checks: 0, position_reads: 0, permission_requests: 0 };
  const deps: WeatherDeps = {
    page_is_private: async () => over.is_private ?? false,
    has_geolocation_permission: async () => (calls.permission_checks++, over.allowed ?? false),
    current_position: async () => (calls.position_reads++, { latitude: 59.91273, longitude: 10.74609 }),
    request_geolocation_permission: async () => (calls.permission_requests++, true),
    net,
    ...over,
  };
  return { deps, urls, calls };
}

const on = (extra: Partial<WeatherSettings> = {}): WeatherSettings => ({ newtab_weather: true, newtab_weather_units: "metric", ...extra });
const collect = async (settings: WeatherSettings, deps: WeatherDeps) => {
  const views: WeatherView[] = [];
  await run_weather(settings, deps, (view) => views.push(view));
  return views;
};

test("with newtab_weather off nothing is read, asked or fetched", async () => {
  const { deps, urls, calls } = fake_deps({ allowed: true });
  assert.deepEqual(await collect({ newtab_weather: false, newtab_weather_city: "Oslo", newtab_weather_units: "metric" }, deps), []);
  assert.deepEqual(await collect({ newtab_weather_units: "metric" } as WeatherSettings, deps), []);
  assert.deepEqual(urls, []);
  assert.deepEqual(calls, { permission_checks: 0, position_reads: 0, permission_requests: 0 });
});

test("a private page makes no request and reads no position", async () => {
  const { deps, urls, calls } = fake_deps({ is_private: true, allowed: true });
  assert.deepEqual(await collect(on({ newtab_weather_city: "Oslo" }), deps), []);
  assert.deepEqual(urls, []);
  assert.equal(calls.position_reads, 0);
});

test("with no permission and no city the card offers the button and makes no request", async () => {
  const { deps, urls, calls } = fake_deps();
  assert.deepEqual(await collect(on(), deps), [{ kind: "ask_location" }]);
  assert.deepEqual(urls, []);
  assert.equal(calls.position_reads, 0, "a page without the permission never calls geolocation");
});

test("a granted permission sends rounded coordinates and no city", async () => {
  const { deps, urls } = fake_deps({ allowed: true });
  const views = await collect(on({ newtab_weather_city: "Oslo" }), deps);
  assert.equal(urls.length, 1);
  assert.match(urls[0]!, /latitude=59\.91&longitude=10\.75/);
  assert.doesNotMatch(urls[0]!, /59\.912|Oslo/);
  assert.deepEqual(views, [{ kind: "weather", weather: { temperature: 12.4, code: 3, place: "", units: "metric" } }]);
});

test("the city is the fallback: it is geocoded, then the rounded coordinates are sent", async () => {
  const { deps, urls, calls } = fake_deps();
  const views = await collect(on({ newtab_weather_city: " Oslo ", newtab_weather_units: "imperial" }), deps);
  assert.equal(urls.length, 2);
  assert.match(urls[0]!, /^https:\/\/geocoding-api\.open-meteo\.com\/.*name=Oslo&/);
  assert.match(urls[1]!, /^https:\/\/api\.open-meteo\.com\/.*latitude=59\.91&longitude=10\.75.*temperature_unit=fahrenheit/);
  assert.equal(calls.position_reads, 0);
  assert.deepEqual(views, [{ kind: "ask_location" }, { kind: "weather", weather: { temperature: 12.4, code: 3, place: "Oslo", units: "imperial" } }]);
});

test("a failed fetch draws nothing and does not throw", async () => {
  const { deps } = fake_deps({ allowed: true, fail_fetch: true });
  assert.deepEqual(await collect(on(), deps), []);
  const city = fake_deps({ fail_fetch: true });
  assert.deepEqual(await collect(on({ newtab_weather_city: "Oslo" }), city.deps), [{ kind: "ask_location" }], "the button shows, no reading");
});

test("a second run inside the TTL draws from the stored value and makes no request", async () => {
  const { deps, urls } = fake_deps({ allowed: true });
  await collect(on(), deps);
  const second = await collect(on(), deps);
  assert.equal(urls.length, 1);
  assert.ok(second.length >= 1 && second.every((view) => view.kind === "weather"));
});

test("a stored value for metric is not shown for imperial", async () => {
  const { deps, urls } = fake_deps({ allowed: true });
  await collect(on(), deps);
  await collect(on({ newtab_weather_units: "imperial" }), deps);
  assert.equal(urls.length, 2);
});

test("the permission request runs inside the click handler, before any await", () => {
  const { deps, calls } = fake_deps();
  const buttons: { listeners: Record<string, () => void> }[] = [];
  const slot = { replaceChildren() {}, querySelector: () => null, prepend() {}, append(...nodes: { listeners?: Record<string, () => void> }[]) { for (const node of nodes) if (node.listeners) buttons.push(node as never); } };
  const had_document = "document" in globalThis;
  const earlier_document = (globalThis as { document?: unknown }).document;
  Object.assign(globalThis, {
    document: { createElement: () => ({ listeners: {} as Record<string, () => void>, addEventListener(name: string, handler: () => void) { this.listeners[name] = handler; } }) },
  });
  return start_weather(slot as unknown as HTMLElement, on(), deps)
    .finished.then(async () => {
      assert.equal(calls.permission_requests, 0, "drawing the button asks for nothing");
      buttons[0]!.listeners["click"]!();
      assert.equal(calls.permission_requests, 1, "the click asks at once");
      // The grant restarts the card, which draws with the stubbed document, so let it finish before the stub goes.
      await new Promise((done) => setImmediate(done));
    })
    .finally(() => {
      if (had_document) Object.assign(globalThis, { document: earlier_document });
      else delete (globalThis as { document?: unknown }).document;
    });
});

test("the helpers: rounding, urls, parsing and descriptions", () => {
  assert.equal(round_coordinate(59.91273), 59.91);
  assert.equal(round_coordinate(-0.005), -0);
  assert.match(forecast_url(1.23456, -7.89012, "metric"), /latitude=1\.23&longitude=-7\.89.*temperature_unit=celsius/);
  assert.match(geocode_url("Sao Paulo"), /name=Sao\+Paulo/);
  assert.deepEqual(parse_geocode(GEOCODE), { latitude: 59.91, longitude: 10.75, place: "Oslo" });
  assert.equal(parse_geocode("{}"), undefined);
  assert.equal(parse_geocode("not json"), undefined);
  assert.equal(parse_forecast('{"current":{"temperature_2m":"hot"}}'), undefined);
  assert.equal(describe_code(0), "Clear");
  assert.equal(describe_code(63), "Rain");
  assert.equal(describe_code(96), "Thunderstorm");
});

test("a position that never arrives falls back to the city after the timeout", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { deps, urls } = fake_deps({ allowed: true, current_position: () => new Promise(() => {}) });
  const pending = collect(on({ newtab_weather_city: "Oslo" }), deps);
  await new Promise((done) => setImmediate(done));
  context.mock.timers.tick(5000);
  const views = await pending;
  assert.match(urls[0]!, /geocoding/);
  assert.equal(views.length, 1);
});

test("a granted permission with no position and no city draws nothing and offers no button", async () => {
  const { deps, urls } = fake_deps({ allowed: true, current_position: async () => Promise.reject(new Error("denied")) });
  assert.deepEqual(await collect(on(), deps), []);
  assert.deepEqual(urls, []);
});

test("a stored reading draws before the position arrives, and a slow position does not hold it back", async (context) => {
  const first = fake_deps({ allowed: true });
  await collect(on(), first.deps);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const slow = { ...first.deps, current_position: () => new Promise<never>(() => {}) };
  const shown: WeatherView[] = [];
  void run_weather(on(), slow, (view) => shown.push(view));
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  assert.equal(shown.length, 1, "the stored reading drew while the position read was still pending");
});

test("after travel the stored place is replaced: other rounded coordinates fetch again", async () => {
  const first = fake_deps({ allowed: true });
  await collect(on(), first.deps);
  const moved = { ...first.deps, current_position: async () => ({ latitude: 48.85, longitude: 2.35 }) };
  const shown: WeatherView[] = [];
  await run_weather(on(), moved, (view) => shown.push(view));
  assert.equal(first.urls.length, 2, "the new coordinates caused a second forecast request");
  assert.match(first.urls[1]!, /latitude=48\.85&longitude=2\.35/);
});

test("a stored reading older than the age limit is not drawn when the refresh fails", async () => {
  const first = fake_deps({ allowed: true });
  await collect(on(), first.deps);
  const later = { ...first.deps, net: { ...first.deps.net, now: () => 5_000_000 + 7 * 3_600_000, fetch: (async () => Promise.reject(new Error("offline"))) as typeof fetch } };
  assert.deepEqual(await collect(on(), later), []);
});

test("with a city set and no permission the card offers the button and still draws the city reading", async () => {
  const { deps } = fake_deps();
  const views = await collect(on({ newtab_weather_city: "Oslo" }), deps);
  assert.equal(views[0]!.kind, "ask_location");
  assert.deepEqual(views.map((view) => view.kind), ["ask_location", "weather"]);
});

test("once the permission is granted the position wins over the city and no button shows", async () => {
  const { deps, urls } = fake_deps({ allowed: true });
  const views = await collect(on({ newtab_weather_city: "Oslo" }), deps);
  assert.ok(views.every((view) => view.kind === "weather"));
  assert.doesNotMatch(urls.join(" "), /geocoding/);
});

test("a failed forecast at new coordinates takes down the reading of the old place", async () => {
  const first = fake_deps({ allowed: true });
  await collect(on(), first.deps);
  const shown: WeatherView[] = [];
  const moved = { ...first.deps, current_position: async () => ({ latitude: 48.85, longitude: 2.35 }), net: { ...first.deps.net, fetch: (async () => Promise.reject(new Error("offline"))) as typeof fetch } };
  await run_weather(on(), moved, (view) => shown.push(view));
  assert.deepEqual(shown.map((view) => view.kind), ["weather", "clear_reading"]);
});

test("a stopped run sends no forecast request after its geocoding answer arrives", async () => {
  const urls: string[] = [];
  let release_geocode: (() => void) | undefined;
  const base = fake_deps();
  const slow_net = {
    ...base.deps.net,
    fetch: (async (input: string) => {
      urls.push(String(input));
      if (String(input).includes("geocoding")) await new Promise<void>((done) => (release_geocode = done));
      return new Response(String(input).includes("geocoding") ? GEOCODE : FORECAST);
    }) as typeof fetch,
  };
  const slot = { querySelector: () => null, prepend() {}, append() {}, replaceChildren() {} };
  const had_document = "document" in globalThis;
  const earlier_document = (globalThis as { document?: unknown }).document;
  Object.assign(globalThis, { document: { createElement: () => ({ addEventListener() {}, append() {} }) } });
  try {
    const run = start_weather(slot as unknown as HTMLElement, on({ newtab_weather_city: "Oslo" }), { ...base.deps, net: slow_net });
    await new Promise((done) => setImmediate(done));
    run.stop();
    release_geocode!();
    await run.finished;
    assert.equal(urls.length, 1, "only the geocoding request went out");
  } finally {
    if (had_document) Object.assign(globalThis, { document: earlier_document });
    else delete (globalThis as { document?: unknown }).document;
  }
});
