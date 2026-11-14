// The weather card. Open-Meteo gives the forecast and, for a city, the coordinates. It is off unless `newtab_weather` is true. Where it sends coordinates they are rounded to 2 decimals (about 1 km), and the city text goes only to the geocoder.
import type { Settings } from "../shared/config.ts";
import { refused_as } from "../shared/swallow.ts";
import { browser_net_env, fetch_text, load_cached, peek_cached, type NetEnv } from "./net_widget.ts";

export type WeatherSettings = Pick<Settings, "newtab_weather" | "newtab_weather_city" | "newtab_weather_units">;

// Also the age Firefox may reuse a position, so a new tab inside the window reads no fresh fix.
export const WEATHER_TTL_MS = 30 * 60_000;
// Past this a stored answer is too old to show, even offline. Weather changes within hours, so an older reading would mislead.
export const WEATHER_MAX_AGE_MS = 6 * 3_600_000;
export const GEOLOCATION_TIMEOUT_MS = 5000;

export type Weather = { temperature: number; code: number; place: string; units: "metric" | "imperial" };
export type WeatherView = { kind: "weather"; weather: Weather } | { kind: "ask_location" } | { kind: "clear_reading" };

export type WeatherDeps = {
  page_is_private: () => Promise<boolean>;
  has_geolocation_permission: () => Promise<boolean>;
  // Resolves with the position, rejects when the browser or the user refuses.
  current_position: () => Promise<{ latitude: number; longitude: number }>;
  // Must be called from the click handler with no await before it, or Firefox refuses it.
  request_geolocation_permission: () => Promise<boolean>;
  net: NetEnv;
};

export const round_coordinate = (degrees: number): number => Math.round(degrees * 100) / 100;

export function forecast_url(latitude: number, longitude: number, units: "metric" | "imperial"): string {
  const query = new URLSearchParams({ latitude: String(round_coordinate(latitude)), longitude: String(round_coordinate(longitude)), current: "temperature_2m,weather_code", temperature_unit: units === "imperial" ? "fahrenheit" : "celsius" });
  return `https://api.open-meteo.com/v1/forecast?${query}`;
}

export function geocode_url(city: string): string {
  return `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: city, count: "1", format: "json" })}`;
}

const parse_json = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export function parse_forecast(text: string): { temperature: number; code: number } | undefined {
  const current = (parse_json(text) as { current?: { temperature_2m?: unknown; weather_code?: unknown } } | undefined)?.current;
  if (typeof current?.temperature_2m !== "number" || typeof current.weather_code !== "number") return undefined;
  return { temperature: current.temperature_2m, code: current.weather_code };
}

export function parse_geocode(text: string): { latitude: number; longitude: number; place: string } | undefined {
  const found = (parse_json(text) as { results?: { latitude?: unknown; longitude?: unknown; name?: unknown }[] } | undefined)?.results?.[0];
  if (typeof found?.latitude !== "number" || typeof found.longitude !== "number" || typeof found.name !== "string") return undefined;
  return { latitude: round_coordinate(found.latitude), longitude: round_coordinate(found.longitude), place: found.name };
}

// WMO weather interpretation codes, as Open-Meteo reports them.
export function describe_code(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code >= 95) return "Thunderstorm";
  return "Unknown";
}

const is_weather = (stored: unknown): stored is Weather => {
  const value = stored as Partial<Weather> | undefined;
  return typeof value?.temperature === "number" && typeof value.code === "number" && typeof value.place === "string" && (value.units === "metric" || value.units === "imperial");
};

type Where = { latitude: number; longitude: number; place: string };

