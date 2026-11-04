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
export function unwrap_angle(previous: number, target: number): number {
  const next = target + 360 * Math.floor(previous / 360);
  return next < previous ? next + 360 : next;
}

// Longer than a tick plus timer jitter. A bigger step means a sleep, a throttled tab or a changed system clock.
const MAX_ANIMATED_STEP_MS = 2500;
// The most any hand turns in one animated step: the seconds hand over the longest allowed step. A hand that would turn more, or turn backward (a turn of nearly 360 forward), came from a changed local time.
const MAX_ANIMATED_TURN_DEGREES = (MAX_ANIMATED_STEP_MS / 1000) * 6;

export type ShownHands = { at_ms: number; angles: ClockAngles; jumped: boolean };

const turn_forward = (from: number, to: number) => (((to - from) % 360) + 360) % 360;

// Animation only suits a normal one second step. After a gap, a backward step or a daylight-saving change of the local hour, the hands jump to the plain angles: an animation would sweep a hand across the face or spin it almost a full turn.
export function advance_hands(previous: ShownHands | null, time: Date): ShownHands {
  const target = clock_angles(time);
  const jump = { at_ms: time.getTime(), angles: target, jumped: true };
  if (previous === null) return jump;
  const step_ms = time.getTime() - previous.at_ms;
  if (step_ms < 0 || step_ms > MAX_ANIMATED_STEP_MS) return jump;
  if ((["hour", "minute", "second"] as const).some((name) => turn_forward(previous.angles[name], target[name]) > MAX_ANIMATED_TURN_DEGREES)) return jump;
  const angles = { hour: unwrap_angle(previous.angles.hour, target.hour), minute: unwrap_angle(previous.angles.minute, target.minute), second: unwrap_angle(previous.angles.second, target.second) };
  return { at_ms: time.getTime(), angles, jumped: false };
}

export function time_label(time: Date): string {
  return time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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
  let shown: ShownHands | null = null;
  let label = "";
  const update = (time: Date) => {
    shown = advance_hands(shown, time);
    // A jump turns the transition off for one frame: reading offsetWidth applies the new angles before it comes back.
    if (shown.jumped) face.classList.add("jumping");
    for (const name of ["hour", "minute", "second"] as const) hands[name].style.transform = `rotate(${shown.angles[name]}deg)`;
    if (shown.jumped) {
      void face.getBoundingClientRect();
      face.classList.remove("jumping");
    }
    const next_label = time_label(time);
    if (next_label !== label) face.setAttribute("aria-label", (label = next_label));
  };
  return { element: face, update };
}
