// A closed shadow root on the page for one small surface. A surface style must not declare --oasisfox-bg-core, -fg-core,
// -font or -radius: a declaration shadows a value the page or host sets. Write each default as a var() fallback.

export function create_surface(class_name: string, style: string, layer: number): { host: HTMLElement; text: HTMLElement } {
  const host = document.createElement("div");
  host.setAttribute("popover", "manual");
  host.style.cssText = `all: initial; position: fixed; z-index: ${layer};`;
  const root = host.attachShadow({ mode: "closed" });
  const style_element = document.createElement("style");
  style_element.textContent = style;
  const text = document.createElement("div");
  text.className = class_name;
  root.append(style_element, text);
  return { host, text };
}

// Mounts a surface in the top layer, above any modal dialog or popover. A popover shows only while attached, so every
// mount shows it again. Hiding first moves an already open one above a modal that opened since.
export function mount_surface(host: HTMLElement): void {
  document.documentElement.append(host);
  if (host.matches(":popover-open")) host.hidePopover();
  host.showPopover();
}
