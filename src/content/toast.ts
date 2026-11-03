// One short message on the page.

import { LAYERS } from "../shared/layers.ts";
import { create_surface } from "./surface.ts";

const TOAST_MS = 3000;

export const STYLE = `
.oasisfox-toast {
  position: fixed; right: 16px; bottom: 48px; max-width: 40ch; padding: 8px 12px;
  background: var(--oasisfox-bg, #222); color: var(--oasisfox-fg, #eee);
  font: var(--oasisfox-font, 14px system-ui, sans-serif); border-radius: var(--oasisfox-radius, 6px);
}`;

let surface: ReturnType<typeof create_surface> | undefined;
let hide_timer: ReturnType<typeof setTimeout> | undefined;

export function show_toast(message: string): void {
  surface ??= create_surface("oasisfox-toast", STYLE, LAYERS.toast);
  surface.text.textContent = message;
  document.documentElement.append(surface.host);
  clearTimeout(hide_timer);
  hide_timer = setTimeout(() => surface?.host.remove(), TOAST_MS);
}
