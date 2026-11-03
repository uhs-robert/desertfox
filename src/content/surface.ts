// A closed shadow root on the page for one small surface. A surface style must not declare --oasisfox-bg, -fg,
// -font or -radius: a declaration shadows a value the page or host sets. Write each default as a var() fallback.

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