// Undefined without the permission, and when the browser or the user refuses or the read takes too long. The permission is never requested here, because only a click may do that.
async function granted_position(deps: WeatherDeps): Promise<{ latitude: number; longitude: number } | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), GEOLOCATION_TIMEOUT_MS)));
  try {
    return await Promise.race([deps.current_position(), timeout]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function geocode_city(city: string, net: NetEnv): Promise<Where | undefined> {
  const text = await fetch_text(geocode_url(city), net);
  return text === undefined ? undefined : parse_geocode(text);
}

async function forecast_at(where: Where, units: "metric" | "imperial", net: NetEnv): Promise<Weather | undefined> {
  const text = await fetch_text(forecast_url(where.latitude, where.longitude, units), net);
  const now = text === undefined ? undefined : parse_forecast(text);
  return now && { ...now, place: where.place, units };
}

const GEO_KEY_PREFIX = "geo:";

// A stored reading in the units asked for. Before the position arrives, the card draws a stored reading made for any coordinates (`GEO_KEY_PREFIX`), because the read can take seconds. The refresh after it replaces it when the coordinates differ.
const is_weather_in = (units: "metric" | "imperial") => (stored: unknown): stored is Weather => is_weather(stored) && stored.units === units;

// Calls `show` with what the card draws, possibly twice (a stored value, then a fresh one). It draws nothing when the setting is off, the page is private, a place is missing or a fetch fails. Geolocation comes first when its permission is already granted, and a stored reading draws before the position arrives. A city is the fallback, and with neither the card offers the permission button and sends no request.
export async function run_weather(settings: WeatherSettings, deps: WeatherDeps, show: (view: WeatherView) => void): Promise<void> {
  if (settings.newtab_weather !== true) return;
  if (await refused_as(deps.page_is_private(), true)) return;
  const city = (settings.newtab_weather_city ?? "").trim();
  const units = settings.newtab_weather_units === "imperial" ? "imperial" : "metric";
  const show_weather = (weather: Weather) => show({ kind: "weather", weather });
  const has_permission = await refused_as(deps.has_geolocation_permission(), false);
  // Offered until the permission is granted, even with a city set. Once granted, the position wins over the city.
  if (!has_permission) show({ kind: "ask_location" });
  if (has_permission) {
    const earlier = await peek_cached("weather", GEO_KEY_PREFIX, WEATHER_MAX_AGE_MS, is_weather_in(units), deps.net);
    if (earlier) show_weather(earlier);
    const position = await granted_position(deps);
    if (position) {
      const [latitude, longitude] = [round_coordinate(position.latitude), round_coordinate(position.longitude)];
      // The rounded coordinates are in the key, so after travel the old place never counts as current.
      const spec = { name: "weather", key: `${GEO_KEY_PREFIX}${latitude},${longitude}|${units}`, ttl_ms: WEATHER_TTL_MS, max_age_ms: WEATHER_MAX_AGE_MS, is_value: is_weather_in(units), produce: () => forecast_at({ latitude, longitude, place: "" }, units, deps.net) };
      const known = await load_cached<Weather>(spec, deps.net, show_weather);
      // The preview was made for other coordinates and the new place has no reading, so the card must not show the old place as local weather.
      if (earlier && !known) show({ kind: "clear_reading" });
      return;
    }
  }
  if (city) {
    const produce = async () => {
      const where = await geocode_city(city, deps.net);
      return where && forecast_at(where, units, deps.net);
    };
    const spec = { name: "weather", key: `city:${city}|${units}`, ttl_ms: WEATHER_TTL_MS, max_age_ms: WEATHER_MAX_AGE_MS, is_value: is_weather_in(units), produce };
    await load_cached<Weather>(spec, deps.net, show_weather);
    return;
  }
  // A granted permission with no position and no city is a dead end: the card stays empty and offers nothing to click.
}

// The reading and the permission button are separate children, so a city reading and the button show together and a new reading never removes the button.
export function draw_weather(slot: HTMLElement, view: WeatherView, on_ask: () => void): void {
  if (view.kind === "clear_reading") {
    slot.querySelector(".weather-reading")?.remove();
    return;
  }
  if (view.kind === "ask_location") {
    if (slot.querySelector(".weather-ask")) return;
    const ask = document.createElement("button");
    ask.type = "button";
    ask.className = "weather-ask";
    ask.textContent = "Show the weather here";
    ask.addEventListener("click", on_ask);
    slot.append(ask);
    return;
  }
  const { temperature, code, place, units } = view.weather;
  const degrees = document.createElement("span");
  degrees.className = "weather-temp";
  degrees.textContent = `${Math.round(temperature)}°${units === "imperial" ? "F" : "C"}`;
  const text = document.createElement("span");
  text.className = "weather-text";
  text.textContent = place ? `${describe_code(code)}, ${place}` : describe_code(code);
  const reading = document.createElement("span");
  reading.className = "weather-reading";
  reading.append(degrees, text);
  slot.querySelector(".weather-reading")?.remove();
  slot.prepend(reading);
}

export const browser_weather_deps = (): WeatherDeps => ({
  page_is_private: async () => (await browser.windows.getCurrent()).incognito,
  has_geolocation_permission: () => browser.permissions.contains({ permissions: ["geolocation"] }),
  current_position: () => new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition((found) => resolve(found.coords), reject, { timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: WEATHER_TTL_MS })),
  request_geolocation_permission: () => browser.permissions.request({ permissions: ["geolocation"] }),
  net: browser_net_env(),
});

// What a stopped run must not do: fetch, write the cache or draw. A page redraw stops its run, and so does a grant that starts a new one, so a late answer never overwrites a newer card or sends a request the owner has turned off.
function guarded_by(is_live: () => boolean, deps: WeatherDeps): WeatherDeps {
  const { net } = deps;
  const stopped_answer = () => new Response(null, { status: 503 });
  return {
    ...deps,
    net: { ...net, fetch: (input, init) => (is_live() ? net.fetch(input, init) : Promise.resolve(stopped_answer())), storage: { get: (key) => net.storage.get(key), set: async (items) => (is_live() ? net.storage.set(items) : undefined) } },
  };
}

// Fills `slot` and keeps the page free: nothing here is awaited by the draw, and a failure leaves the slot empty. A click on the permission button asks first, then stops this run and runs the card again. `stop` ends the run, and a run the click started.
export function start_weather(slot: HTMLElement, settings: WeatherSettings, deps: WeatherDeps = browser_weather_deps()): { finished: Promise<void>; stop: () => void } {
  let live = true;
  let restarted: { stop: () => void } | undefined;
  const ask_for_location = () => {
    void refused_as(deps.request_geolocation_permission(), false).then((granted) => {
      if (!granted || !live) return;
      live = false;
      slot.replaceChildren();
      restarted = start_weather(slot, settings, deps);
    });
  };
  const show = (view: WeatherView) => {
    if (live) draw_weather(slot, view, ask_for_location);
  };
  const finished = refused_as(run_weather(settings, guarded_by(() => live, deps), show), undefined) as Promise<void>;
  return {
    finished,
    stop: () => {
      live = false;
      restarted?.stop();
    },
  };
}
