import assert from "node:assert/strict";
import { test } from "node:test";
import type { NetEnv } from "../src/newtab/net_widget.ts";
import { draw_weather_icon, icon_kind } from "../src/newtab/weather_icon.ts";
import { clock_text, compass_point, hours_that_fit, hours_from_now } from "../src/newtab/weather_detail.ts";
import { net_cache_key } from "../src/newtab/net_widget.ts";
import { air_band, air_level, air_quality_url, parse_air_quality } from "../src/newtab/air_quality.ts";
import { describe_code, draw_weather, forecast_url, forget_weather, geocode_url, parse_forecast, parse_geocode, round_coordinate, run_weather, start_weather, type WeatherDeps, type WeatherSettings, type WeatherView } from "../src/newtab/weather.ts";

const NOW_MS = Date.parse("2026-11-14T14:30:00Z");
const HOUR_TIMES = Array.from({ length: 12 }, (_, index) => new Date(Date.UTC(2026, 10, 14, 15 + index)).toISOString().slice(0, 16));
const forecast_body = (over: Record<string, unknown> = {}) => ({
  utc_offset_seconds: 3600,
  current: { temperature_2m: 12.4, apparent_temperature: 10.1, relative_humidity_2m: 44, weather_code: 3, wind_speed_10m: 11.6, wind_direction_10m: 320 },
  hourly: { time: HOUR_TIMES, temperature_2m: HOUR_TIMES.map((_, index) => 12 - index), precipitation_probability: HOUR_TIMES.map((_, index) => 30 + index), weather_code: HOUR_TIMES.map((_, index) => (index % 2 ? 61 : 3)) },
  daily: { time: ["2026-11-14"], temperature_2m_max: [14.2], temperature_2m_min: [5.8], uv_index_max: [2.4], sunrise: ["2026-11-14T07:42"], sunset: ["2026-11-14T15:31"] },
  ...over,
});
const FORECAST = JSON.stringify(forecast_body());
const WEATHER_CARD = { temperature: 12.4, feels_like: 10.1, humidity: 44, rain_chance: 30, high: 14.2, low: 5.8, date: "2026-11-14", utc_offset_seconds: 3600, wind_speed: 11.6, wind_direction: 320, latitude: 59.91, longitude: 10.75, code: 3 };
const WEATHER_DETAIL = { uv_index: 2.4, sunrise: "07:42", sunset: "15:31", hours: HOUR_TIMES.map((time, index) => ({ time, temperature: 12 - index, rain_chance: 30 + index, code: index % 2 ? 61 : 3 })) };
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
    now: () => NOW_MS,
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

const on = (extra: Partial<WeatherSettings> = {}): WeatherSettings => ({ newtab_weather: true, newtab_weather_units: "metric", newtab_clock_format: 12, ...extra });
const collect = async (settings: WeatherSettings, deps: WeatherDeps) => {
  const views: WeatherView[] = [];
  await run_weather(settings, deps, (view) => views.push(view));
  return views;
};

test("with newtab_weather off nothing is read, asked or fetched", async () => {
  const { deps, urls, calls } = fake_deps({ allowed: true });
  assert.deepEqual(await collect(on({ newtab_weather: false, newtab_weather_city: "Oslo" }), deps), []);
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
  assert.deepEqual(views, [{ kind: "weather", weather: { ...WEATHER_CARD, detail: WEATHER_DETAIL, place: "", units: "metric" } }]);
});

