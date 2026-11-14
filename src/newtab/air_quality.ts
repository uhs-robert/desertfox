// The air quality row in the weather detail. It needs a second Open-Meteo host, so nothing is fetched until the reader opens the More panel, and a reader who never opens it sends no request. The caller checks the setting and privacy first, as for every card on `net_widget.ts`.
import { refused_as } from "../shared/swallow.ts";
import { fetch_text, load_cached, type NetEnv } from "./net_widget.ts";
import { divider } from "./weather_detail.ts";

export const AIR_TTL_MS = 30 * 60_000;
export const AIR_MAX_AGE_MS = 6 * 3_600_000;

// `index` is the US AQI for imperial units and the European AQI for metric. The particles and ozone are in micrograms per cubic metre and left out when Open-Meteo gives none.
export type AirQuality = { scale: "us" | "eu"; index: number; pm2_5?: number; pm10?: number; ozone?: number };
export type AirPlace = { latitude: number; longitude: number; units: "metric" | "imperial" };

const is_number = (value: unknown): value is number => typeof value === "number";
const scale_of = (units: "metric" | "imperial"): "us" | "eu" => (units === "imperial" ? "us" : "eu");

// The coordinates are the forecast's, already rounded to 2 decimals.
export function air_quality_url(place: AirPlace): string {
  const index = scale_of(place.units) === "us" ? "us_aqi" : "european_aqi";
  const query = new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude), current: `${index},pm2_5,pm10,ozone` });
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${query}`;
}

export function parse_air_quality(text: string, units: "metric" | "imperial"): AirQuality | undefined {
  let current: Record<string, unknown> | undefined;
  try {
    current = (JSON.parse(text) as { current?: Record<string, unknown> } | null)?.current;
  } catch {
    return undefined;
  }
  const scale = scale_of(units);
  const index = current?.[scale === "us" ? "us_aqi" : "european_aqi"];
  if (!is_number(index)) return undefined;
  const { pm2_5, pm10, ozone } = current ?? {};
  return { scale, index, ...(is_number(pm2_5) ? { pm2_5 } : {}), ...(is_number(pm10) ? { pm10 } : {}), ...(is_number(ozone) ? { ozone } : {}) };
}

// Upper limits of each band, from the US EPA and the European Environment Agency tables. The US "Unhealthy for sensitive groups" band is shortened to fit the panel.
const US_BANDS: [number, string][] = [[50, "Good"], [100, "Moderate"], [150, "Sensitive"], [200, "Unhealthy"], [300, "Very unhealthy"]];
const EU_BANDS: [number, string][] = [[20, "Good"], [40, "Fair"], [60, "Moderate"], [80, "Poor"], [100, "Very poor"]];

// 0 is the best band and 5 the worst. Both scales have six.
export function air_level(air: Pick<AirQuality, "scale" | "index">): number {
  const bands = air.scale === "us" ? US_BANDS : EU_BANDS;
  const level = bands.findIndex(([top]) => air.index <= top);
  return level === -1 ? bands.length : level;
}

export function air_band(air: Pick<AirQuality, "scale" | "index">): string {
  const bands = air.scale === "us" ? US_BANDS : EU_BANDS;
  return bands[air_level(air)]?.[1] ?? (air.scale === "us" ? "Hazardous" : "Extremely poor");
}

export const is_air_quality = (stored: unknown): stored is AirQuality => {
  const value = stored as Partial<AirQuality> | undefined;
  return (value?.scale === "us" || value?.scale === "eu") && is_number(value.index) && [value.pm2_5, value.pm10, value.ozone].every((part) => part === undefined || is_number(part));
};

const text_span = (class_name: string, text: string): HTMLElement => {
  const span = document.createElement("span");
  span.className = class_name;
  span.textContent = text;
  return span;
};

// Under its own divider: the index with a dot colored for its band, then the band name, and the particles and ozone as smaller values.
export function draw_air_quality(air: AirQuality): HTMLElement {
  const group = document.createElement("div");
  group.className = "weather-air";
  const row = document.createElement("div");
  row.className = "weather-air-row";
  const index = document.createElement("div");
  index.className = "weather-air-index";
  const dot = document.createElement("span");
  dot.className = `weather-aqi-dot weather-aqi-level-${air_level(air)}`;
  const text = document.createElement("div");
  text.className = "weather-fact-text";
  text.append(text_span("weather-label", air.scale === "us" ? "Air quality (US AQI)" : "Air quality (EU AQI)"), text_span("weather-value", `${Math.round(air.index)} ${air_band(air)}`));
  index.append(dot, text);
  const parts = document.createElement("div");
  parts.className = "weather-air-parts";
  for (const [value, label] of [[air.pm2_5, "PM2.5"], [air.pm10, "PM10"], [air.ozone, "Ozone"]] as const) {
    if (value === undefined) continue;
    const part = document.createElement("div");
    part.className = "weather-air-part";
    part.append(text_span("weather-label", label), text_span("weather-air-value", String(Math.round(value))));
    parts.append(part);
  }
  row.append(index, parts);
  group.append(divider(), row);
  return group;
}

export type AirLoader = (place: AirPlace, show: (air: AirQuality) => void) => void;

// The loader a weather run hands to its panels. `net` is the run's stoppable env, so a stopped run sends nothing and writes no cache, and `is_live` also keeps a request that was already out from drawing after the stop. Requests for the same place and units share one fetch: a second open while the first is out only joins it, and also gets the value so far.
export function make_air_loader(net: NetEnv, is_live: () => boolean): AirLoader {
  const in_flight = new Map<string, { listeners: Set<(air: AirQuality) => void>; latest: AirQuality | undefined }>();
  return (place, show) => {
    const key = `${place.latitude},${place.longitude}|${place.units}`;
    const running = in_flight.get(key);
    if (running) {
      running.listeners.add(show);
      if (running.latest) show(running.latest);
      return;
    }
    const entry = { listeners: new Set([show]), latest: undefined as AirQuality | undefined };
    in_flight.set(key, entry);
    const spec = { name: "air", key, ttl_ms: AIR_TTL_MS, max_age_ms: AIR_MAX_AGE_MS, is_value: is_air_quality, produce: async () => {
      const text = await fetch_text(air_quality_url(place), net);
      return text === undefined ? undefined : parse_air_quality(text, place.units);
    } };
    const announce = (air: AirQuality) => {
      if (!is_live()) return;
      entry.latest = air;
      for (const listener of entry.listeners) listener(air);
    };
    // A failure leaves the row out and the rest of the panel alone.
    void refused_as(load_cached(spec, net, announce), false).then(() => in_flight.delete(key));
  };
}
