// One short message on the page.

import { LAYERS } from "../shared/layers.ts";
import type { ToastKind } from "../shared/messages.ts";
import { create_surface, mount_surface } from "./surface.ts";

const TOAST_MS = 3000;

export const STYLE = `
.oasisfox-toast {
  position: fixed; right: 16px; bottom: 48px; max-width: 40ch; padding: 8px 12px;
  background: var(--oasisfox-bg-core, #0c0e13); color: var(--oasisfox-fg-core, #f5f5dc);
  font: var(--oasisfox-font, 14px system-ui, sans-serif); border-radius: var(--oasisfox-radius, 6px);
}
.oasisfox-toast.error { border: 1px solid var(--oasisfox-error, #ffa0a0); border-left-width: 4px; }
.oasisfox-toast.warning { border: 1px solid var(--oasisfox-warn, #f0e68c); border-left-width: 4px; }
.oasisfox-toast.info { border: 1px solid var(--oasisfox-info, #81c0ff); border-left-width: 4px; }
.oasisfox-toast.success { border: 1px solid var(--oasisfox-ok, #a3e39a); border-left-width: 4px; }`;

let surface: ReturnType<typeof create_surface> | undefined;
let hide_timer: ReturnType<typeof setTimeout> | undefined;

// Each kind takes its frame color from one theme role. The text stays fg_core, so the message reads the same in every kind.
export function show_toast(message: string, kind: ToastKind = "error"): void {
  surface ??= create_surface("oasisfox-toast", STYLE, LAYERS.toast);
  surface.text.textContent = message;
  surface.text.className = `oasisfox-toast ${kind}`;
  mount_surface(surface.host);
  clearTimeout(hide_timer);
  hide_timer = setTimeout(() => surface?.host.remove(), TOAST_MS);
}
