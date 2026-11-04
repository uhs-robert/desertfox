// A badge in the bottom-right corner that names the mode.
// Top frame only, so frames do not each draw one.

import { LAYERS } from "../shared/layers.ts";
import type { ColorPair } from "../shared/mode_colors.ts";
import { create_surface } from "./surface.ts";

export const STYLE = `
.oasisfox-mode {
  position: fixed; right: 16px; bottom: 8px; padding: 4px 8px; pointer-events: none;
  background: var(--mode-bg, var(--oasisfox-bg-core, #0c0e13)); color: var(--mode-fg, var(--oasisfox-fg-core, #f5f5dc));
  font: var(--oasisfox-font, 14px system-ui, sans-serif); border-radius: var(--oasisfox-radius, 6px);
}
@media (prefers-color-scheme: light) {
  .oasisfox-mode { background: var(--mode-light-bg, var(--oasisfox-bg-core, #0c0e13)); color: var(--mode-light-fg, var(--oasisfox-fg-core, #f5f5dc)); }
}`;

// The variant follows the system theme in CSS, so the badge needs no listener.
export type BadgeColors = { dark: ColorPair; light: ColorPair };

let surface: ReturnType<typeof create_surface> | undefined;

export function show_mode_label(label: string | undefined, colors?: BadgeColors): void {
  if (window !== window.top) return;
  if (label === undefined) return surface?.host.remove();
  surface ??= create_surface("oasisfox-mode", STYLE, LAYERS.mode_badge);
  surface.text.textContent = label;
  const { style } = surface.text;
  const set = (name: string, value: string | undefined) => (value === undefined ? style.removeProperty(name) : style.setProperty(name, value));
  set("--mode-bg", colors?.dark[0]);
  set("--mode-fg", colors?.dark[1]);
  set("--mode-light-bg", colors?.light[0]);
  set("--mode-light-fg", colors?.light[1]);
  // The key test reads this attribute, because the shadow root is closed.
  surface.host.setAttribute("data-oasisfox-mode", label);
  surface.host.style.pointerEvents = "none";
  document.documentElement.append(surface.host);
}
