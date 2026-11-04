// The built-in page: the clock, the date and the optional IP and weather lines.
import type { Settings } from "../shared/config.ts";
import { cached } from "./cache.ts";
import type { CacheArea } from "./cache.ts";
import { draw_clock } from "./clock.ts";
import { fetch_ip_info } from "./ip.ts";
import type { IpInfo } from "./ip.ts";
import { fetch_weather } from "./weather.ts";
import type { Weather } from "./weather.ts";

type WidgetSettings = Pick<Settings, "newtab_clock" | "newtab_date" | "newtab_ip" | "newtab_weather" | "weather_units" | "weather_lat" | "weather_lon">;

export type Widgets = { clock: boolean; date: boolean; ip: IpInfo | null; weather: Weather | null; place: string };

export type WidgetDeps = { fetch_json: (url: string) => Promise<unknown>; area: CacheArea; now: number };

const IP_CACHE_KEY = "oasisfox_newtab_ip";
const WEATHER_CACHE_KEY = "oasisfox_newtab_weather";

// IP and weather ask a service, so they need a `true`. Clock and date need only to be not `false`.
export function enabled_widgets(settings: WidgetSettings) {
  return { clock: settings.newtab_clock !== false, date: settings.newtab_date !== false, ip: settings.newtab_ip === true, weather: settings.newtab_weather === true };
}

// Coordinates from both settings win, and then the IP lookup runs only when the IP line is shown.
export async function load_widgets(settings: WidgetSettings, deps: WidgetDeps): Promise<Widgets> {
  const enabled = enabled_widgets(settings);
  const pinned = typeof settings.weather_lat === "number" && typeof settings.weather_lon === "number" ? { latitude: settings.weather_lat, longitude: settings.weather_lon } : null;
  const needs_lookup = enabled.ip || (enabled.weather && pinned === null);
  const ip_info = needs_lookup ? await cached(deps.area, IP_CACHE_KEY, "", deps.now, () => fetch_ip_info(deps.fetch_json)) : null;
  const where = pinned ?? ip_info;
  const units = settings.weather_units ?? "metric";
  const weather = enabled.weather && where ? await cached(deps.area, WEATHER_CACHE_KEY, `${where.latitude},${where.longitude},${units}`, deps.now, () => fetch_weather(deps.fetch_json, where.latitude, where.longitude, units)) : null;
  // The IP city names the weather place only when the weather comes from the IP coordinates.
  return { clock: enabled.clock, date: enabled.date, ip: enabled.ip ? ip_info : null, weather, place: pinned === null ? (ip_info?.city ?? "") : "" };
}

function line(class_name: string, text: string): HTMLElement {
  const element = document.createElement("p");
  element.className = class_name;
  element.textContent = text;
  return element;
}

export function render_new_tab(body: HTMLElement, settings: WidgetSettings = {}, deps?: WidgetDeps): void {
  const page = document.createElement("main");
  page.className = "oasisfox-newtab";
  body.prepend(page);

  const enabled = enabled_widgets(settings);
  if (enabled.clock) {
    const clock = draw_clock();
    page.append(clock.element);
    clock.update(new Date());
    setInterval(() => clock.update(new Date()), 1000);
  }
  if (enabled.date) page.append(line("date", new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })));

  if (!deps || !(enabled.ip || enabled.weather)) return;
  // The lines appear when their answers arrive, so a slow or failed service never holds up the clock.
  void load_widgets(settings, deps).then((widgets) => {
    if (widgets.ip) page.append(line("ip", widgets.ip.city ? `${widgets.ip.ip} · ${widgets.ip.city}` : widgets.ip.ip));
    if (widgets.weather) {
      const { temperature, unit, description } = widgets.weather;
      page.append(line("weather", [`${temperature}${unit}`, description, widgets.place].filter((part) => part !== "").join(" · ")));
    }
  });
}