test("the city is the fallback: it is geocoded, then the rounded coordinates are sent", async () => {
  const { deps, urls, calls } = fake_deps();
  const views = await collect(on({ newtab_weather_city: " Oslo ", newtab_weather_units: "imperial" }), deps);
  assert.equal(urls.length, 2);
  assert.match(urls[0]!, /^https:\/\/geocoding-api\.open-meteo\.com\/.*name=Oslo&/);
  assert.match(urls[1]!, /^https:\/\/api\.open-meteo\.com\/.*latitude=59\.91&longitude=10\.75.*temperature_unit=fahrenheit/);
  assert.equal(calls.position_reads, 0);
  assert.deepEqual(views, [{ kind: "ask_location" }, { kind: "weather", weather: { ...WEATHER_CARD, detail: WEATHER_DETAIL, place: "Oslo", units: "imperial" } }]);
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
  assert.equal(parse_forecast('{"current":{"temperature_2m":1,"weather_code":0}}'), undefined, "feels-like and humidity are required");
  assert.equal(icon_kind(0), "clear");
  assert.equal(icon_kind(61), "rain");
  assert.equal(icon_kind(73), "snow");
  assert.equal(icon_kind(95), "storm");
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
  const later = { ...first.deps, net: { ...first.deps.net, now: () => NOW_MS + 7 * 3_600_000, fetch: (async () => Promise.reject(new Error("offline"))) as typeof fetch } };
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

test("the rain chance is the first hour, and a missing or odd value leaves it out", () => {
  const base = { current: { temperature_2m: 1, apparent_temperature: 0, relative_humidity_2m: 50, weather_code: 0, wind_speed_10m: 3, wind_direction_10m: 90 }, utc_offset_seconds: 0, daily: { time: ["2026-11-14"], temperature_2m_max: [2], temperature_2m_min: [0] } };
  assert.equal(parse_forecast(JSON.stringify({ ...base, hourly: { precipitation_probability: [70, 10] } }))?.rain_chance, 70);
  assert.equal("rain_chance" in parse_forecast(JSON.stringify(base))!, false);
  assert.equal("rain_chance" in parse_forecast(JSON.stringify({ ...base, hourly: { precipitation_probability: [null] } }))!, false);
});

test("a stored reading from before feels-like and humidity is not used", async () => {
  const { deps, urls } = fake_deps({ allowed: true });
  await deps.net.storage.set({ newtab_net_cache_weather: { key: "geo:59.91,10.75|metric", at: NOW_MS, value: { temperature: 1, code: 0, place: "", units: "metric" } } });
  const views = await collect(on(), deps);
  assert.equal(urls.length, 1, "the old shape forced a fresh request");
  assert.deepEqual(views.map((view) => view.kind), ["weather"]);
});

test("a failed position takes down the preview of the old place, with or without a city", async () => {
  const first = fake_deps({ allowed: true });
  await collect(on(), first.deps);
  const lost = { ...first.deps, current_position: async () => Promise.reject(new Error("denied")) };
  const without_city: WeatherView[] = [];
  await run_weather(on(), lost, (view) => without_city.push(view));
  assert.deepEqual(without_city.map((view) => view.kind), ["weather", "clear_reading"]);
  const offline = { ...lost, net: { ...first.deps.net, fetch: (async () => Promise.reject(new Error("offline"))) as typeof fetch } };
  const failed_city: WeatherView[] = [];
  await run_weather(on({ newtab_weather_city: "Paris" }), offline, (view) => failed_city.push(view));
  assert.deepEqual(failed_city.map((view) => view.kind), ["weather", "clear_reading"]);
});

// A small stand-in for the parts of the DOM the card uses, so a redraw can be driven without a browser.
class FakeNode {
  tag: string;
  children: FakeNode[] = [];
  attributes = new Map<string, string>();
  listeners: Record<string, () => void> = {};
  class_name = "";
  text = "";
  hidden = false;
  id = "";
  title = "";
  type = "";
  parent: FakeNode | undefined;
  constructor(tag: string) {
    this.tag = tag;
  }
  set className(value: string) { this.class_name = value; }
  get className() { return this.class_name; }
  set textContent(value: string) { this.text = value; }
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(""); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  addEventListener(name: string, handler: () => void) { this.listeners[name] = handler; }
  append(...nodes: FakeNode[]) { for (const node of nodes) (node.parent = this, this.children.push(node)); }
  prepend(...nodes: FakeNode[]) { for (const node of nodes) node.parent = this; this.children.unshift(...nodes); }
  replaceChildren() { this.children = []; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = undefined; }
  after(node: FakeNode) { const siblings = this.parent!.children; node.parent = this.parent; siblings.splice(siblings.indexOf(this) + 1, 0, node); }
  is_root = false;
  style: Record<string, string> = {};
  get isConnected(): boolean { return this.is_root || (this.parent?.isConnected ?? false); }
  all(): FakeNode[] { return this.children.flatMap((child) => [child, ...child.all()]); }
  querySelector(selector: string) { return this.all().find((node) => node.class_name.split(" ").includes(selector.slice(1))) ?? null; }
  querySelectorAll(selector: string) { return this.all().filter((node) => node.class_name.split(" ").includes(selector.slice(1))); }
}

function with_fake_document<T>(body: () => Promise<T> | T): Promise<T> {
  const had_document = "document" in globalThis;
  const earlier_document = (globalThis as { document?: unknown }).document;
  Object.assign(globalThis, { document: { createElement: (tag: string) => new FakeNode(tag), createElementNS: (_: string, tag: string) => new FakeNode(tag) } });
  return Promise.resolve(body()).finally(() => {
    if (had_document) Object.assign(globalThis, { document: earlier_document });
    else delete (globalThis as { document?: unknown }).document;
  });
}

const weather_view = (over: Record<string, unknown> = {}): WeatherView => ({ kind: "weather", weather: { ...WEATHER_CARD, detail: WEATHER_DETAIL, place: "Oslo", units: "metric", ...over } as never });

test("the forecast url asks for the card, the daily set and 12 hours in one request, with mph only for imperial", () => {
  const metric = new URL(forecast_url(59.91273, 10.74609, "metric"));
  assert.equal(metric.searchParams.get("current"), "temperature_2m,weather_code,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m");
  assert.equal(metric.searchParams.get("hourly"), "temperature_2m,precipitation_probability,weather_code");
  assert.equal(metric.searchParams.get("daily"), "temperature_2m_max,temperature_2m_min,uv_index_max,sunrise,sunset");
  assert.equal(metric.searchParams.get("forecast_hours"), "12");
  assert.equal(metric.searchParams.get("forecast_days"), "1");
  assert.equal(metric.searchParams.get("timezone"), "auto");
  assert.equal(metric.searchParams.get("wind_speed_unit"), null);
  assert.equal(metric.searchParams.get("latitude"), "59.91");
  assert.equal(new URL(forecast_url(1, 2, "imperial")).searchParams.get("wind_speed_unit"), "mph");
});

test("a full run sends exactly one forecast request", async () => {
  const { deps, urls } = fake_deps({ allowed: true });
  await collect(on(), deps);
  assert.equal(urls.length, 1);
});

test("parse_forecast reads the card, the daily set and the hours, and slices local times without a date parse", () => {
  const parsed = parse_forecast(FORECAST)!;
  const { latitude: _latitude, longitude: _longitude, ...card } = WEATHER_CARD;
  assert.deepEqual(parsed, { ...card, detail: WEATHER_DETAIL });
});

test("a missing daily block or odd hours leave the card, and only the detail group goes", () => {
  const no_daily = parse_forecast(JSON.stringify(forecast_body({ daily: { time: ["2026-11-14"], temperature_2m_max: [1], temperature_2m_min: [0] } })))!;
  assert.equal(no_daily.high, 1);
  assert.equal("detail" in no_daily, false);
  assert.equal(parse_forecast(JSON.stringify(forecast_body({ daily: {} }))), undefined, "high and low are card fields");
  assert.equal(parse_forecast(JSON.stringify(forecast_body({ current: { temperature_2m: 1, apparent_temperature: 0, relative_humidity_2m: 5, weather_code: 0 } }))), undefined, "wind is a card field");
  const uneven = parse_forecast(JSON.stringify(forecast_body({ hourly: { time: ["2026-11-14T15:00", "2026-11-14T16:00", 7], temperature_2m: [3, "x"], precipitation_probability: [10], weather_code: [3, 3] } })))!;
  assert.deepEqual(uneven.detail!.hours, [{ time: "2026-11-14T15:00", temperature: 3, rain_chance: 10, code: 3 }]);
});

test("a stored entry of the previous shape is fetched again once instead of throwing", async () => {
  const { deps, urls } = fake_deps({ allowed: true });
  await deps.net.storage.set({ newtab_net_cache_weather: { key: "geo:59.91,10.75|metric", at: NOW_MS, value: { temperature: 1, feels_like: 0, humidity: 5, rain_chance: 3, code: 0, place: "", units: "metric" } } });
  const views = await collect(on(), deps);
  assert.equal(urls.length, 1);
  assert.deepEqual(views.map((view) => view.kind), ["weather"]);
  await collect(on(), deps);
  assert.equal(urls.length, 1, "the new entry is kept");
});

test("compass points: the eight sides, wrap at the top and the half-step boundary", () => {
  assert.deepEqual([0, 45, 90, 180, 270, 315, 359, 360, -45].map(compass_point), ["N", "NE", "E", "S", "W", "NW", "N", "N", "NW"]);
  assert.equal(compass_point(22.4), "N");
  assert.equal(compass_point(22.5), "NE");
});

test("clock text follows the 12 or 24 hour format", () => {
  assert.equal(clock_text("07:42", 12), "7:42 AM");
  assert.equal(clock_text("15:31", 12), "3:31 PM");
  assert.equal(clock_text("00:05", 12), "12:05 AM");
  assert.equal(clock_text("12:00", 12), "12:00 PM");
  assert.equal(clock_text("15:31", 24), "15:31");
});

test("the strip keeps the place's current hour and the hours after it, in the place's time", () => {
  assert.equal(hours_from_now(WEATHER_DETAIL.hours, 3600, NOW_MS)[0]!.time, "2026-11-14T15:00", "14:30 UTC with +1 h is 15:30 there, so 15:00 is the current hour and stays");
  assert.equal(hours_from_now(WEATHER_DETAIL.hours, 3600, NOW_MS).length, 11);
  assert.equal(hours_from_now(WEATHER_DETAIL.hours, 3600, NOW_MS + 3 * 3_600_000).length, 9);
  assert.equal(hours_from_now(WEATHER_DETAIL.hours, 0, NOW_MS)[0]!.time, "2026-11-14T15:00");
});

test("the card shows high and low, wind in the unit and the icon with a label, and hides the strip under 3 hours", () =>
  with_fake_document(() => {
    const slot = new FakeNode("div");
    draw_weather(slot as never, weather_view(), () => {}, 24, () => NOW_MS);
    const values = slot.querySelectorAll(".weather-value").map((node) => node.textContent);
    assert.ok(values.includes("14\u00b0 / 6\u00b0") && values.includes("12 km/h NW"), values.join("|"));
    assert.equal(slot.querySelectorAll(".weather-hour").length, 11);
    assert.equal(slot.querySelectorAll(".weather-hour")[0]!.textContent, "Now12\u00b030%");
    const icon = slot.querySelector(".weather-reading")!.all().find((node) => node.tag === "svg")!;
    assert.equal(icon.getAttribute("role"), "img");
    assert.equal(icon.getAttribute("aria-label"), "Overcast");
    assert.equal(icon.getAttribute("aria-hidden"), null);
    const imperial = new FakeNode("div");
    draw_weather(imperial as never, weather_view({ units: "imperial" }), () => {}, 12, () => NOW_MS);
    assert.ok(imperial.querySelectorAll(".weather-value").some((node) => node.textContent === "12 mph NW"));
    assert.equal(imperial.querySelectorAll(".weather-hour")[0]!.textContent, "Now12\u00b030%");
    const late = new FakeNode("div");
    draw_weather(late as never, weather_view(), () => {}, 12, () => Date.parse("2026-11-15T00:00:00Z") + 5 * 3_600_000);
    assert.equal(late.querySelector(".weather-hours"), null, "too few hours left for a strip");
    assert.ok(late.querySelector(".weather-more"), "the facts remain");
    const none = new FakeNode("div");
    draw_weather(none as never, weather_view({ detail: undefined }), () => {}, 12, () => NOW_MS);
    assert.equal(none.querySelector(".weather-more"), null);
  }));

test("the More button toggles the panel with aria-expanded, and the open state survives the second show", () =>
  with_fake_document(() => {
    const slot = new FakeNode("div");
    draw_weather(slot as never, weather_view(), () => {}, 12, () => NOW_MS);
    const button = () => slot.querySelector(".weather-more")!;
    const panel = () => slot.querySelector(".weather-detail")!;
    assert.equal(button().getAttribute("aria-expanded"), "false");
    assert.equal(button().textContent, "More");
    assert.equal(panel().hidden, true);
    assert.equal(button().getAttribute("aria-controls"), panel().id);
    button().listeners["click"]!();
    assert.equal(button().getAttribute("aria-expanded"), "true");
    assert.equal(button().textContent, "Less");
    assert.equal(panel().hidden, false);
    const first_panel = panel();
    draw_weather(slot as never, weather_view({ temperature: 20 }), () => {}, 12, () => NOW_MS);
    assert.notEqual(panel(), first_panel, "the reading was rebuilt");
    assert.equal(button().getAttribute("aria-expanded"), "true");
    assert.equal(panel().hidden, false);
    button().listeners["click"]!();
    draw_weather(slot as never, weather_view(), () => {}, 12, () => NOW_MS);
    assert.equal(button().getAttribute("aria-expanded"), "false");
    assert.equal(slot.querySelectorAll(".weather-reading").length, 1);
  }));

test("a redraw that stops the run while the forecast is out draws nothing late and writes no cache", () =>
  with_fake_document(async () => {
    const base = fake_deps({ allowed: true });
    let release: (() => void) | undefined;
    const store: Record<string, unknown> = {};
    const net: NetEnv = {
      ...base.deps.net,
      fetch: (async () => {
        await new Promise<void>((done) => (release = done));
        return new Response(FORECAST);
      }) as typeof fetch,
      storage: { get: async (key) => ({ [key]: store[key] }), set: async (items) => void Object.assign(store, items) },
    };
    const slot = new FakeNode("div");
    const run = start_weather(slot as never, on(), { ...base.deps, net });
    await new Promise((done) => setImmediate(done));
    run.stop();
    release!();
    await run.finished;
    assert.equal(slot.querySelector(".weather-reading"), null, "no late answer was drawn");
    assert.deepEqual(store, {}, "no late answer was stored");
  }));

test("a location grant while the forecast is out stops the old run and only the new run draws", () =>
  with_fake_document(async () => {
    const base = fake_deps();
    let allowed = false;
    const releases: (() => void)[] = [];
    const store: Record<string, unknown> = {};
    let fetches = 0;
    const net: NetEnv = {
      ...base.deps.net,
      fetch: (async () => {
        fetches++;
        await new Promise<void>((done) => releases.push(done));
        return new Response(String(fetches) === "1" ? JSON.stringify(forecast_body({ current: { ...forecast_body().current, temperature_2m: 99 } })) : FORECAST);
      }) as typeof fetch,
      storage: { get: async (key) => ({ [key]: store[key] }), set: async (items) => void Object.assign(store, items) },
    };
    const slot = new FakeNode("div");
    const deps = { ...base.deps, has_geolocation_permission: async () => allowed, request_geolocation_permission: async () => ((allowed = true), true), net };
    const run = start_weather(slot as never, on({ newtab_weather_city: "Oslo" }), deps);
    // The city run: geocoding is request 1 and holds.
    await new Promise((done) => setImmediate(done));
    slot.querySelector(".weather-ask")!.listeners["click"]!();
    await new Promise((done) => setImmediate(done));
    assert.equal(slot.querySelector(".weather-ask"), null, "the grant cleared the card");
    for (let turn = 0; turn < 5; turn++) {
      for (const release of releases.splice(0)) release();
      await new Promise((done) => setImmediate(done));
    }
    run.stop();
    await run.finished;
    const temps = slot.querySelectorAll(".weather-temp").map((node) => node.textContent);
    assert.deepEqual(temps, ["12\u00b0"], "only the run the grant started drew");
    assert.equal((store["newtab_net_cache_weather"] as { key: string }).key.startsWith("geo:"), true);
  }));

test("forget_weather removes the forecast and the air quality keys and nothing else", async () => {
  const removed: string[] = [];
  await forget_weather(async (key) => void removed.push(key));
  assert.deepEqual(removed, [net_cache_key("weather"), net_cache_key("air")]);
});

test("the weather icon carries role img and its label instead of aria-hidden", () =>
  with_fake_document(() => {
    const icon = draw_weather_icon(0, "Clear") as unknown as FakeNode;
    assert.deepEqual([icon.getAttribute("role"), icon.getAttribute("aria-label"), icon.getAttribute("aria-hidden")], ["img", "Clear", null]);
  }));

test("a stored answer is used until the place's date moves on, then fetched again", async () => {
  const at = (iso: string) => () => Date.parse(iso);
  const run_at = async (later_iso: string) => {
    const { deps, urls } = fake_deps({ allowed: true });
    await collect(on(), { ...deps, net: { ...deps.net, now: at("2026-11-14T22:40:00Z") } });
    const views = await collect(on(), { ...deps, net: { ...deps.net, now: at(later_iso) } });
    return { urls: urls.length, views };
  };
  const same_day = await run_at("2026-11-14T22:50:00Z");
  assert.equal(same_day.urls, 1, "23:50 at the place is still the forecast's date");
  assert.ok(same_day.views.length >= 1 && same_day.views.every((view) => view.kind === "weather"));
  const next_day = await run_at("2026-11-14T23:10:00Z");
  assert.equal(next_day.urls, 2, "00:10 at the place is a new date, so the answer within the TTL is fetched again");
  assert.deepEqual(next_day.views.map((view) => view.kind), ["weather"], "only the fresh answer was drawn, not the stored one");
});

test("a forecast with no local date or offset is not a card", () => {
  assert.equal(parse_forecast(JSON.stringify(forecast_body({ daily: { temperature_2m_max: [1], temperature_2m_min: [0] } }))), undefined);
  assert.equal(parse_forecast(JSON.stringify(forecast_body({ utc_offset_seconds: undefined }))), undefined);
  assert.equal(parse_forecast(JSON.stringify(forecast_body({ daily: { ...forecast_body().daily, time: ["14.11.2026"] } }))), undefined);
});

test("opening More draws the strip again, so hours that passed while it was closed are gone", () =>
  with_fake_document(() => {
    let now_ms = NOW_MS;
    const slot = new FakeNode("div");
    draw_weather(slot as never, weather_view(), () => {}, 12, () => now_ms);
    const strip_hours = () => slot.querySelectorAll(".weather-hour").length;
    assert.equal(strip_hours(), 11);
    now_ms = NOW_MS + 4 * 3_600_000;
    slot.querySelector(".weather-more")!.listeners["click"]!();
    assert.equal(strip_hours(), 8, "four hours later, four fewer");
    slot.querySelector(".weather-more")!.listeners["click"]!();
    now_ms = NOW_MS + 10 * 3_600_000;
    slot.querySelector(".weather-more")!.listeners["click"]!();
    assert.equal(slot.querySelector(".weather-hours"), null, "under the minimum the strip goes");
    assert.equal(slot.querySelectorAll(".weather-detail").length, 1);
  }));

// The air quality row. A stored forecast keeps the weather fetch out of these tests, so every request counted here is an air quality request.
const AIR_BODY = JSON.stringify({ current: { european_aqi: 34, us_aqi: 61, pm2_5: 8.4, pm10: 14.9, ozone: 70.2 } });
async function air_card(over: { units?: "metric" | "imperial"; air_response?: () => Promise<Response>; air_seed?: { at: number } } = {}) {
  const units = over.units ?? "metric";
  const store: Record<string, unknown> = { newtab_net_cache_weather: { key: `city:Oslo|${units}`, at: NOW_MS, value: { ...(weather_view() as { weather: object }).weather, units } } };
  if (over.air_seed) store["newtab_net_cache_air"] = { key: `59.91,10.75|${units}`, at: over.air_seed.at, value: { scale: units === "imperial" ? "us" : "eu", index: 10 } };
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const net: NetEnv = {
    fetch: (async (input: string, init?: RequestInit) => (requests.push({ url: String(input), init }), over.air_response ? over.air_response() : new Response(AIR_BODY))) as typeof fetch,
    now: () => NOW_MS,
    storage: { get: async (key) => ({ [key]: store[key] }), set: async (items) => void Object.assign(store, items) },
  };
  const slot = new FakeNode("div");
  slot.is_root = true;
  const run = start_weather(slot as never, on({ newtab_weather_city: "Oslo", newtab_weather_units: units }), { ...fake_deps().deps, net });
  await run.finished;
  const click = () => slot.querySelector(".weather-more")!.listeners["click"]!();
  const air_text = () => slot.querySelector(".weather-air")?.textContent ?? null;
  return { slot, run, store, requests, click, air_text };
}
const settle = async () => { for (let turn = 0; turn < 6; turn++) await new Promise((done) => setImmediate(done)); };

test("the air quality url asks for the US index for imperial and the European index for metric, with the rounded coordinates", () => {
  const imperial = new URL(air_quality_url({ latitude: 59.91, longitude: 10.75, units: "imperial" }));
  assert.equal(imperial.host, "air-quality-api.open-meteo.com");
  assert.equal(imperial.searchParams.get("current"), "us_aqi,pm2_5,pm10,ozone");
  assert.equal(imperial.searchParams.get("latitude"), "59.91");
  assert.equal(new URL(air_quality_url({ latitude: 1, longitude: 2, units: "metric" })).searchParams.get("current"), "european_aqi,pm2_5,pm10,ozone");
});

test("air quality parsing takes the scale of the units, keeps what is numeric and refuses an answer with no index", () => {
  assert.deepEqual(parse_air_quality(AIR_BODY, "metric"), { scale: "eu", index: 34, pm2_5: 8.4, pm10: 14.9, ozone: 70.2 });
  assert.deepEqual(parse_air_quality(AIR_BODY, "imperial"), { scale: "us", index: 61, pm2_5: 8.4, pm10: 14.9, ozone: 70.2 });
  assert.deepEqual(parse_air_quality(JSON.stringify({ current: { us_aqi: 5, pm10: "x" } }), "imperial"), { scale: "us", index: 5 });
  for (const bad of ["not json", "null", "{}", JSON.stringify({ current: { us_aqi: null } }), JSON.stringify({ current: { us_aqi: 5 } })]) if (bad !== "x") assert.equal(parse_air_quality(bad, "metric"), undefined, bad);
});

test("each band label sits at its limit", () => {
  assert.deepEqual([0, 50, 51, 100, 101, 150, 151, 200, 201, 300, 301].map((index) => air_band({ scale: "us", index })), ["Good", "Good", "Moderate", "Moderate", "Sensitive", "Sensitive", "Unhealthy", "Unhealthy", "Very unhealthy", "Very unhealthy", "Hazardous"]);
  assert.deepEqual([0, 20, 21, 40, 60, 80, 100, 101].map((index) => air_band({ scale: "eu", index })), ["Good", "Good", "Fair", "Fair", "Moderate", "Poor", "Very poor", "Extremely poor"]);
});

test("a card that is drawn but never opened sends no air quality request", () =>
  with_fake_document(async () => {
    const card = await air_card();
    await settle();
    assert.ok(card.slot.querySelector(".weather-more"));
    assert.deepEqual(card.requests, []);
    assert.equal(card.air_text(), null);
  }));

test("opening More sends one request without credentials, draws the row in the units' scale and caches it under its own key", () =>
  with_fake_document(async () => {
    const card = await air_card();
    card.click();
    await settle();
    assert.equal(card.requests.length, 1);
    assert.match(card.requests[0]!.url, /^https:\/\/air-quality-api\.open-meteo\.com\/v1\/air-quality\?latitude=59\.91&longitude=10\.75&current=european_aqi/);
    assert.equal(card.requests[0]!.init?.credentials, "omit");
    assert.equal(card.air_text(), "Air quality (EU AQI)34 FairPM2.58PM1015Ozone70");
    assert.equal((card.store["newtab_net_cache_air"] as { key: string }).key, "59.91,10.75|metric");
    const imperial = await air_card({ units: "imperial" });
    imperial.click();
    await settle();
    assert.equal(imperial.air_text(), "Air quality (US AQI)61 ModeratePM2.58PM1015Ozone70");
  }));

test("opening More twice quickly sends one request", () =>
  with_fake_document(async () => {
    const release: (() => void)[] = [];
    const card = await air_card({ air_response: () => new Promise((done) => release.push(() => done(new Response(AIR_BODY)))) });
    card.click();
    card.click();
    card.click();
    await settle();
    assert.equal(card.requests.length, 1);
    release[0]!();
    await settle();
    assert.equal(card.air_text()?.includes("34 Fair"), true, "the joined open still drew the row");
    card.click();
    card.click();
    await settle();
    assert.equal(card.requests.length, 1, "a fresh stored answer needs no request");
  }));

test("closing the panel while the request is out leaves no late draw, and the next open draws from the stored answer", () =>
  with_fake_document(async () => {
    const release: (() => void)[] = [];
    const card = await air_card({ air_response: () => new Promise((done) => release.push(() => done(new Response(AIR_BODY)))) });
    card.click();
    await settle();
    card.click();
    release[0]!();
    await settle();
    assert.equal(card.air_text(), null, "no row was drawn into the closed panel");
    card.click();
    await settle();
    assert.equal(card.requests.length, 1);
    assert.equal(card.air_text()?.includes("34 Fair"), true);
  }));

test("a redraw while the request is out leaves no late draw and no cache write", () =>
  with_fake_document(async () => {
    const release: (() => void)[] = [];
    const card = await air_card({ air_response: () => new Promise((done) => release.push(() => done(new Response(AIR_BODY)))) });
    card.click();
    await settle();
    card.run.stop();
    release[0]!();
    await settle();
    assert.equal(card.air_text(), null);
    assert.equal("newtab_net_cache_air" in card.store, false);
    const rebuilt = card.slot.querySelector(".weather-reading");
    draw_weather(card.slot as never, weather_view({ temperature: 20 }), () => {}, 12, () => NOW_MS);
    assert.notEqual(card.slot.querySelector(".weather-reading"), rebuilt);
    release.splice(0);
    await settle();
    assert.equal(card.air_text(), null, "the old panel is off the page, so its listener drew nothing");
  }));

test("a stale stored answer shows at once and is refreshed, and one past the max age is not shown", () =>
  with_fake_document(async () => {
    const stale = await air_card({ air_seed: { at: NOW_MS - 31 * 60_000 } });
    stale.click();
    await settle();
    assert.equal(stale.requests.length, 1, "past the TTL it refreshes");
    assert.equal(stale.air_text()?.includes("34 Fair"), true, "the fresh value replaced the stored one");
    assert.equal((stale.store["newtab_net_cache_air"] as { at: number }).at, NOW_MS);
    const old = await air_card({ air_seed: { at: NOW_MS - 7 * 3_600_000 }, air_response: () => Promise.reject(new Error("offline")) });
    old.click();
    await settle();
    assert.equal(old.air_text(), null, "an answer past the max age is never shown, even when the refresh fails");
  }));

test("a failed or odd air quality answer draws no row and leaves the rest of the panel alone", () =>
  with_fake_document(async () => {
    for (const air_response of [() => Promise.reject(new Error("offline")), async () => new Response("nope", { status: 500 }), async () => new Response("{}")]) {
      const card = await air_card({ air_response });
      card.click();
      await settle();
      assert.equal(card.air_text(), null);
      assert.equal(card.slot.querySelector(".weather-detail")!.hidden, false);
      assert.deepEqual(card.slot.querySelectorAll(".weather-facts").map((node) => node.textContent), ["UV index2Sunrise7:42 AMSunset3:31 PM"]);
      assert.ok(card.slot.querySelectorAll(".weather-hour").length >= 3, "the strip is intact");
      assert.equal("newtab_net_cache_air" in card.store, false);
    }
  }));

// Units auto, hour strip and the default-on card.
const geocode_in = (country_code: string) => JSON.stringify({ results: [{ name: "Somewhere", latitude: 40.71, longitude: -74.0, country_code }] });
function auto_deps(over: { timezone?: string; country_code?: string; allowed?: boolean }) {
  const { deps, urls } = fake_deps({ allowed: over.allowed ?? false });
  deps.net.fetch = (async (input: string) => {
    urls.push(String(input));
    if (String(input).includes("geocoding")) return new Response(geocode_in(over.country_code ?? ""));
    return new Response(JSON.stringify({ ...forecast_body(), ...(over.timezone ? { timezone: over.timezone } : {}) }));
  }) as typeof fetch;
  return { deps, urls };
}
const auto = (extra: Partial<WeatherSettings> = {}): WeatherSettings => on({ newtab_weather_units: "auto", ...extra });

test("auto units for a city follow the geocoder's country: imperial for US, LR and MM, metric elsewhere, and the request asks in that unit", async () => {
  for (const [code, units, fahrenheit] of [["US", "imperial", true], ["us", "imperial", true], ["LR", "imperial", true], ["MM", "imperial", true], ["PR", "imperial", true], ["GU", "imperial", true], ["VI", "imperial", true], ["AS", "imperial", true], ["MP", "imperial", true], ["NO", "metric", false], ["GB", "metric", false]] as const) {
    const { deps, urls } = auto_deps({ country_code: code });
    const views = await collect(auto({ newtab_weather_city: "X" }), deps);
    const shown = views.find((view) => view.kind === "weather") as { weather: { units: string; temperature: number } };
    assert.equal(shown.weather.units, units, code);
    assert.equal(urls.length, 2);
    assert.equal(new URL(urls[1]!).searchParams.get("temperature_unit"), fahrenheit ? "fahrenheit" : "celsius", code);
    assert.equal(shown.weather.temperature, 12.4, "the server converts, the page does not");
  }
});

test("auto units for a position map the forecast's time zone: one request, converted locally when the zone is imperial", async () => {
  const us = auto_deps({ allowed: true, timezone: "America/Chicago" });
  const [view] = await collect(auto(), us.deps);
  assert.equal(us.urls.length, 1);
  assert.equal(new URL(us.urls[0]!).searchParams.get("temperature_unit"), "celsius");
  const weather = (view as { weather: { units: string; temperature: number; feels_like: number; high: number; wind_speed: number; detail: { hours: { temperature: number }[] }; latitude: number } }).weather;
  assert.equal(weather.units, "imperial");
  assert.equal(Math.round(weather.temperature * 10) / 10, 54.3);
  assert.equal(Math.round(weather.high * 10) / 10, 57.6);
  assert.equal(Math.round(weather.wind_speed * 10) / 10, 7.2);
  assert.equal(Math.round(weather.detail.hours[0]!.temperature * 10) / 10, 53.6);
  for (const [zone, units] of [["Europe/Oslo", "metric"], ["Africa/Monrovia", "imperial"], ["Asia/Yangon", "imperial"], ["America/Indiana/Knox", "imperial"], ["Pacific/Honolulu", "imperial"], ["America/Puerto_Rico", "imperial"], ["Pacific/Guam", "imperial"], ["Pacific/Saipan", "imperial"], ["Pacific/Pago_Pago", "imperial"], ["America/St_Thomas", "imperial"], ["America/Toronto", "metric"], ["America/Mexico_City", "metric"], ["Asia/Tokyo", "metric"]] as const) {
    const run = auto_deps({ allowed: true, timezone: zone });
    const [shown] = await collect(auto(), run.deps);
    assert.equal((shown as { weather: { units: string } }).weather.units, units, zone);
  }
  const none = auto_deps({ allowed: true });
  assert.equal(((await collect(auto(), none.deps))[0] as { weather: { units: string } }).weather.units, "metric", "no zone in the answer is metric");
});

test("a fixed units choice wins over the country, and the stored answer is keyed by the setting", async () => {
  const fixed = auto_deps({ country_code: "US" });
  await collect(on({ newtab_weather_units: "metric", newtab_weather_city: "X" }), fixed.deps);
  assert.equal(new URL(fixed.urls[1]!).searchParams.get("temperature_unit"), "celsius");
  const imperial = auto_deps({ allowed: true, timezone: "Europe/Oslo" });
  const [shown] = await collect(on({ newtab_weather_units: "imperial" }), imperial.deps);
  assert.equal(new URL(imperial.urls[0]!).searchParams.get("temperature_unit"), "fahrenheit");
  assert.equal((shown as { weather: { units: string } }).weather.units, "imperial");
  const keyed = auto_deps({ allowed: true });
  await collect(auto(), keyed.deps);
  assert.equal(await keyed.deps.net.storage.get("newtab_net_cache_weather").then((found) => (found["newtab_net_cache_weather"] as { key: string }).key), "geo:59.91,10.75|auto");
  await collect(auto(), keyed.deps);
  assert.equal(keyed.urls.length, 1, "a stored auto answer is reused whatever unit it resolved to");
});

test("air quality follows the resolved units, also when auto resolved them", () =>
  with_fake_document(async () => {
    const us = await air_card({ units: "imperial" });
    us.click();
    await settle();
    assert.match(us.requests[0]!.url, /current=us_aqi/);
  }));

test("with newtab_weather on by default and no permission and no city, the card only offers the button and sends nothing", async () => {
  const { deps, urls } = fake_deps();
  const settings = { newtab_weather: true, newtab_weather_units: "auto", newtab_clock_format: 12 } as WeatherSettings;
  assert.deepEqual(await collect(settings, deps), [{ kind: "ask_location" }]);
  assert.deepEqual(urls, []);
  const priv = fake_deps({ is_private: true, allowed: true });
  assert.deepEqual(await collect(settings, priv.deps), []);
  assert.deepEqual(priv.urls, []);
});

test("hours_that_fit gives at least 6 and at most 11, from the panel width, at 360 px and at full width", () => {
  assert.equal(hours_that_fit(360, 16), 6);
  assert.equal(hours_that_fit(1280, 16), 7);
  assert.equal(hours_that_fit(300, 16), 6, "never under 6");
  assert.equal(hours_that_fit(360, 20), 6, "zoom leaves fewer, down to 6");
  assert.ok(hours_that_fit(1280, 8) <= 11);
});

test("each hour is four rows in one row of columns: time, a labelled icon, temperature, rain, with the rain row kept empty when absent", () =>
  with_fake_document(() => {
    const slot = new FakeNode("div");
    const hours = WEATHER_DETAIL.hours.map((hour, index) => (index === 2 ? { time: hour.time, temperature: hour.temperature, code: hour.code } : hour));
    draw_weather(slot as never, weather_view({ detail: { ...WEATHER_DETAIL, hours } }), () => {}, 24, () => NOW_MS);
    const [first, , second] = slot.querySelectorAll(".weather-hour");
    assert.deepEqual(first!.children.map((child) => child.tag), ["span", "svg", "span", "div"]);
    assert.equal(first!.children[1]!.getAttribute("role"), "img");
    assert.equal(first!.children[1]!.getAttribute("aria-label"), "Overcast");
    assert.equal(first!.children[1]!.getAttribute("aria-hidden"), null);
    assert.equal(first!.children[0]!.textContent, "Now");
    assert.equal(first!.children[3]!.textContent, "30%");
    assert.equal(second!.children[3]!.textContent, "");
    assert.equal(slot.querySelectorAll(".weather-hours").length, 1);
  }));

test("the strip is capped to the count that fits", () => {
  assert.equal(hours_from_now(WEATHER_DETAIL.hours, 0, NOW_MS, 6).length, 6);
});

test("with auto units the position preview skips a stored reading made for a fixed unit", async () => {
  const { deps } = fake_deps({ allowed: true });
  await collect(on({ newtab_weather_units: "metric" }), deps);
  const views = await collect(auto(), deps);
  assert.deepEqual(views.map((view) => view.kind), ["weather"], "one draw: the fresh auto reading, not the metric preview first");
});

test("reopening More clears the old air row first, so a failed refresh never shows an expired reading", () =>
  with_fake_document(async () => {
    let fail = false;
    const card = await air_card({ air_response: async () => (fail ? Promise.reject(new Error("offline")) : new Response(AIR_BODY)) });
    card.click();
    await settle();
    assert.equal(card.air_text()?.includes("34 Fair"), true);
    card.click();
    // Past the max age the stored answer is not shown, and the refresh fails.
    card.store["newtab_net_cache_air"] = { ...(card.store["newtab_net_cache_air"] as object), at: NOW_MS - 7 * 3_600_000 };
    fail = true;
    card.click();
    await settle();
    assert.equal(card.air_text(), null);
  }));

test("the panel reads strip, divider, facts, and the air row joins under its own divider with a dot for its band", () =>
  with_fake_document(async () => {
    const card = await air_card();
    card.click();
    await settle();
    const panel = card.slot.querySelector(".weather-detail")!;
    assert.deepEqual(panel.children.map((child) => child.class_name), ["weather-strip", "weather-facts", "weather-air"]);
    assert.deepEqual(panel.children[0]!.children.map((child) => child.class_name), ["weather-hours", "weather-divider"]);
    assert.deepEqual(panel.children[2]!.children.map((child) => child.class_name), ["weather-divider", "weather-air-row"]);
    assert.deepEqual(panel.querySelectorAll(".weather-fact-text").slice(0, 3).map((node) => node.textContent), ["UV index2", "Sunrise7:42 AM", "Sunset3:31 PM"]);
    assert.equal(panel.querySelector(".weather-aqi-dot")!.class_name, "weather-aqi-dot weather-aqi-level-1");
    const first_rain = panel.querySelector(".weather-rain")!;
    assert.equal(first_rain.querySelector(".weather-rain-bar")!.children[0]!.style["width"], first_rain.children[0]!.textContent, "the bar is as wide as the percent");
  }));

test("the band level runs 0 to 5 on both scales", () => {
  assert.deepEqual([0, 51, 101, 151, 201, 301].map((index) => air_level({ scale: "us", index })), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual([0, 21, 41, 61, 81, 101].map((index) => air_level({ scale: "eu", index })), [0, 1, 2, 3, 4, 5]);
});
