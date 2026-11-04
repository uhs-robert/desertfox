// A 12 hour analog clock without tick marks.
export type ClockAngles = { hour: number; minute: number; second: number };

// Degrees clockwise from the top, from 0 up to but not including 360.
export function clock_angles(time: Date): ClockAngles {
  const seconds = time.getSeconds();
  const minutes = time.getMinutes() + seconds / 60;
  const hours = (time.getHours() % 12) + minutes / 60;
  return { hour: hours * 30, minute: minutes * 6, second: seconds * 6 };
}

// The next angle to show: the target turned forward past `previous`, so the hand's CSS transition never spins back at a wrap.
// A small step back (a corrected system clock) stays a step back.
export function unwrap_angle(previous: number, target: number): number {
  const next = target + 360 * Math.floor(previous / 360);
  return next < previous - 180 ? next + 360 : next;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const CENTER = 50;

function svg_element(name: string, attributes: Record<string, string>): SVGElement {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

export function draw_clock(): { element: SVGElement; update(time: Date): void } {
  const face = svg_element("svg", { viewBox: "0 0 100 100", class: "clock", role: "img", "aria-label": "Clock" });
  face.append(svg_element("circle", { class: "bezel", cx: String(CENTER), cy: String(CENTER), r: "45" }));
  const hand = (name: string, length: number, width: number) =>
    face.appendChild(svg_element("line", { class: name, x1: String(CENTER), y1: String(CENTER), x2: String(CENTER), y2: String(CENTER - length), "stroke-width": String(width), "stroke-linecap": "round" })) as SVGElement;
  const hands = { hour: hand("hour", 20, 3), minute: hand("minute", 35, 2), second: hand("second", 40, 1.5) };
  face.append(svg_element("circle", { class: "cap", cx: String(CENTER), cy: String(CENTER), r: "3" }));
  const shown = { hour: 0, minute: 0, second: 0 };
  const update = (time: Date) => {
    const target = clock_angles(time);
    for (const name of ["hour", "minute", "second"] as const) {
      shown[name] = unwrap_angle(shown[name], target[name]);
      hands[name].style.transform = `rotate(${shown[name]}deg)`;
    }
  };
  return { element: face, update };
}
