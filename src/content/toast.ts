// One short message on the page.

import { create_surface, SURFACE_DEFAULT_VARIABLES } from "./surface.ts";

const TOAST_MS = 3000;

const STYLE = `
.oasisfox-toast {${SURFACE_DEFAULT_VARIABLES}
  position: fixed; right: 16px; bottom: 48px; max-width: 40ch; padding: 8px 12px;
  background: var(--oasisfox-bg); color: var(--oasisfox-fg);
  font: var(--oasisfox-font); border-radius: var(--oasisfox-radius);
}`;

let surface: ReturnType<typeof create_surface> | undefined;
let hide_timer: ReturnType<typeof setTimeout> | undefined;

export function show_toast(message: string): void {
  surface ??= create_surface("oasisfox-toast", STYLE);
  surface.text.textContent = message;
  document.documentElement.append(surface.host);
  clearTimeout(hide_timer);
  hide_timer = setTimeout(() => surface?.host.remove(), TOAST_MS);
}
