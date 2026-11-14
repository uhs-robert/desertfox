// The part of the weather card that opens under the More button: UV index, sunrise and sunset, and the next hours. Everything here comes from the one forecast request, so opening it sends nothing.
import type { ClockFormat } from "./digital_clock.ts";
import type { WeatherDetail, WeatherHour } from "./weather.ts";

// Under this many later hours the strip is hidden: a reading kept for hours would otherwise show a strip that has run out.
export const MIN_STRIP_HOURS = 3;
export const MAX_STRIP_HOURS = 11;

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

// The side the wind comes from, as Open-Meteo reports it, in eight points.
export const compass_point = (degrees: number): string => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]!;

// "07:42" or "15:00" from a local time string. The browser's own time zone must not shift it, so it is sliced and never parsed as a date.
export function clock_text(hhmm: string, format: ClockFormat): string {
  if (format === 24) return hhmm;
  const hours = Number(hhmm.slice(0, 2));
  return `${hours % 12 || 12}${hhmm.slice(2)} ${hours < 12 ? "AM" : "PM"}`;
}

// The hours after the place's current hour, in the place's own time. A stored answer can be hours old, and the draw drops the hours that have passed.
export function later_hours(detail: WeatherDetail, now_ms: number): WeatherHour[] {
  const place_hour = new Date(now_ms + detail.utc_offset_seconds * 1000).toISOString().slice(0, 13);
  return detail.hours.filter((hour) => hour.time.slice(0, 13) > place_hour).slice(0, MAX_STRIP_HOURS);
}

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

function draw_hour(hour: WeatherHour, format: ClockFormat): HTMLElement {
  const column = document.createElement("div");
  column.className = "weather-hour";
  const label = document.createElement("span");
  label.className = "weather-label";
  label.textContent = hour_label(hour.time, format);
  const degrees = document.createElement("span");
  degrees.className = "weather-value";
  degrees.textContent = `${Math.round(hour.temperature)}°`;
  column.append(label, degrees);
  if (hour.rain_chance !== undefined) {
    const rain = document.createElement("span");
    rain.className = "weather-label";
    rain.textContent = `${Math.round(hour.rain_chance)}%`;
    column.append(rain);
  }
  return column;
}

// The panel, drawn closed. Its text is plain, so hints and Tab reach only the More button.
export function draw_weather_detail(detail: WeatherDetail, format: ClockFormat, now_ms: number): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "weather-detail";
  const facts = document.createElement("div");
  facts.className = "weather-facts";
  facts.append(stat(String(Math.round(detail.uv_index)), "UV index"), stat(clock_text(detail.sunrise, format), "Sunrise"), stat(clock_text(detail.sunset, format), "Sunset"));
  panel.append(facts);
  const hours = later_hours(detail, now_ms);
  if (hours.length >= MIN_STRIP_HOURS) {
    const strip = document.createElement("div");
    strip.className = "weather-hours";
    strip.append(...hours.map((hour) => draw_hour(hour, format)));
    panel.append(strip);
  }
  return panel;
}
