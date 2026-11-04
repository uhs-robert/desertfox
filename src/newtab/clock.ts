// An analog clock on a 24 hour face: the hour hand turns once a day, so noon points down.
export type ClockAngles = { hour: number; minute: number; second: number };

// Degrees clockwise from the top.
export function clock_angles(time: Date): ClockAngles {
  const seconds = time.getSeconds();
  const minutes = time.getMinutes() + seconds / 60;
  const hours = time.getHours() + minutes / 60;
  return { hour: (hours / 24) * 360, minute: minutes * 6, second: seconds * 6 };
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svg_element(name: string, attributes: Record<string, string>): SVGElement {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

export function draw_clock(): { element: SVGElement; update(time: Date): void } {
  const face = svg_element("svg", { viewBox: "-50 -50 100 100", class: "clock", role: "img", "aria-label": "Clock" });
  face.append(svg_element("circle", { r: "48", fill: "none", stroke: "currentColor", "stroke-width": "1" }));
  for (let hour = 0; hour < 24; hour++) {
    const major = hour % 6 === 0;
    face.append(svg_element("line", { y1: "-46", y2: major ? "-40" : "-43", stroke: "currentColor", "stroke-width": major ? "1.5" : "0.8", transform: `rotate(${hour * 15})` }));
  }
  const hand = (name: string, length: number, width: number, color: string) => face.appendChild(svg_element("line", { class: name, y1: "4", y2: String(-length), stroke: color, "stroke-width": String(width), "stroke-linecap": "round" }));
  const hands = { hour: hand("hour", 26, 3, "currentColor"), minute: hand("minute", 38, 2, "currentColor"), second: hand("second", 42, 1, "var(--oasisfox-accent)") };
  face.append(svg_element("circle", { r: "2", fill: "var(--oasisfox-accent)" }));
  const update = (time: Date) => {
    const angles = clock_angles(time);
    for (const name of ["hour", "minute", "second"] as const) hands[name].setAttribute("transform", `rotate(${angles[name]})`);
  };
  return { element: face, update };
}
