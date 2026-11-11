// A closed shadow root on the page for one small surface. A surface style must not declare --desertfox-bg-core, -fg-core,
// -font or -radius: a declaration shadows a value the page or host sets. Write each default as a var() fallback.

import { LAYER_ATTRIBUTE, RESTACKED_EVENT } from "../shared/layers.ts";
import { FIRST_READ_DEADLINE_MS, theme_css, THEME_STORAGE_KEY, USER_CSS_STORAGE_KEY } from "../shared/theme/apply.ts";
import { watch_stored } from "../shared/storage_watch.ts";
import type { StoredTheme } from "../shared/theme/apply.ts";

// Each surface holds, after its built-in style, a theme sheet and then a user CSS sheet, so user CSS wins. Every surface of the
// bundle shares one storage read and one change listener, which the first surface starts. Only surfaces whose host is on the
// page are followed: a host that left the page (the hint view builds a new one for each run) is dropped at the next surface
// created or storage change, and `mount_surface` follows it again with the latest values.
type Sheets = { selector: string; host: HTMLElement; theme: HTMLStyleElement; user: HTMLStyleElement };
const surfaces = new Set<Sheets>();
const sheets_of_host = new WeakMap<HTMLElement, Sheets>();
let theme: StoredTheme | undefined;
let user_css = "";
let watching = false;
// Each surface is hidden until both first reads return or the deadline passes, so the var() fallbacks never show and a hung read cannot
// hide a surface for good. The content script has no synchronous storage. A read that returns after the deadline still applies.
let first_reads_pending = 2;
let waiting_for_reads = true;

const reveal = (host: HTMLElement) => { host.style.visibility = ""; };

function stop_waiting(): void {
  waiting_for_reads = false;
  surfaces.forEach((sheets) => reveal(sheets.host));
}

function first_read_done(): void {
  if (--first_reads_pending === 0) stop_waiting();
}

const fill_theme = (sheets: Sheets) => { sheets.theme.textContent = theme ? theme_css(theme, sheets.selector) : ""; };

function drop_hidden_surfaces(): void {
  for (const sheets of surfaces) if (!sheets.host.isConnected) surfaces.delete(sheets);
}

function watch_once(): void {
  if (watching) return;
  watching = true;
  if (typeof browser === "undefined") stop_waiting();
  else setTimeout(stop_waiting, FIRST_READ_DEADLINE_MS);
  let theme_read = false;
  let user_css_read = false;
  watch_stored<StoredTheme>(THEME_STORAGE_KEY, (value) => {
    theme = value;
    if (!theme_read) { theme_read = true; first_read_done(); }
    drop_hidden_surfaces();
    surfaces.forEach(fill_theme);
  });
  watch_stored<string>(USER_CSS_STORAGE_KEY, (value) => {
    user_css = value ?? "";
    if (!user_css_read) { user_css_read = true; first_read_done(); }
    drop_hidden_surfaces();
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
  drop_hidden_surfaces();
  const sheets: Sheets = { selector: `.${class_name}`, host, theme: document.createElement("style"), user: document.createElement("style") };
  fill_theme(sheets);
  sheets.user.textContent = user_css;
  surfaces.add(sheets);
  sheets_of_host.set(host, sheets);
  watch_once();
  if (waiting_for_reads) host.style.visibility = "hidden";
  root.append(style_element, sheets.theme, sheets.user, text);
  return { host, text };
}

// A popover in the top layer gets a ::backdrop, and a page rule on ::backdrop (a blur, a dim) styles it too. A `:host::backdrop`
// rule in the shadow style does not reach it, so one document-level rule resets the backdrops of our hosts only. It is a style
// element on the root element, kept by `ensure_backdrop_reset` at every mount. Rejected: an adopted stylesheet, which Firefox
// does not let a content script add to a page document and which a page replaces with one assignment; and a user-origin sheet,
// which needs the scripting permission. A style element outside <head> survives a page that rewrites <head>, and a removed
// one comes back at the next mount.
export const BACKDROP_RESET_CSS = `[popover][${LAYER_ATTRIBUTE}]::backdrop { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; filter: none !important; background: transparent !important; opacity: 1 !important; }`;
const backdrop_resets = new WeakMap<Document, HTMLStyleElement>();

function ensure_backdrop_reset(): void {
  const installed = backdrop_resets.get(document);
  if (installed?.isConnected) return;
  const style_element = installed ?? document.createElement("style");
  style_element.textContent = BACKDROP_RESET_CSS;
  backdrop_resets.set(document, style_element);
  document.documentElement.append(style_element);
}

// Mounts a surface in the top layer, above any modal dialog or popover. Top-layer order follows show order and ignores
// z-index, so the mounted host and every open host of a higher layer are shown again, lowest first: the order of LAYERS
// holds whichever surface mounts last. Hosts of other bundles are found by their layer attribute. A host already on the page
// is not appended again: moving an iframe host reloads its frame. Hiding takes the focus out of a host, so each host shown
// again, except the mounted one, hears `RESTACKED_EVENT` and may take its focus back.
export function mount_surface(host: HTMLElement): void {
  const sheets = sheets_of_host.get(host);
  if (sheets && !surfaces.has(sheets)) {
    surfaces.add(sheets);
    fill_theme(sheets);
    sheets.user.textContent = user_css;
    if (!waiting_for_reads) reveal(host);
  }
  ensure_backdrop_reset();
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
