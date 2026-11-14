// The line icon of the weather card, drawn from the WMO code. It takes the text color, so the theme styles it.
export type IconKind = "clear" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm";

export function icon_kind(code: number): IconKind {
  if (code === 0) return "clear";
  if (code <= 2) return "partly";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  if (code >= 51 && code <= 82) return "rain";
  return "cloud";
}

const CLOUD = "M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 9.2 4.4 4.4 0 0 0 7 18z";
const HIGH_CLOUD = "M7 14h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 5.2 4.4 4.4 0 0 0 7 14z";

const PATHS: Record<IconKind, readonly string[]> = {
  clear: ["M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1", "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"],
  partly: ["M8 2v2M2 8h2M3.8 3.8l1.4 1.4M12.2 3.8l-1.4 1.4", "M8 5.5a2.5 2.5 0 1 0 0 5", "M9 20h8a3.5 3.5 0 0 0 .5-6.95A4.8 4.8 0 0 0 9 12.3 3.9 3.9 0 0 0 9 20z"],
  cloud: [CLOUD],
  fog: ["M4 9h16M6 13h12M4 17h16"],
  rain: [HIGH_CLOUD, "M8 17l-1 3M12 17l-1 3M16 17l-1 3"],
  snow: [HIGH_CLOUD, "M8 18h.01M12 19h.01M16 18h.01M10 21h.01M14 21h.01"],
  storm: [HIGH_CLOUD, "M12.5 14.5l-2.5 3.5h3.5l-2.5 3.5"],
};

export function draw_weather_icon(code: number): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "weather-icon");
  svg.setAttribute("aria-hidden", "true");
  for (const d of PATHS[icon_kind(code)]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
