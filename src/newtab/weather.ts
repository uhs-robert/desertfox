// The weather card. Open-Meteo gives the forecast and, for a city, the coordinates. It is off when `newtab_weather` is false, and sends nothing until a position is granted or a city is set. Where it sends coordinates they are rounded to 2 decimals (about 1 km), and the city text goes only to the geocoder.
import type { Settings } from "../shared/config.ts";
import { refused_as } from "../shared/swallow.ts";
import { draw_weather_icon } from "./weather_icon.ts";
import { compass_point, draw_hours_strip, draw_weather_detail, hours_that_fit, MAX_STRIP_HOURS, stat } from "./weather_detail.ts";
import type { ClockFormat } from "./digital_clock.ts";
import { draw_air_quality, make_air_loader, type AirLoader } from "./air_quality.ts";
import { browser_net_env, fetch_text, load_cached, net_cache_key, peek_cached, stoppable_net, type NetEnv } from "./net_widget.ts";

type Units = "metric" | "imperial";
type UnitsSetting = Units | "auto";
export type WeatherSettings = Pick<Settings, "newtab_weather" | "newtab_weather_city" | "newtab_weather_units" | "newtab_clock_format">;

// Also the age Firefox may reuse a position, so a new tab inside the window reads no fresh fix.
export const WEATHER_TTL_MS = 30 * 60_000;
// Past this a stored answer is too old to show, even offline. Weather changes within hours, so an older reading would mislead.
export const WEATHER_MAX_AGE_MS = 6 * 3_600_000;
export const GEOLOCATION_TIMEOUT_MS = 5000;

// `time` is the place's own local hour, `2026-11-14T15:00`, as Open-Meteo gives it with `timezone=auto`. `rain_chance` is a percent and absent when Open-Meteo gives none. `code` is the hour's WMO weather code.
export type WeatherHour = { time: string; temperature: number; rain_chance?: number; code: number };
// The group behind the More button. `sunrise` and `sunset` are local `HH:MM`. A card whose answer lacks any of it draws with no button.
export type WeatherDetail = { uv_index: number; sunrise: string; sunset: string; hours: WeatherHour[] };
// `latitude` and `longitude` are the rounded coordinates the forecast used, so the air quality request asks about the same place. `date` is the place's local date of the forecast (`2026-11-14`) and `utc_offset_seconds` its offset, so a stored answer is stale once the place's date moves on. `rain_chance` is the percent for the current hour. `wind_direction` is the degrees the wind comes from. Wind speed is km/h for metric and mph for imperial, `high` and `low` are today's.
export type Weather = { temperature: number; feels_like: number; humidity: number; rain_chance?: number; high: number; low: number; date: string; utc_offset_seconds: number; wind_speed: number; wind_direction: number; detail?: WeatherDetail; latitude: number; longitude: number; code: number; place: string; units: Units };
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

