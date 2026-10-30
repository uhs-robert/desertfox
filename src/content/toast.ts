// One short message on the page. Closed shadow root; defaults sit on the inner
// element so page CSS cannot match the host and override them.

const TOAST_MS = 3000;

const STYLE = `
.oasisfox-toast {
  --oasisfox-bg: #222;
  --oasisfox-fg: #eee;
  --oasisfox-font: 14px system-ui, sans-serif;
  --oasisfox-radius: 6px;
  position: fixed; right: 16px; bottom: 16px; max-width: 40ch; padding: 8px 12px;
  background: var(--oasisfox-bg); color: var(--oasisfox-fg);
  font: var(--oasisfox-font); border-radius: var(--oasisfox-radius);
}`;

let surface: { host: HTMLElement; text: HTMLElement } | undefined;
let hide_timer: ReturnType<typeof setTimeout> | undefined;

function create_surface() {
  const host = document.createElement("div");
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  const text = document.createElement("div");
  text.className = "oasisfox-toast";
  root.append(style, text);
  return { host, text };
}

export function show_toast(message: string): void {
  surface ??= create_surface();
  surface.text.textContent = message;
  document.documentElement.append(surface.host);
  clearTimeout(hide_timer);
  hide_timer = setTimeout(() => surface?.host.remove(), TOAST_MS);
}
