// The part of the weather card that opens under the More button: UV index, sunrise and sunset, and the next hours. Everything here comes from the one forecast request. The air quality row (`air_quality.ts`) is the only part that sends a request, and only on open.
import type { ClockFormat } from "./digital_clock.ts";
import { draw_fact_icon, draw_weather_icon, type FactIcon } from "./weather_icon.ts";
import { describe_code, type WeatherDetail, type WeatherHour } from "./weather.ts";

// Under this many later hours the strip is hidden: a reading kept for hours would otherwise show a strip that has run out.
export const MIN_STRIP_HOURS = 3;
export const MAX_STRIP_HOURS = 11;
// The strip is one row with no wrap and no scroll, so the hours shown depend on the panel's width. It never shows fewer than this many while the hours exist.
export const MIN_FIT_HOURS = 6;
// Sizes in rem, matching `.weather-hour` and `.weather-hours` in newtab.html, and the panel's `max-width`, padding and border.
const HOUR_WIDTH_REM = 2.5;
const HOUR_GAP_REM = 0.25;
const PANEL_MAX_REM = 22;
const PANEL_SIDE_MARGIN_REM = 2.5;
const PANEL_INNER_LOSS_REM = 1.625;

// How many hour columns fit the panel in a window `view_px` wide, given the root font size `rem_px`, which follows zoom.
export function hours_that_fit(view_px: number, rem_px: number): number {
  const panel_rem = Math.min(PANEL_MAX_REM, view_px / rem_px - PANEL_SIDE_MARGIN_REM);
  const fits = Math.floor((panel_rem - PANEL_INNER_LOSS_REM + HOUR_GAP_REM) / (HOUR_WIDTH_REM + HOUR_GAP_REM));
  return Math.min(MAX_STRIP_HOURS, Math.max(MIN_FIT_HOURS, fits));
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

// The side the wind comes from, as Open-Meteo reports it, in eight points.
export const compass_point = (degrees: number): string => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]!;

// "07:42" or "15:00" from a local time string. The browser's own time zone must not shift it, so it is sliced and never parsed as a date.
export function clock_text(hhmm: string, format: ClockFormat): string {
  if (format === 24) return hhmm;
  const hours = Number(hhmm.slice(0, 2));
  return `${hours % 12 || 12}${hhmm.slice(2)} ${hours < 12 ? "AM" : "PM"}`;
}

const place_hour_of = (utc_offset_seconds: number, now_ms: number): string => new Date(now_ms + utc_offset_seconds * 1000).toISOString().slice(0, 13);

// The place's current hour and the hours after it, in the place's own time. A stored answer can be hours old, and the draw drops the hours that have passed.
export function hours_from_now(hours: WeatherHour[], utc_offset_seconds: number, now_ms: number, most = MAX_STRIP_HOURS): WeatherHour[] {
  const place_hour = place_hour_of(utc_offset_seconds, now_ms);
  return hours.filter((hour) => hour.time.slice(0, 13) >= place_hour).slice(0, most);
}

export const divider = (): HTMLElement => {
  const line = document.createElement("hr");
  line.className = "weather-divider";
  return line;
};

// A value over its small label.
export function stat(value: string, label: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "weather-stat";
  const big = document.createElement("span");
  big.className = "weather-value";
  big.textContent = value;
  const small = document.createElement("span");
  small.className = "weather-label";
  small.textContent = label;
  box.append(big, small);
  return box;
}

// Hours start on the hour, so the 12 hour label drops the minutes: "3 PM".
const hour_label = (time: string, format: ClockFormat): string => (format === 24 ? time.slice(11, 16) : clock_text(time.slice(11, 16), 12).replace(":00", ""));

// A thin bar under the rain chance, as wide as the percent.
function draw_rain_chance(chance: number | undefined): HTMLElement {
  const rain = document.createElement("div");
  rain.className = "weather-rain";
  const text = document.createElement("span");
  text.className = "weather-label";
  text.textContent = chance === undefined ? "" : `${Math.round(chance)}%`;
  const track = document.createElement("span");
  track.className = "weather-rain-bar";
  const fill = document.createElement("span");
  fill.style.width = `${chance === undefined ? 0 : Math.min(100, Math.max(0, Math.round(chance)))}%`;
  track.append(fill);
  rain.append(text, track);
  return rain;
}

// Four rows: the hour (or "Now"), the condition icon, the temperature and the rain chance with its bar. The rain row stays in place when Open-Meteo gives none, so the columns stay aligned.
function draw_hour(hour: WeatherHour, format: ClockFormat, is_now: boolean): HTMLElement {
  const column = document.createElement("div");
  column.className = is_now ? "weather-hour weather-hour-now" : "weather-hour";
  const label = document.createElement("span");
  label.className = "weather-label";
  label.textContent = is_now ? "Now" : hour_label(hour.time, format);
  const degrees = document.createElement("span");
  degrees.className = "weather-value";
  degrees.textContent = `${Math.round(hour.temperature)}\u00b0`;
  column.append(label, draw_weather_icon(hour.code, describe_code(hour.code)), degrees, draw_rain_chance(hour.rain_chance));
  return column;
}

// The strip of hours from the current one, with the divider under it, or undefined under `MIN_STRIP_HOURS`. The first column reads "Now" when it is the place's current hour. The More button draws it again on each open, so a panel left closed for hours never shows hours that have passed.
export function draw_hours_strip(hours: WeatherHour[], utc_offset_seconds: number, format: ClockFormat, now_ms: number, most = MAX_STRIP_HOURS): HTMLElement | undefined {
  const shown = hours_from_now(hours, utc_offset_seconds, now_ms, most);
  if (shown.length < MIN_STRIP_HOURS) return undefined;
  const place_hour = place_hour_of(utc_offset_seconds, now_ms);
  const row = document.createElement("div");
  row.className = "weather-hours";
  row.append(...shown.map((hour) => draw_hour(hour, format, hour.time.slice(0, 13) === place_hour)));
  const group = document.createElement("div");
  group.className = "weather-strip";
  group.append(row, divider());
  return group;
}

// An icon, a small muted label and the value under it.
function fact(icon: FactIcon, label: string, value: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "weather-fact";
  const text = document.createElement("div");
  text.className = "weather-fact-text";
  const small = document.createElement("span");
  small.className = "weather-label";
  small.textContent = label;
  const big = document.createElement("span");
  big.className = "weather-value";
  big.textContent = value;
  text.append(small, big);
  box.append(draw_fact_icon(icon), text);
  return box;
}

// The panel, drawn closed: the hours on top, a divider, then UV index, sunrise and sunset side by side. The air quality row joins below its own divider when it arrives. Its text is plain, so hints and Tab reach only the More button.
export function draw_weather_detail(detail: WeatherDetail, utc_offset_seconds: number, format: ClockFormat, now_ms: number): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "weather-detail";
  const strip = draw_hours_strip(detail.hours, utc_offset_seconds, format, now_ms);
  if (strip) panel.append(strip);
  const facts = document.createElement("div");
  facts.className = "weather-facts";
  facts.append(fact("uv", "UV index", String(Math.round(detail.uv_index))), fact("sunrise", "Sunrise", clock_text(detail.sunrise, format)), fact("sunset", "Sunset", clock_text(detail.sunset, format)));
  panel.append(facts);
  return panel;
}
