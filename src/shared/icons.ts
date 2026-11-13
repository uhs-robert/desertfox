// The small inline icons the extension pages draw. Each is built with DOM calls, never markup, and takes its color from the text (stroke) or from a class that sets `fill`.

const SVG_NS = "http://www.w3.org/2000/svg";

function icon(path_data: string, class_name?: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  if (class_name) svg.setAttribute("class", class_name);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", path_data);
  svg.append(path);
  return svg;
}

export const chevron_icon = (): SVGElement => icon("M6 3l5 5-5 5");
export const menu_icon = (): SVGElement => icon("M2 4h12M2 8h12M2 12h12");
export const heart_icon = (class_name?: string): SVGElement =>
  icon("M8 14 C2 9.8 1 7.4 1 5.5 C1 3.5 2.5 2 4.3 2 C5.8 2 7.1 2.8 8 4.1 C8.9 2.8 10.2 2 11.7 2 C13.5 2 15 3.5 15 5.5 C15 7.4 14 9.8 8 14 Z", class_name);
