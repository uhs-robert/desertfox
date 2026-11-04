// Current weather from Open-Meteo. The request carries only the coordinates and the unit.
export type WeatherUnits = "metric" | "us";
export type Weather = { temperature: number; unit: string; description: string };

const WMO_DESCRIPTIONS: [codes: number[], text: string][] = [
  [[0], "Clear"],
  [[1, 2], "Partly cloudy"],
  [[3], "Overcast"],
  [[45, 48], "Fog"],
  [[51, 53, 55, 56, 57], "Drizzle"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "Rain"],
  [[71, 73, 75, 77, 85, 86], "Snow"],
  [[95, 96, 99], "Thunderstorm"],
];

export function weather_url(latitude: number, longitude: number, units: WeatherUnits): string {
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,weather_code",
    temperature_unit: units === "us" ? "fahrenheit" : "celsius",
  });
  return `https://api.open-meteo.com/v1/forecast?${query}`;
}

export function parse_weather_response(body: unknown): Weather | null {
  const current = (body as { current?: Record<string, unknown> } | null)?.current;
  const unit = (body as { current_units?: Record<string, unknown> } | null)?.current_units?.temperature_2m;
  if (typeof current?.temperature_2m !== "number" || typeof unit !== "string") return null;
  const code = current.weather_code;
  const description = WMO_DESCRIPTIONS.find(([codes]) => codes.includes(code as number))?.[1] ?? "";
  return { temperature: Math.round(current.temperature_2m), unit, description };
}

export async function fetch_weather(fetch_json: (url: string) => Promise<unknown>, latitude: number, longitude: number, units: WeatherUnits): Promise<Weather | null> {
  try {
    return parse_weather_response(await fetch_json(weather_url(latitude, longitude, units)));
  } catch {
    return null;
  }
}
