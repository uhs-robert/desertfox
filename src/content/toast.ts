// One short message on the page.

import { LAYERS } from "../shared/layers.ts";
import type { ToastKind } from "../shared/messages.ts";
import { create_surface, mount_surface } from "./surface.ts";

export const STYLE = `
.desertfox-toast {
  position: fixed; right: 16px; bottom: 48px; max-width: 40ch; padding: 8px 12px;
  background: var(--desertfox-bg-core, #0c0e13); color: var(--desertfox-fg-core, #f5f5dc);
  font: var(--desertfox-font, 14px system-ui, sans-serif); border-radius: var(--desertfox-radius, 6px);
}
.desertfox-toast.error { border: 1px solid var(--desertfox-error, #ffa0a0); border-left-width: 4px; }
.desertfox-toast.warning { border: 1px solid var(--desertfox-warn, #f0e68c); border-left-width: 4px; }
.desertfox-toast.info { border: 1px solid var(--desertfox-info, #81c0ff); border-left-width: 4px; }
.desertfox-toast.success { border: 1px solid var(--desertfox-ok, #a3e39a); border-left-width: 4px; }`;

let surface: ReturnType<typeof create_surface> | undefined;
let hide_timer: ReturnType<typeof setTimeout> | undefined;

// Each kind takes its frame color from one theme role. The text stays fg_core, so the message reads the same in every kind.
export function show_toast(message: string, duration_ms: number, kind: ToastKind = "error"): void {
  surface ??= create_surface("desertfox-toast", STYLE, LAYERS.toast);
  surface.text.textContent = message;
  surface.text.className = `desertfox-toast ${kind}`;
  mount_surface(surface.host);
  clearTimeout(hide_timer);
  hide_timer = setTimeout(() => surface?.host.remove(), duration_ms);
}
