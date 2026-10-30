// A closed shadow root on the page for one small surface. Defaults sit on the
// inner element so page CSS cannot match the host and override them.

export const SURFACE_DEFAULT_VARIABLES = `
  --oasisfox-bg: #222;
  --oasisfox-fg: #eee;
  --oasisfox-font: 14px system-ui, sans-serif;
  --oasisfox-radius: 6px;`;

export function create_surface(class_name: string, style: string): { host: HTMLElement; text: HTMLElement } {
  const host = document.createElement("div");
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  const style_element = document.createElement("style");
  style_element.textContent = style;
  const text = document.createElement("div");
  text.className = class_name;
  root.append(style_element, text);
  return { host, text };
}
