// A closed shadow root on the page for one small surface. A surface style must not declare --oasisfox-bg-core, -fg-core,
// -font or -radius: a declaration shadows a value the page or host sets. Write each default as a var() fallback.

const LAYER_ATTRIBUTE = "data-oasisfox-layer";

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
  root.append(style_element, text);
  return { host, text };
}

// Mounts a surface in the top layer, above any modal dialog or popover. Top-layer order follows show order and ignores
// z-index, so the mounted host and every open host of a higher layer are shown again, lowest first: the order of LAYERS
// holds whichever surface mounts last. Hosts of other bundles are found by their layer attribute.
export function mount_surface(host: HTMLElement): void {
  document.documentElement.append(host);
  const layer_of = (element: Element) => Number(element.getAttribute(LAYER_ATTRIBUTE));
  const restack = Array.from(document.documentElement.querySelectorAll<HTMLElement>(`:scope > [${LAYER_ATTRIBUTE}]`))
    .filter((other) => other === host || (layer_of(other) > layer_of(host) && other.matches(":popover-open")))
    .sort((low, high) => layer_of(low) - layer_of(high));
  for (const surface_host of restack) {
    if (surface_host.matches(":popover-open")) surface_host.hidePopover();
    surface_host.showPopover();
  }
}
