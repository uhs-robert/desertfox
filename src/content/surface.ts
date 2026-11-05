// A closed shadow root on the page for one small surface. A surface style must not declare --oasisfox-bg-core, -fg-core,
// -font or -radius: a declaration shadows a value the page or host sets. Write each default as a var() fallback.

import { THEME_STORAGE_KEY, USER_CSS_STORAGE_KEY } from "../background/storage_keys.ts";
import { LAYER_ATTRIBUTE, RESTACKED_EVENT } from "../shared/layers.ts";
import { theme_css, watch_stored } from "../shared/theme/apply.ts";
import type { StoredTheme } from "../shared/theme/apply.ts";

// Each surface holds, after its built-in style, a theme sheet and then a user CSS sheet, so user CSS wins. Every surface of the
// bundle shares one storage read and one change listener, which the first surface starts.
type Sheets = { selector: string; theme: HTMLStyleElement; user: HTMLStyleElement };
const surfaces = new Set<Sheets>();
let theme: StoredTheme | undefined;
let user_css = "";
let watching = false;

const fill_theme = (sheets: Sheets) => { sheets.theme.textContent = theme ? theme_css(theme, sheets.selector) : ""; };

function watch_once(): void {
  if (watching) return;
  watching = true;
  watch_stored<StoredTheme>(THEME_STORAGE_KEY, (value) => {
    theme = value;
    surfaces.forEach(fill_theme);
  });
  watch_stored<string>(USER_CSS_STORAGE_KEY, (value) => {
    user_css = value ?? "";
    for (const sheets of surfaces) sheets.user.textContent = user_css;
  });
}

export function create_surface(class_name: string, style: string, layer: number): { host: HTMLElement; text: HTMLElement } {
  const host = document.createElement("div");
  host.setAttribute("popover", "manual");
  host.setAttribute(LAYER_ATTRIBUTE, String(layer));
  host.style.cssText = `all: initial; position: fixed; z-index: ${layer};`;
  const root = host.attachShadow({ mode: "closed" });
  const style_element = document.createElement("style");
  style_element.textContent = style;
  const text = document.createElement("div");
  text.className = class_name;
  const sheets: Sheets = { selector: `.${class_name}`, theme: document.createElement("style"), user: document.createElement("style") };
  fill_theme(sheets);
  sheets.user.textContent = user_css;
  surfaces.add(sheets);
  watch_once();
  root.append(style_element, sheets.theme, sheets.user, text);
  return { host, text };
}

// Mounts a surface in the top layer, above any modal dialog or popover. Top-layer order follows show order and ignores
// z-index, so the mounted host and every open host of a higher layer are shown again, lowest first: the order of LAYERS
// holds whichever surface mounts last. Hosts of other bundles are found by their layer attribute. A host already on the page
// is not appended again: moving an iframe host reloads its frame. Hiding takes the focus out of a host, so each host shown
// again, except the mounted one, hears `RESTACKED_EVENT` and may take its focus back.
export function mount_surface(host: HTMLElement): void {
  if (host.parentElement !== document.documentElement) document.documentElement.append(host);
  const layer_of = (element: Element) => Number(element.getAttribute(LAYER_ATTRIBUTE));
  const restack = Array.from(document.documentElement.querySelectorAll<HTMLElement>(`:scope > [${LAYER_ATTRIBUTE}]`))
    .filter((other) => other === host || (layer_of(other) > layer_of(host) && other.matches(":popover-open")))
    .sort((low, high) => layer_of(low) - layer_of(high));
  for (const surface_host of restack) {
    if (surface_host.matches(":popover-open")) surface_host.hidePopover();
    surface_host.showPopover();
  }
  for (const surface_host of restack) if (surface_host !== host) surface_host.dispatchEvent(new Event(RESTACKED_EVENT));
}
