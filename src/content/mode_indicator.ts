// A badge in the bottom-right corner that names the mode.
// Top frame only, so frames do not each draw one.

import { LAYERS } from "../shared/layers.ts";
import { BADGE_HOST_ATTRIBUTE, remove_badge_hosts } from "./badge_hosts.ts";
import { create_surface, mount_surface } from "./surface.ts";

// :where keeps each mode rule at the specificity of the public class, so a user's `.desertfox-mode` rule in style.css still wins.
// The fallback after each mode token is the moonlight dark value, for a page where the stored theme has not arrived. The light variant comes from the theme sheet.
export const STYLE = `
.desertfox-mode {
  position: fixed; right: 16px; bottom: 8px; padding: 4px 8px; pointer-events: none;
  background: var(--desertfox-bg-core, #0c0e13); color: var(--desertfox-fg-core, #f5f5dc);
  font: var(--desertfox-font, 14px system-ui, sans-serif); border-radius: var(--desertfox-radius, 6px);
}
.desertfox-mode:where([data-mode]) { color: var(--desertfox-bg-core, #0c0e13); }
.desertfox-mode:where([data-mode="normal"]) { background: var(--desertfox-mode-normal, #7fa3c9); }
.desertfox-mode:where([data-mode="insert"]) { background: var(--desertfox-mode-insert, #ffa0a0); }
.desertfox-mode:where([data-mode="ignore"]) { background: var(--desertfox-mode-ignore, #717a84); }
.desertfox-mode:where([data-mode="caret"]) { background: var(--desertfox-mode-caret, #f0e68c); }
.desertfox-mode:where([data-mode="visual"]) { background: var(--desertfox-mode-visual, #ffba75); }`;

let surface: ReturnType<typeof create_surface> | undefined;

export function show_mode_label(label: string | undefined, mode?: string): void {
  if (window !== window.top) return;
  if (label === undefined) return remove_badge_hosts();
  surface ??= create_surface("desertfox-mode", STYLE, LAYERS.mode_badge);
  surface.host.setAttribute(BADGE_HOST_ATTRIBUTE, "");
  surface.text.textContent = label;
  if (mode === undefined) surface.text.removeAttribute("data-mode");
  else surface.text.setAttribute("data-mode", mode);
  // The key test reads this attribute, because the shadow root is closed.
  surface.host.setAttribute("data-desertfox-mode", label);
  surface.host.style.pointerEvents = "none";
  remove_badge_hosts();
  mount_surface(surface.host);
}
