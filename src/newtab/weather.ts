// The weather card. Open-Meteo gives the forecast and, for a city, the coordinates. It is off unless `newtab_weather` is true. Where it sends coordinates they are rounded to 2 decimals (about 1 km), and the city text goes only to the geocoder.
import type { Settings } from "../shared/config.ts";
import { refused_as } from "../shared/swallow.ts";
import { fetch_text, load_cached, type NetEnv } from "./net_widget.ts";

export type WeatherSettings = Pick<Settings, "newtab_weather" | "newtab_weather_city" | "newtab_weather_units">;

// Also the age Firefox may reuse a position, so a new tab inside the window reads no fresh fix.
export const WEATHER_TTL_MS = 30 * 60_000;
export const GEOLOCATION_TIMEOUT_MS = 5000;

export type Weather = { temperature: number; code: number; place: string; units: "metric" | "imperial" };
export type WeatherView = { kind: "weather"; weather: Weather } | { kind: "ask_location" };

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

// Where to ask about. `cache_key` names the place without its coordinates, so a stored answer can show before a position arrives.
type Place = { cache_key: string; resolve: () => Promise<{ latitude: number; longitude: number; place: string } | undefined> };

// Undefined without the permission, and when the browser or the user refuses or the read takes too long. The permission is never requested here, because only a click may do that.
async function granted_position_place(deps: WeatherDeps): Promise<Place | undefined> {
  const allowed = await refused_as(deps.has_geolocation_permission(), false);
  if (!allowed) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), GEOLOCATION_TIMEOUT_MS)));
  try {
    const position = await Promise.race([deps.current_position(), timeout]);
    if (!position) return undefined;
    const { latitude, longitude } = position;
    return { cache_key: "geo", resolve: async () => ({ latitude, longitude, place: "" }) };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

const geocoded_city_place = (city: string, net: NetEnv): Place => ({
  cache_key: `city:${city}`,
  resolve: async () => {
    const text = await fetch_text(geocode_url(city), net);
    return text === undefined ? undefined : parse_geocode(text);
  },
});

// Calls `show` with what the card draws, possibly twice (a stored value, then a fresh one). It draws nothing when the setting is off, the page is private, a place is missing or a fetch fails. Geolocation comes first when its permission is already granted. A city is the fallback, and with neither the card offers the permission button and sends no request.
export async function run_weather(settings: WeatherSettings, deps: WeatherDeps, show: (view: WeatherView) => void): Promise<void> {
  if (settings.newtab_weather !== true) return;
  if (await refused_as(deps.page_is_private(), true)) return;
  const city = (settings.newtab_weather_city ?? "").trim();
  const place = (await granted_position_place(deps)) ?? (city ? geocoded_city_place(city, deps.net) : undefined);
  if (!place) {
    // A granted permission with no position and no city is a dead end, so the card stays empty and offers nothing to click.
    const can_ask_for_location = !(await refused_as(deps.has_geolocation_permission(), true));
    if (can_ask_for_location) show({ kind: "ask_location" });
    return;
  }
  const units = settings.newtab_weather_units === "imperial" ? "imperial" : "metric";
  await load_cached<Weather>(
    {
      name: "weather",
      key: `${place.cache_key}|${units}`,
      ttl_ms: WEATHER_TTL_MS,
      is_value: is_weather,
      produce: async () => {
        const where = await place.resolve();
        if (!where) return undefined;
        const text = await fetch_text(forecast_url(where.latitude, where.longitude, units), deps.net);
        const now = text === undefined ? undefined : parse_forecast(text);
        return now && { ...now, place: where.place, units };
      },
    },
    deps.net,
    (weather) => show({ kind: "weather", weather }),
  );
}

export function draw_weather(slot: HTMLElement, view: WeatherView, on_ask: () => void): void {
  slot.replaceChildren();
  if (view.kind === "ask_location") {
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
  slot.append(degrees, text);
}

export const browser_weather_deps = (): WeatherDeps => ({
  page_is_private: async () => (await browser.windows.getCurrent()).incognito,
  has_geolocation_permission: () => browser.permissions.contains({ permissions: ["geolocation"] }),
  current_position: () => new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition((found) => resolve(found.coords), reject, { timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: WEATHER_TTL_MS })),
  request_geolocation_permission: () => browser.permissions.request({ permissions: ["geolocation"] }),
  net: { fetch: (input, init) => fetch(input, init), now: Date.now, storage: browser.storage.local },
});

// Fills `slot` and keeps the page free: nothing here is awaited by the draw, and a failure leaves the slot empty. A click on the permission button asks first, then runs the card again.
export function start_weather(slot: HTMLElement, settings: WeatherSettings, deps: WeatherDeps = browser_weather_deps()): Promise<void> {
  const show = (view: WeatherView) =>
    draw_weather(slot, view, () => {
      void refused_as(deps.request_geolocation_permission(), false).then((granted) => (granted ? start_weather(slot, settings, deps) : undefined));
    });
  return refused_as(run_weather(settings, deps, show), undefined) as Promise<void>;
}
