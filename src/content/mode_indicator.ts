// A badge in the bottom-right corner that names the mode.
// Top frame only, so frames do not each draw one.

import type { ColorPair } from "../shared/mode_colors.ts";
import { create_surface, SURFACE_DEFAULT_VARIABLES } from "./surface.ts";

const STYLE = `
.oasisfox-mode {${SURFACE_DEFAULT_VARIABLES}
  position: fixed; right: 16px; bottom: 8px; padding: 4px 8px; pointer-events: none;
  background: var(--mode-bg, var(--oasisfox-bg)); color: var(--mode-fg, var(--oasisfox-fg));
  font: var(--oasisfox-font); border-radius: var(--oasisfox-radius);
}
@media (prefers-color-scheme: light) {
  .oasisfox-mode { background: var(--mode-light-bg, var(--oasisfox-bg)); color: var(--mode-light-fg, var(--oasisfox-fg)); }
}`;

// The variant follows the system theme in CSS, so the badge needs no listener.
export type BadgeColors = { dark: ColorPair; light: ColorPair };

let surface: ReturnType<typeof create_surface> | undefined;

export function show_mode_label(label: string | undefined, colors?: BadgeColors): void {
  if (window !== window.top) return;
  if (label === undefined) return surface?.host.remove();
  surface ??= create_surface("oasisfox-mode", STYLE);
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
