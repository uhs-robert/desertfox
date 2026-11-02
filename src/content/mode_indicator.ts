// A badge in the bottom-right corner that names the mode when it is not normal.
// Top frame only, so frames do not each draw one.

import { create_surface, SURFACE_DEFAULT_VARIABLES } from "./surface.ts";

const STYLE = `
.oasisfox-mode {${SURFACE_DEFAULT_VARIABLES}
  position: fixed; right: 16px; bottom: 16px; padding: 4px 8px; pointer-events: none;
  background: var(--oasisfox-bg); color: var(--oasisfox-fg);
  font: var(--oasisfox-font); border-radius: var(--oasisfox-radius);
}`;

let surface: ReturnType<typeof create_surface> | undefined;

export function show_mode_label(label: string | undefined): void {
  if (window !== window.top) return;
  if (label === undefined) return surface?.host.remove();
  surface ??= create_surface("oasisfox-mode", STYLE);
  surface.text.textContent = label;
  // The key test reads this attribute, because the shadow root is closed.
  surface.host.setAttribute("data-oasisfox-mode", label);
  surface.host.style.pointerEvents = "none";
  document.documentElement.append(surface.host);
}
