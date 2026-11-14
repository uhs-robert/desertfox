// The fg_dim contrast clamp. The Oasis build (`tools/build_themes.ts`) and the base16 importer both call it, so the floor is one number in one place.

import type { RoleColors } from "./roles.ts";

export const FG_DIM_MIN_CONTRAST = 3;

export function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(color.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light! + 0.05) / (dark! + 0.05);
}

function rgb_to_hsl(color: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const span = max - min;
  const saturation = span / (1 - Math.abs(2 * lightness - 1));
  const hue = max === r ? ((g - b) / span + 6) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return [hue * 60, saturation, lightness];
}

function hsl_to_rgb(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    return lightness - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${[0, 8, 4].map((offset) => Math.round(channel(offset) * 255).toString(16).padStart(2, "0")).join("")}`;
}

// A source can carry an fg_dim under 3:1 on its backgrounds, and the Oasis files stay byte copies, so the build raises them.
// Only lightness moves, away from the backgrounds, so the hue and saturation stay. Undefined when no lightness reaches the floor.
export function clamped_fg_dim(colors: Pick<RoleColors, "bg_core" | "bg_mantle" | "fg_dim">): string | undefined {
  const backgrounds = [colors.bg_core, colors.bg_mantle];
  const enough = (color: string) => backgrounds.every((background) => contrast(color, background) >= FG_DIM_MIN_CONTRAST);
  if (enough(colors.fg_dim)) return colors.fg_dim;
  const [hue, saturation, lightness] = rgb_to_hsl(colors.fg_dim);
  const lighter_first = !backgrounds.every((background) => luminance(background) > luminance(colors.fg_dim));
  // Backgrounds on opposite sides of fg_dim leave no safe direction, so the second direction is the fallback.
  for (const step of lighter_first ? [0.002, -0.002] : [-0.002, 0.002]) {
    for (let next = lightness; next >= 0 && next <= 1; next += step) {
      const candidate = hsl_to_rgb(hue, saturation, next);
      if (enough(candidate)) return candidate;
    }
  }
  return undefined;
}
