import assert from "node:assert/strict";
import { test } from "node:test";
import type { NetEnv } from "../src/newtab/net_widget.ts";
import { draw_weather_icon, icon_kind } from "../src/newtab/weather_icon.ts";
import { clock_text, compass_point, later_hours } from "../src/newtab/weather_detail.ts";
import { net_cache_key } from "../src/newtab/net_widget.ts";
import { describe_code, draw_weather, forecast_url, forget_weather, geocode_url, parse_forecast, parse_geocode, round_coordinate, run_weather, start_weather, type WeatherDeps, type WeatherSettings, type WeatherView } from "../src/newtab/weather.ts";

const NOW_MS = Date.parse("2026-11-14T14:30:00Z");
const HOUR_TIMES = Array.from({ length: 12 }, (_, index) => new Date(Date.UTC(2026, 10, 14, 15 + index)).toISOString().slice(0, 16));
const forecast_body = (over: Record<string, unknown> = {}) => ({
  utc_offset_seconds: 3600,
  current: { temperature_2m: 12.4, apparent_temperature: 10.1, relative_humidity_2m: 44, weather_code: 3, wind_speed_10m: 11.6, wind_direction_10m: 320 },
  hourly: { time: HOUR_TIMES, temperature_2m: HOUR_TIMES.map((_, index) => 12 - index), precipitation_probability: HOUR_TIMES.map((_, index) => 30 + index) },
  daily: { time: ["2026-11-14"], temperature_2m_max: [14.2], temperature_2m_min: [5.8], uv_index_max: [2.4], sunrise: ["2026-11-14T07:42"], sunset: ["2026-11-14T15:31"] },
  ...over,
});
const FORECAST = JSON.stringify(forecast_body());
const WEATHER_CARD = { temperature: 12.4, feels_like: 10.1, humidity: 44, rain_chance: 30, high: 14.2, low: 5.8, date: "2026-11-14", utc_offset_seconds: 3600, wind_speed: 11.6, wind_direction: 320, code: 3 };
const WEATHER_DETAIL = { uv_index: 2.4, sunrise: "07:42", sunset: "15:31", hours: HOUR_TIMES.map((time, index) => ({ time, temperature: 12 - index, rain_chance: 30 + index })) };
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
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
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
  assert.equal(metric.searchParams.get("hourly"), "temperature_2m,precipitation_probability");
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
  assert.deepEqual(parsed, { ...WEATHER_CARD, detail: WEATHER_DETAIL });
});

test("a missing daily block or odd hours leave the card, and only the detail group goes", () => {
  const no_daily = parse_forecast(JSON.stringify(forecast_body({ daily: { time: ["2026-11-14"], temperature_2m_max: [1], temperature_2m_min: [0] } })))!;
  assert.equal(no_daily.high, 1);
  assert.equal("detail" in no_daily, false);
  assert.equal(parse_forecast(JSON.stringify(forecast_body({ daily: {} }))), undefined, "high and low are card fields");
  assert.equal(parse_forecast(JSON.stringify(forecast_body({ current: { temperature_2m: 1, apparent_temperature: 0, relative_humidity_2m: 5, weather_code: 0 } }))), undefined, "wind is a card field");
  const uneven = parse_forecast(JSON.stringify(forecast_body({ hourly: { time: ["2026-11-14T15:00", "2026-11-14T16:00", 7], temperature_2m: [3, "x"], precipitation_probability: [10] } })))!;
  assert.deepEqual(uneven.detail!.hours, [{ time: "2026-11-14T15:00", temperature: 3, rain_chance: 10 }]);
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

test("the strip keeps only hours after the place's current hour, in the place's time", () => {
  assert.equal(later_hours(WEATHER_DETAIL.hours, 3600, NOW_MS)[0]!.time, "2026-11-14T16:00", "14:30 UTC with +1 h is 15:30 there, so 15:00 has gone");
  assert.equal(later_hours(WEATHER_DETAIL.hours, 3600, NOW_MS).length, 11);
  assert.equal(later_hours(WEATHER_DETAIL.hours, 3600, NOW_MS + 3 * 3_600_000).length, 8);
  assert.equal(later_hours(WEATHER_DETAIL.hours, 0, NOW_MS)[0]!.time, "2026-11-14T15:00");
});

test("the card shows high and low, wind in the unit and the icon with a label, and hides the strip under 3 hours", () =>
  with_fake_document(() => {
    const slot = new FakeNode("div");
    draw_weather(slot as never, weather_view(), () => {}, 24, () => NOW_MS);
    const values = slot.querySelectorAll(".weather-value").map((node) => node.textContent);
    assert.ok(values.includes("14\u00b0 / 6\u00b0") && values.includes("12 km/h NW"), values.join("|"));
    assert.equal(slot.querySelectorAll(".weather-hour").length, 11);
    assert.equal(slot.querySelectorAll(".weather-hour")[0]!.textContent, "16:0011\u00b031%");
    const icon = slot.querySelector(".weather-reading")!.all().find((node) => node.tag === "svg")!;
    assert.equal(icon.getAttribute("role"), "img");
    assert.equal(icon.getAttribute("aria-label"), "Overcast");
    assert.equal(icon.getAttribute("aria-hidden"), null);
    const imperial = new FakeNode("div");
    draw_weather(imperial as never, weather_view({ units: "imperial" }), () => {}, 12, () => NOW_MS);
    assert.ok(imperial.querySelectorAll(".weather-value").some((node) => node.textContent === "12 mph NW"));
    assert.equal(imperial.querySelectorAll(".weather-hour")[0]!.textContent, "4 PM11\u00b031%");
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

test("forget_weather removes only the card's own key", async () => {
  const removed: string[] = [];
  await forget_weather(async (key) => void removed.push(key));
  assert.deepEqual(removed, [net_cache_key("weather")]);
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
    assert.equal(strip_hours(), 7, "four hours later, four fewer");
    slot.querySelector(".weather-more")!.listeners["click"]!();
    now_ms = NOW_MS + 9 * 3_600_000;
    slot.querySelector(".weather-more")!.listeners["click"]!();
    assert.equal(slot.querySelector(".weather-hours"), null, "under the minimum the strip goes");
    assert.equal(slot.querySelectorAll(".weather-detail").length, 1);
  }));
