// One short message on the page.

import { LAYERS } from "../shared/layers.ts";
import type { ToastKind } from "../shared/messages.ts";
import { create_surface } from "./surface.ts";

const TOAST_MS = 3000;

export const STYLE = `
.oasisfox-toast {
  position: fixed; right: 16px; bottom: 48px; max-width: 40ch; padding: 8px 12px;
  background: var(--oasisfox-bg-core, #0c0e13); color: var(--oasisfox-fg-core, #f5f5dc);
  font: var(--oasisfox-font, 14px system-ui, sans-serif); border-radius: var(--oasisfox-radius, 6px);
}
.oasisfox-toast.warning { border-left: 4px double var(--oasisfox-fg-core, #f5f5dc); }
.oasisfox-toast.info { border-left: 2px solid var(--oasisfox-fg-core, #f5f5dc); }
.oasisfox-toast.success { border-left: 4px solid var(--oasisfox-fg-core, #f5f5dc); }`;

let surface: ReturnType<typeof create_surface> | undefined;
let hide_timer: ReturnType<typeof setTimeout> | undefined;

// The theme has no color slots for kinds, so a kind shows as a left edge in the text color. An error has no edge.
export function show_toast(message: string, kind: ToastKind = "error"): void {
  surface ??= create_surface("oasisfox-toast", STYLE, LAYERS.toast);
  surface.text.textContent = message;
  surface.text.className = `oasisfox-toast ${kind}`;
  document.documentElement.append(surface.host);
  clearTimeout(hide_timer);
  hide_timer = setTimeout(() => surface?.host.remove(), TOAST_MS);
}