export function forecast_url(latitude: number, longitude: number, units: Units): string {
  const query = new URLSearchParams({
    latitude: String(round_coordinate(latitude)),
    longitude: String(round_coordinate(longitude)),
    current: "temperature_2m,weather_code,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m",
    hourly: "temperature_2m,precipitation_probability,weather_code",
    daily: "temperature_2m_max,temperature_2m_min,uv_index_max,sunrise,sunset",
    forecast_hours: "12",
    forecast_days: "1",
    // The daily block needs a time zone. `auto` takes it from the coordinates on the server, so nothing more leaves the page.
    timezone: "auto",
    temperature_unit: units === "imperial" ? "fahrenheit" : "celsius",
    ...(units === "imperial" ? { wind_speed_unit: "mph" } : {}),
  });
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

const LOCAL_DATE = /^\d{4}-\d\d-\d\d$/;
const is_number = (value: unknown): value is number => typeof value === "number";
const local_clock = (iso: unknown): string | undefined => (typeof iso === "string" ? /^\d{4}-\d\d-\d\dT(\d\d:\d\d)/.exec(iso)?.[1] : undefined);

function parse_detail(parsed: { hourly?: Record<string, unknown[] | undefined>; daily?: Record<string, unknown[] | undefined> }): WeatherDetail | undefined {
  const { daily, hourly } = parsed;
  const uv_index = daily?.["uv_index_max"]?.[0];
  const sunrise = local_clock(daily?.["sunrise"]?.[0]);
  const sunset = local_clock(daily?.["sunset"]?.[0]);
  if (!is_number(uv_index) || sunrise === undefined || sunset === undefined) return undefined;
  const hours: WeatherHour[] = [];
  (Array.isArray(hourly?.["time"]) ? hourly["time"] : []).forEach((time, index) => {
    const temperature = hourly?.["temperature_2m"]?.[index];
    const chance = hourly?.["precipitation_probability"]?.[index];
    const code = hourly?.["weather_code"]?.[index];
    if (local_clock(time) !== undefined && is_number(temperature) && is_number(code)) hours.push({ time: time as string, temperature, ...(is_number(chance) ? { rain_chance: chance } : {}), code });
  });
  return { uv_index, sunrise, sunset, hours };
}

// Undefined when the current reading, today's high and low, the date, the offset or the wind is missing. A missing detail group only leaves out the More button.
export function parse_forecast(text: string): Omit<Weather, "place" | "units" | "latitude" | "longitude"> | undefined {
  const parsed = parse_json(text) as { current?: Record<string, unknown>; hourly?: Record<string, unknown[] | undefined>; daily?: Record<string, unknown[] | undefined>; utc_offset_seconds?: unknown } | undefined;
  const { temperature_2m, apparent_temperature, relative_humidity_2m, weather_code, wind_speed_10m, wind_direction_10m } = parsed?.current ?? {};
  const high = parsed?.daily?.["temperature_2m_max"]?.[0];
  const low = parsed?.daily?.["temperature_2m_min"]?.[0];
  const date = parsed?.daily?.["time"]?.[0];
  if (!is_number(parsed?.utc_offset_seconds) || typeof date !== "string" || !LOCAL_DATE.test(date) || !is_number(temperature_2m) || !is_number(apparent_temperature) || !is_number(relative_humidity_2m) || !is_number(weather_code) || !is_number(wind_speed_10m) || !is_number(wind_direction_10m) || !is_number(high) || !is_number(low)) return undefined;
  const chance = parsed?.hourly?.["precipitation_probability"]?.[0];
  const detail = parse_detail(parsed ?? {});
  return { temperature: temperature_2m, feels_like: apparent_temperature, humidity: relative_humidity_2m, ...(is_number(chance) ? { rain_chance: chance } : {}), high, low, date, utc_offset_seconds: parsed.utc_offset_seconds, wind_speed: wind_speed_10m, wind_direction: wind_direction_10m, ...(detail ? { detail } : {}), code: weather_code };
}

export function parse_geocode(text: string): Where | undefined {
  const found = (parse_json(text) as { results?: { latitude?: unknown; longitude?: unknown; name?: unknown; country_code?: unknown }[] } | undefined)?.results?.[0];
  if (typeof found?.latitude !== "number" || typeof found.longitude !== "number" || typeof found.name !== "string") return undefined;
  return { latitude: round_coordinate(found.latitude), longitude: round_coordinate(found.longitude), place: found.name, ...(typeof found.country_code === "string" ? { country_code: found.country_code } : {}) };
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

const is_hour = (stored: unknown): stored is WeatherHour => {
  const value = stored as Partial<WeatherHour> | undefined;
  return typeof value?.time === "string" && is_number(value.temperature) && is_number(value.code) && (value.rain_chance === undefined || is_number(value.rain_chance));
};

const is_detail = (stored: unknown): stored is WeatherDetail => {
  const value = stored as Partial<WeatherDetail> | undefined;
  return is_number(value?.uv_index) && typeof value.sunrise === "string" && typeof value.sunset === "string" && Array.isArray(value.hours) && value.hours.every(is_hour);
};

// A stored entry from an older build lacks the newer fields and fails here, so it is fetched again once.
const is_weather = (stored: unknown): stored is Weather => {
  const value = stored as Partial<Weather> | undefined;
  return is_number(value?.temperature) && is_number(value.feels_like) && is_number(value.humidity) && (value.rain_chance === undefined || is_number(value.rain_chance)) && is_number(value.high) && is_number(value.low) && typeof value.date === "string" && is_number(value.utc_offset_seconds) && is_number(value.wind_speed) && is_number(value.wind_direction) && is_number(value.latitude) && is_number(value.longitude) && (value.detail === undefined || is_detail(value.detail)) && is_number(value.code) && typeof value.place === "string" && (value.units === "metric" || value.units === "imperial");
};

// `country_code` is the geocoder's ISO 3166 code, present for a city.
type Where = { latitude: number; longitude: number; place: string; country_code?: string };

// The United States, its territories that use Fahrenheit, Liberia and Myanmar.
const IMPERIAL_COUNTRIES = new Set(["US", "PR", "GU", "VI", "AS", "MP", "LR", "MM"]);
// Open-Meteo does not reverse geocode, but the forecast names the time zone of a position. These are the zones of the imperial countries above.
const IMPERIAL_ZONE = /^(America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Adak|Boise|Detroit|Juneau|Menominee|Metlakatla|Nome|Sitka|Yakutat|Indiana\/.+|Kentucky\/.+|North_Dakota\/.+)|Pacific\/(Honolulu|Guam|Saipan|Pago_Pago)|America\/(Puerto_Rico|St_Thomas)|Africa\/Monrovia|Asia\/(Yangon|Rangoon))$/;

export const units_for_country = (country_code: string): Units => (IMPERIAL_COUNTRIES.has(country_code.toUpperCase()) ? "imperial" : "metric");
export const units_for_zone = (timezone: unknown): Units => (typeof timezone === "string" && IMPERIAL_ZONE.test(timezone) ? "imperial" : "metric");

const fahrenheit = (celsius: number): number => (celsius * 9) / 5 + 32;
const mph = (kmh: number): number => kmh * 0.621371;

// The forecast of a position is asked for before its time zone is known, so it comes back metric and is converted here when the zone says imperial.
export function to_imperial<T extends Omit<Weather, "place" | "units" | "latitude" | "longitude">>(forecast: T): T {
  const hours = forecast.detail?.hours.map((hour) => ({ ...hour, temperature: fahrenheit(hour.temperature) }));
  return { ...forecast, temperature: fahrenheit(forecast.temperature), feels_like: fahrenheit(forecast.feels_like), high: fahrenheit(forecast.high), low: fahrenheit(forecast.low), wind_speed: mph(forecast.wind_speed), ...(forecast.detail && hours ? { detail: { ...forecast.detail, hours } } : {}) };
}

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

// `setting` is `newtab_weather_units`. A fixed choice is asked for as is. For auto, a city already names its country, so the request follows it. A position names no country, so the request is metric and the answer's time zone decides whether it is converted.
async function forecast_at(where: Where, setting: UnitsSetting, net: NetEnv): Promise<Weather | undefined> {
  const known: Units | undefined = setting !== "auto" ? setting : where.country_code ? units_for_country(where.country_code) : undefined;
  const text = await fetch_text(forecast_url(where.latitude, where.longitude, known ?? "metric"), net);
  const now = text === undefined ? undefined : parse_forecast(text);
  if (!now || text === undefined) return undefined;
  const units = known ?? units_for_zone((parse_json(text) as { timezone?: unknown } | undefined)?.timezone);
  return { ...(known === undefined && units === "imperial" ? to_imperial(now) : now), latitude: where.latitude, longitude: where.longitude, place: where.place, units };
}

const GEO_KEY_PREFIX = "geo:";

// A stored reading in the units asked for. Before the position arrives, the card draws a stored reading made for any coordinates (`GEO_KEY_PREFIX`), because the read can take seconds. The refresh after it replaces it when the coordinates differ.
const is_weather_in = (setting: UnitsSetting, now: () => number) => (stored: unknown): stored is Weather => is_weather(stored) && (setting === "auto" || stored.units === setting) && !is_past_date(stored, now());

// The forecast is for one local date. After midnight at the place its high, low, UV and sun times belong to yesterday, so the stored answer is fetched again instead of shown.
const is_past_date = (weather: Pick<Weather, "date" | "utc_offset_seconds">, now_ms: number): boolean => new Date(now_ms + weather.utc_offset_seconds * 1000).toISOString().slice(0, 10) !== weather.date;

// Calls `show` with what the card draws, possibly twice (a stored value, then a fresh one). It draws nothing when the setting is off, the page is private, a place is missing or a fetch fails. Geolocation comes first when its permission is already granted, and a stored reading draws before the position arrives. A city is the fallback, and with neither the card offers the permission button and sends no request.
export async function run_weather(settings: WeatherSettings, deps: WeatherDeps, show: (view: WeatherView) => void): Promise<void> {
  if (settings.newtab_weather !== true) return;
  if (await refused_as(deps.page_is_private(), true)) return;
  const city = (settings.newtab_weather_city ?? "").trim();
  const units: UnitsSetting = settings.newtab_weather_units === "imperial" || settings.newtab_weather_units === "metric" ? settings.newtab_weather_units : "auto";
  const show_weather = (weather: Weather) => show({ kind: "weather", weather });
  const has_permission = await refused_as(deps.has_geolocation_permission(), false);
  // Offered until the permission is granted, even with a city set. Once granted, the position wins over the city.
  if (!has_permission) show({ kind: "ask_location" });
  let earlier: Weather | undefined;
  if (has_permission) {
    earlier = await peek_cached("weather", GEO_KEY_PREFIX, WEATHER_MAX_AGE_MS, is_weather_in(units, deps.net.now), deps.net, `|${units}`);
    if (earlier) show_weather(earlier);
    const position = await granted_position(deps);
    if (position) {
      const [latitude, longitude] = [round_coordinate(position.latitude), round_coordinate(position.longitude)];
      // The rounded coordinates are in the key, so after travel the old place never counts as current.
      const spec = { name: "weather", key: `${GEO_KEY_PREFIX}${latitude},${longitude}|${units}`, ttl_ms: WEATHER_TTL_MS, max_age_ms: WEATHER_MAX_AGE_MS, is_value: is_weather_in(units, deps.net.now), produce: () => forecast_at({ latitude, longitude, place: "" }, units, deps.net) };
      const known = await load_cached<Weather>(spec, deps.net, show_weather);
      // The preview was made for other coordinates and the new place has no reading, so the card must not show the old place as local weather.
      if (earlier && !known) show({ kind: "clear_reading" });
      return;
    }
  }
  // No position: the preview, if any, was made for a place this page cannot confirm, so only a reading the city lookup establishes may stay.
  if (earlier && !city) show({ kind: "clear_reading" });
  if (city) {
    const produce = async () => {
      const where = await geocode_city(city, deps.net);
      return where && forecast_at(where, units, deps.net);
    };
    const spec = { name: "weather", key: `city:${city}|${units}`, ttl_ms: WEATHER_TTL_MS, max_age_ms: WEATHER_MAX_AGE_MS, is_value: is_weather_in(units, deps.net.now), produce };
    const known = await load_cached<Weather>(spec, deps.net, show_weather);
    if (earlier && !known) show({ kind: "clear_reading" });
    return;
  }
  // A granted permission with no position and no city is a dead end: the card stays empty and offers nothing to click.
}

// The More button of an earlier draw says whether the reader had the detail open. A redraw rebuilds the reading (a stored value, then a fresh one), so the state is read back from the old button.
const detail_was_open = (slot: HTMLElement): boolean => slot.querySelector(".weather-more")?.getAttribute("aria-expanded") === "true";

// The panel is open when this runs, and the window width and zoom are read now, so each open fits the strip to the window as it is.
function hours_in_view(panel: HTMLElement): number {
  const view = panel.ownerDocument?.defaultView;
  return view ? hours_that_fit(view.innerWidth, parseFloat(view.getComputedStyle(view.document.documentElement).fontSize)) : MAX_STRIP_HOURS;
}

function draw_more_button(panel: HTMLElement, open: boolean, on_open: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "weather-more";
  button.setAttribute("aria-controls", panel.id);
  const set_open = (now_open: boolean) => {
    button.setAttribute("aria-expanded", String(now_open));
    button.textContent = now_open ? "Less" : "More";
    panel.hidden = !now_open;
    if (now_open) on_open();
  };
  set_open(open);
  button.addEventListener("click", () => set_open(button.getAttribute("aria-expanded") !== "true"));
  return button;
}

// The reading and the permission button are separate children, so a city reading and the button show together and a new reading never removes the button. `format` and `now` only shape the hours in the detail.
export function draw_weather(slot: HTMLElement, view: WeatherView, on_ask: () => void, format: ClockFormat = 12, now: () => number = Date.now, load_air?: AirLoader): void {
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
  const { temperature, feels_like, humidity, rain_chance, high, low, utc_offset_seconds, wind_speed, wind_direction, detail, latitude, longitude, code, place, units } = view.weather;
  const main = document.createElement("div");
  main.className = "weather-main";
  const degrees = document.createElement("span");
  degrees.className = "weather-temp";
  degrees.textContent = `${Math.round(temperature)}\u00b0`;
  main.append(draw_weather_icon(code, describe_code(code)), degrees);
  const reading = document.createElement("div");
  reading.className = "weather-reading";
  reading.title = place ? `${describe_code(code)}, ${place}` : describe_code(code);
  reading.append(main, stat(`${Math.round(feels_like)}\u00b0`, "Feels like"), stat(`${Math.round(high)}\u00b0 / ${Math.round(low)}\u00b0`, "High / low"), stat(`${Math.round(humidity)}%`, "Humidity"));
  if (rain_chance !== undefined) reading.append(stat(`${Math.round(rain_chance)}%`, "Rain chance"));
  reading.append(stat(`${Math.round(wind_speed)} ${units === "imperial" ? "mph" : "km/h"} ${compass_point(wind_direction)}`, "Wind"));
  if (detail) {
    const panel = draw_weather_detail(detail, utc_offset_seconds, format, now());
    panel.id = "weather-detail";
    // Hours pass while the panel stays closed, so each open draws the strip again from the stored hours. That part sends nothing.
    const redraw_strip = () => {
      panel.querySelector(".weather-strip")?.remove();
      const strip = draw_hours_strip(detail.hours, utc_offset_seconds, format, now(), hours_in_view(panel));
      if (strip) panel.prepend(strip);
    };
    // The air quality request starts here and nowhere earlier. The row joins the panel only while the panel is open and still on the page, so a closed panel or a redraw while the request is out gets no late draw.
    const open_panel = () => {
      redraw_strip();
      // A reading from an earlier open may be expired by now. The loader draws a valid stored or fresh one back.
      panel.querySelector(".weather-air")?.remove();
      load_air?.({ latitude, longitude, units }, (air) => {
        if (panel.hidden || !panel.isConnected) return;
        panel.querySelector(".weather-air")?.remove();
        panel.querySelector(".weather-facts")?.after(draw_air_quality(air));
      });
    };
    reading.append(draw_more_button(panel, detail_was_open(slot), open_panel), panel);
  }
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

// The page calls this while the setting is off, so turning the card off also drops the last forecast and air quality answers from storage.
export async function forget_weather(remove: (key: string) => Promise<void> = (key) => browser.storage.local.remove(key)): Promise<void> {
  await remove(net_cache_key("weather"));
  await remove(net_cache_key("air"));
}

// Fills `slot` and keeps the page free: nothing here is awaited by the draw, and a failure leaves the slot empty. A click on the permission button asks first, then stops this run and runs the card again. `stop` ends the run, and a run the click started.
export function start_weather(slot: HTMLElement, settings: WeatherSettings, deps: WeatherDeps = browser_weather_deps()): { finished: Promise<void>; stop: () => void } {
  let live = true;
  let restarted: { stop: () => void } | undefined;
  const net = stoppable_net(deps.net, () => live);
  const air = make_air_loader(net, () => live);
  const ask_for_location = () => {
    void refused_as(deps.request_geolocation_permission(), false).then((granted) => {
      if (!granted || !live) return;
      live = false;
      slot.replaceChildren();
      restarted = start_weather(slot, settings, deps);
    });
  };
  const show = (view: WeatherView) => {
    if (live) draw_weather(slot, view, ask_for_location, settings.newtab_clock_format === 24 ? 24 : 12, Date.now, air);
  };
  const finished = refused_as(run_weather(settings, { ...deps, net }, show), undefined) as Promise<void>;
  return {
    finished,
    stop: () => {
      live = false;
      restarted?.stop();
    },
  };
}
