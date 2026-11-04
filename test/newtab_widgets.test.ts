import assert from "node:assert/strict";
import { test } from "node:test";
import { cached, CACHE_TTL_MS } from "../src/newtab/cache.ts";
import type { CacheArea } from "../src/newtab/cache.ts";
import { clock_angles } from "../src/newtab/clock.ts";
import { parse_ip_response } from "../src/newtab/ip.ts";
import { load_widgets } from "../src/newtab/render.ts";
import { parse_weather_response, weather_url } from "../src/newtab/weather.ts";

const IP_BODY = { success: true, ip: "203.0.113.7", city: "Oslo", latitude: 59.9, longitude: 10.7 };
const WEATHER_BODY = { current: { temperature_2m: 3.4, weather_code: 61 }, current_units: { temperature_2m: "°C" } };

function memory_area(): CacheArea & { items: Record<string, unknown> } {
  const items: Record<string, unknown> = {};
  return { items, get: async (key) => (key in items ? { [key]: items[key] } : {}), set: async (more) => void Object.assign(items, more) };
}

// A stub for the two services that counts what it was asked.
function stub_network(overrides: { ip?: unknown; weather?: unknown } = {}) {
  const urls: string[] = [];
  const fetch_json = async (url: string) => {
    urls.push(url);
    const body = url.startsWith("https://ipwho.is/") ? (overrides.ip ?? IP_BODY) : (overrides.weather ?? WEATHER_BODY);
    if (body instanceof Error) throw body;
    return body;
  };
  return { urls, fetch_json };
}

const deps_of = (network: ReturnType<typeof stub_network>, now = 1_000) => ({ fetch_json: network.fetch_json, area: memory_area(), now });

test("clock angles: the hour hand turns once per 24 hours", () => {
  const at = (hours: number, minutes: number, seconds: number) => clock_angles(new Date(2026, 0, 1, hours, minutes, seconds));
  assert.deepEqual(at(0, 0, 0), { hour: 0, minute: 0, second: 0 });
  assert.equal(at(12, 0, 0).hour, 180);
  assert.equal(at(18, 0, 0).hour, 270);
  assert.equal(at(6, 30, 0).hour, 97.5);
});

test("clock angles: the seconds hand moves 6 degrees a second and the minute hand follows it", () => {
  const angles = clock_angles(new Date(2026, 0, 1, 3, 15, 30));
  assert.equal(angles.second, 180);
  assert.equal(angles.minute, 15.5 * 6);
});

test("ipwho.is: a good reply parses, a failure or a gap gives null", () => {
  assert.deepEqual(parse_ip_response(IP_BODY), { ip: "203.0.113.7", city: "Oslo", latitude: 59.9, longitude: 10.7 });
  assert.equal(parse_ip_response({ success: false, message: "Reserved range" }), null);
  assert.equal(parse_ip_response({ success: true, ip: "203.0.113.7" }), null);
  assert.equal(parse_ip_response(null), null);
  assert.equal(parse_ip_response({ ...IP_BODY, city: undefined })?.city, "");
});

test("Open-Meteo: the reply parses and the unit follows the setting", () => {
  assert.deepEqual(parse_weather_response(WEATHER_BODY), { temperature: 3, unit: "°C", description: "Rain" });
  assert.equal(parse_weather_response({ error: true }), null);
  assert.equal(parse_weather_response(null), null);
  assert.match(weather_url(59.9, 10.7, "metric"), /temperature_unit=celsius/);
  assert.match(weather_url(59.9, 10.7, "us"), /temperature_unit=fahrenheit/);
  assert.match(weather_url(59.9, 10.7, "us"), /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=59\.9&longitude=10\.7&/);
});

test("cache: a reply is reused for 5 minutes, then fetched again", async () => {
  const area = memory_area();
  let calls = 0;
  const fetch_value = async () => ++calls;
  assert.equal(await cached(area, "k", "p", 0, fetch_value), 1);
  assert.equal(await cached(area, "k", "p", CACHE_TTL_MS - 1, fetch_value), 1);
  assert.equal(await cached(area, "k", "p", CACHE_TTL_MS, fetch_value), 2);
  assert.equal(await cached(area, "k", "other", CACHE_TTL_MS + 1, fetch_value), 3);
});

test("cache: a failure is not stored", async () => {
  const area = memory_area();
  assert.equal(await cached(area, "k", "p", 0, async () => null), null);
  assert.deepEqual(area.items, {});
});

test("a failed IP call hides the IP line and the IP weather, with no throw", async () => {
  const widgets = await load_widgets({ newtab_ip: true, newtab_weather: true }, deps_of(stub_network({ ip: new Error("offline") })));
  assert.equal(widgets.ip, null);
  assert.equal(widgets.weather, null);
});

test("a failed weather call hides the weather and keeps the IP line", async () => {
  const widgets = await load_widgets({ newtab_ip: true, newtab_weather: true }, deps_of(stub_network({ weather: { error: true } })));
  assert.equal(widgets.weather, null);
  assert.equal(widgets.ip?.city, "Oslo");
});

test("each setting hides its widget, and IP and weather are off by default", async () => {
  const network = stub_network();
  const off = await load_widgets({}, deps_of(network));
  assert.deepEqual([off.clock, off.date, off.ip, off.weather], [true, true, null, null]);
  assert.deepEqual(network.urls, [], "no setting, no request");
  const hidden = await load_widgets({ newtab_clock: false, newtab_date: false }, deps_of(network));
  assert.deepEqual([hidden.clock, hidden.date], [false, false]);
  const ip_only = await load_widgets({ newtab_ip: true }, deps_of(network));
  assert.deepEqual([ip_only.ip?.ip, ip_only.weather], ["203.0.113.7", null]);
  assert.deepEqual(network.urls, ["https://ipwho.is/"]);
  const weather_only = await load_widgets({ newtab_weather: true }, deps_of(network));
  assert.deepEqual([weather_only.ip, weather_only.weather?.temperature, weather_only.place], [null, 3, "Oslo"]);
});

test("weather_units picks the unit of the request", async () => {
  const network = stub_network();
  await load_widgets({ newtab_weather: true, weather_units: "us" }, deps_of(network));
  assert.match(network.urls.at(-1) ?? "", /fahrenheit/);
  await load_widgets({ newtab_weather: true }, deps_of(network));
  assert.match(network.urls.at(-1) ?? "", /celsius/);
});

test("weather_lat and weather_lon skip the IP lookup, and carry only those coordinates", async () => {
  const network = stub_network();
  const widgets = await load_widgets({ newtab_weather: true, weather_lat: 48.1, weather_lon: 11.6 }, deps_of(network));
  assert.equal(widgets.weather?.temperature, 3);
  assert.equal(network.urls.length, 1);
  assert.match(network.urls[0] ?? "", /^https:\/\/api\.open-meteo\.com\/.*latitude=48\.1&longitude=11\.6/);
  assert.equal(widgets.place, "");
});

test("one coordinate alone does not skip the IP lookup", async () => {
  const network = stub_network();
  await load_widgets({ newtab_weather: true, weather_lat: 48.1 }, deps_of(network));
  assert.equal(network.urls[0], "https://ipwho.is/");
});
