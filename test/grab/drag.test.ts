import assert from "node:assert/strict";
import { test } from "node:test";
import { abort, drive, FLING_STEPS, move_to, nudge, press, press_point, release, route_of, scale_step, snap_scroll, start_fling } from "../../src/content/grab/drag.ts";

// Node has no DOM events. The fakes keep the type, the init and the data transfer.
class FakeEvent {
  type: string;
  constructor(type: string, init: Record<string, unknown> = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}
class FakeDataTransfer {
  dropEffect = "none";
  effectAllowed = "none";
}
Object.assign(globalThis, { Event: FakeEvent, MouseEvent: FakeEvent, PointerEvent: FakeEvent, DragEvent: FakeEvent, DataTransfer: FakeDataTransfer });

type Fake = { parent?: Fake; localName: string; draggable_attribute?: string; type?: string; value?: string; draggable_: boolean; log: string[]; on: Record<string, (event: FakeEvent) => boolean | void> } & Record<string, unknown>;

// One element that is also its own document: elementFromPoint answers it, and every event lands in its log.
function element(extra: Partial<Fake> = {}): Fake {
  const self: Fake = {
    localName: "div",
    draggable_: false,
    log: [],
    on: {},
    isConnected: true,
    contains: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 20 }),
    // Models the selector's parts: an explicit draggable, and a link or picture that the page has not turned off.
    closest: (selector: string) => {
      for (let up: Fake | undefined = self; up; up = up.parent as Fake | undefined) {
        const name = up.localName === "a" ? "a[href]" : up.localName;
        const plain = selector.includes(name) && !selector.includes(`${name}:not`);
        const unless_off = selector.includes(`${name}:not`) && up.draggable_attribute !== "false";
        if ((up.draggable_ && selector.includes('[draggable="true"]')) || (["a", "img"].includes(up.localName) && (plain || unless_off))) return up;
      }
      return null;
    },
    getAttribute: (name: string) => (name === "draggable" ? self.draggable_attribute ?? null : (self.attrs as Record<string, string>)[name] ?? null),
    dispatchEvent(event: FakeEvent) {
      self.log.push(event.type);
      const result = self.on[event.type]?.(event);
      return result !== false;
    },
    attrs: {} as Record<string, string>,
    querySelector: () => null,
    elementFromPoint: () => self,
    body: undefined,
    ...extra,
  };
  self.ownerDocument = self;
  return self;
}
const as_element = (fake: Fake) => fake as unknown as Element;

test("the route follows the source: a draggable ancestor, a range input, anything else", () => {
  assert.equal(route_of(as_element(element({ draggable_: true }))).route, "html5");
  assert.equal(route_of(as_element(element({ localName: "input", type: "range" }))).route, "range");
  assert.equal(route_of(as_element(element())).route, "pointer");
});

test("a link takes the html5 route with no draggable attribute, unless the page turns dragging off", () => {
  assert.equal(route_of(as_element(element({ localName: "a" }))).route, "html5");
  assert.equal(route_of(as_element(element({ localName: "a", draggable_attribute: "false" }))).route, "pointer");
});

test("the press comes first, so an element a library makes draggable in its own pointerdown takes the html5 route", () => {
  const source = element();
  source.on.pointerdown = () => void (source.draggable_ = true);
  const held = press(as_element(source));
  assert.equal(held?.route, "html5");
  assert.deepEqual(source.log, ["pointerdown", "mousedown", "dragstart"]);
});

test("a page that cancels dragstart refuses the grab", () => {
  const source = element({ draggable_: true });
  source.on.dragstart = () => false;
  assert.equal(press(as_element(source)), undefined);
  // The press went out before the page cancelled, so the release must follow it.
  assert.deepEqual(source.log, ["pointerdown", "mousedown", "dragstart", "pointerup", "mouseup"]);
});

test("a cancelled pointerdown sends no mouse events for the rest of the press", () => {
  const source = element();
  source.on.pointerdown = () => false;
  const held = press(as_element(source))!;
  move_to(held, { x: 5, y: 5 });
  release(held);
  assert.deepEqual(source.log, ["pointerdown", "pointermove", "pointerup"]);
});

test("release and abort end a drag once, and the pointer route always sends its up events", () => {
  const source = element();
  const held = press(as_element(source))!;
  move_to(held, { x: 50, y: 5 });
  abort(held);
  release(held);
  abort(held);
  assert.deepEqual(source.log, ["pointerdown", "mousedown", "pointermove", "mousemove", "pointerup", "mouseup"]);
});

test("a stopped drive sends nothing after the abort", async () => {
  const source = element();
  const held = press(as_element(source))!;
  const driving = drive(held, { x: 90, y: 5 });
  abort(held);
  await driving;
  assert.equal(source.log.filter((type) => type === "pointerup").length, 1);
});

test("the html5 drop fires only where dragover was cancelled, and dragend carries the accepted effect", () => {
  const source = element({ draggable_: true });
  const target = element();
  Object.assign(source, { elementFromPoint: () => target });
  target.on.dragover = () => false;
  target.on.drop = () => false;
  const held = press(as_element(source))!;
  move_to(held, { x: 50, y: 5 });
  let effect = "";
  source.on.dragend = () => void (effect = held.data!.dropEffect);
  release(held);
  assert.deepEqual(target.log, ["dragenter", "dragover", "drop"]);
  assert.equal(effect, "move");
});

test("the html5 abort sends dragleave and dragend with no drop", () => {
  const source = element({ draggable_: true });
  const target = element();
  Object.assign(source, { elementFromPoint: () => target });
  target.on.dragover = () => false;
  const held = press(as_element(source))!;
  move_to(held, { x: 50, y: 5 });
  abort(held);
  assert.deepEqual(target.log, ["dragenter", "dragover", "dragleave"]);
  assert.equal(source.log.at(-1), "dragend");
  assert.equal(held.data!.dropEffect, "none");
});

test("a range input fires change only when the value changed, and never on a cancel", () => {
  const make = () => {
    const input = element({ localName: "input", type: "range", value: "0" });
    Object.assign(input, { stepUp: () => void (input.value = String(Number(input.value) + 1)), stepDown: () => void (input.value = String(Number(input.value) - 1)) });
    return input;
  };
  const unchanged = make();
  release(press(as_element(unchanged))!);
  assert.deepEqual(unchanged.log, []);

  const stepped = make();
  const held = press(as_element(stepped))!;
  nudge(held, "right");
  release(held);
  assert.deepEqual(stepped.log, ["input", "change"]);

  const cancelled = make();
  const other = press(as_element(cancelled))!;
  nudge(other, "right");
  abort(other);
  assert.equal(cancelled.value, "0");
  assert.deepEqual(cancelled.log, ["input", "input"]);
});

test("a target that cancels dragover and sets dropEffect none refuses the drop", () => {
  const source = element({ draggable_: true });
  const target = element();
  Object.assign(source, { elementFromPoint: () => target });
  target.on.dragover = (event) => {
    (event as unknown as { dataTransfer: FakeDataTransfer }).dataTransfer.dropEffect = "none";
    return false;
  };
  const held = press(as_element(source))!;
  move_to(held, { x: 50, y: 5 });
  release(held);
  assert.deepEqual(target.log, ["dragenter", "dragover", "dragleave"]);
  assert.equal(held.data!.dropEffect, "none");
});

test("a drop the page does not cancel ends with dropEffect none", () => {
  const source = element({ draggable_: true });
  const target = element();
  Object.assign(source, { elementFromPoint: () => target });
  target.on.dragover = () => false;
  const held = press(as_element(source))!;
  move_to(held, { x: 50, y: 5 });
  assert.equal(held.data!.dropEffect, "move");
  release(held);
  assert.equal(held.data!.dropEffect, "none");
});

test("a range with step any moves by a hundredth of its span instead of throwing", () => {
  const input = element({ localName: "input", type: "range", value: "50", max: "200", min: "0" });
  Object.assign(input, {
    stepUp: () => {
      throw new Error("step any");
    },
  });
  const held = press(as_element(input))!;
  nudge(held, "right");
  assert.equal(input.value, "52");
  nudge(held, "left");
  assert.equal(input.value, "50");
});

test("a new drag starts with an uninitialized effectAllowed, as a real one does", () => {
  assert.equal(press(as_element(element({ draggable_: true })))!.data!.effectAllowed, "uninitialized");
});

test("a picture that turns dragging off inside a draggable card leaves the card as the source", () => {
  const card = element({ draggable_: true });
  const picture = element({ localName: "img", draggable_attribute: "false", parent: card });
  const route = route_of(as_element(picture));
  assert.equal(route.route, "html5");
  assert.equal(route.source, card as unknown);
});

test("a link whose press the page cancels keeps the pointer route, as in a browser", () => {
  const link = element({ localName: "a" });
  link.on.mousedown = () => false;
  const held = press(as_element(link))!;
  assert.equal(held.route, "pointer");
  assert.deepEqual(link.log, ["pointerdown", "mousedown"]);
  const picture = element({ localName: "img" });
  picture.on.pointerdown = () => false;
  assert.equal(press(as_element(picture))!.route, "pointer");
});

test("a range with step any and max 0 steps by a hundredth of its negative span", () => {
  const input = element({ localName: "input", type: "range", value: "-50", max: "0", min: "-100" });
  Object.assign(input, {
    stepUp: () => {
      throw new Error("step any");
    },
  });
  nudge(press(as_element(input))!, "right");
  assert.equal(input.value, "-49");
});

test("abort on the pointer route releases where the pointer is and sends no move back", () => {
  const source = element();
  const held = press(as_element(source))!;
  nudge(held, "right");
  source.log.length = 0;
  abort(held);
  assert.deepEqual(source.log, ["pointerup", "mouseup"]);
  assert.equal(held.at.x, held.start.x + 24);
});

test("the press lands on the thumb: a role slider child, else aria-valuenow along the box, else the middle", () => {
  const plain = element();
  assert.deepEqual(press_point(as_element(plain)), { x: 50, y: 10 });
  const valued = element({ attrs: { "aria-valuenow": "25", "aria-valuemin": "0", "aria-valuemax": "100" } });
  assert.deepEqual(press_point(as_element(valued)), { x: 25, y: 10 });
  const vertical = element({ attrs: { role: "slider", "aria-orientation": "vertical", "aria-valuenow": "25" } });
  assert.deepEqual(press_point(as_element(vertical)), { x: 50, y: 15 });
  const scrollbar = element({ attrs: { role: "scrollbar", "aria-valuenow": "25" } });
  assert.deepEqual(press_point(as_element(scrollbar)), { x: 50, y: 5 });
  const at_max = element({ attrs: { "aria-valuenow": "100" } });
  assert.deepEqual(press_point(as_element(at_max)), { x: 99, y: 10 });
  const vertical_min = element({ attrs: { role: "slider", "aria-orientation": "vertical", "aria-valuenow": "0" } });
  assert.deepEqual(press_point(as_element(vertical_min)), { x: 50, y: 19 });
  const thumb = element({ getBoundingClientRect: () => ({ left: 60, top: 0, width: 10, height: 20 }) });
  const track = element({ querySelector: () => thumb, attrs: { "aria-valuenow": "0" } });
  assert.deepEqual(press_point(as_element(track)), { x: 65, y: 10 });
});

test("the step keys halve and double the move within limits, and leave a range input alone", () => {
  const held = press(as_element(element()))!;
  assert.equal(scale_step(held, 0.5), 12);
  const from = held.at.x;
  nudge(held, "right");
  assert.equal(held.at.x, from + 12);
  for (let count = 0; count < 10; count++) scale_step(held, 0.5);
  assert.equal(held.step, 3);
  for (let count = 0; count < 10; count++) scale_step(held, 2);
  assert.equal(held.step, 192);
  const input = element({ localName: "input", type: "range", value: "0" });
  assert.equal(scale_step(press(as_element(input))!, 2), undefined);
});

test("a fling on a link or picture forces the pointer route and sends no dragstart", async () => {
  const slide = element({ localName: "a" });
  const { held, to, pause_ms } = start_fling(as_element(slide), "right");
  assert.equal(held.route, "pointer");
  await drive(held, to, FLING_STEPS, pause_ms);
  assert.equal(slide.log.includes("dragstart"), false);
  assert.deepEqual([slide.log[0], slide.log.at(-1)], ["pointerdown", "mouseup"]);
});

test("the key names the way the view moves: the stroke runs from +30% to -30% around the middle, inside the box", () => {
  const slide = element();
  const right = start_fling(as_element(slide), "right");
  assert.deepEqual([right.held.start, right.to], [{ x: 80, y: 10 }, { x: 20, y: 10 }]);
  const left = start_fling(as_element(slide), "left");
  assert.deepEqual([left.held.start, left.to], [{ x: 20, y: 10 }, { x: 80, y: 10 }]);
  const down = start_fling(as_element(slide), "down");
  assert.deepEqual([down.held.start, down.to], [{ x: 50, y: 16 }, { x: 50, y: 4 }]);
});

test("the press goes to the element under the point when the picked box holds it, else to the box", () => {
  const track = element();
  const box = element({ elementFromPoint: () => track, contains: (other: unknown) => other === track });
  box.ownerDocument = box;
  start_fling(as_element(box), "right");
  assert.deepEqual([track.log, box.log], [["pointerdown", "mousedown"], []]);
  const outside = element();
  const covered = element({ elementFromPoint: () => outside, contains: () => false });
  covered.ownerDocument = covered;
  start_fling(as_element(covered), "right");
  assert.deepEqual([outside.log, covered.log], [[], ["pointerdown", "mousedown"]]);
});

test("a fling is six moves and one release", async () => {
  const slide = element();
  const { held, to, pause_ms } = start_fling(as_element(slide), "right");
  await drive(held, to, FLING_STEPS, pause_ms);
  assert.equal(slide.log.filter((type) => type === "pointermove").length, 6);
  assert.equal(slide.log.filter((type) => type === "pointerup").length, 1);
});

test("an abort in the middle of a fling releases once and the fling sends nothing more", async () => {
  const slide = element();
  const { held, to, pause_ms } = start_fling(as_element(slide), "left");
  const flinging = drive(held, to, FLING_STEPS, pause_ms);
  abort(held);
  await flinging;
  assert.equal(slide.log.filter((type) => type === "pointerup").length, 1);
  assert.equal(slide.log.filter((type) => type === "pointermove").length, 0);
});

test("a second fling after an abort presses again and never leaves the first pressed", async () => {
  const slide = element();
  const first = start_fling(as_element(slide), "right");
  const first_flight = drive(first.held, first.to, FLING_STEPS, first.pause_ms);
  abort(first.held);
  const second = start_fling(as_element(slide), "right");
  await Promise.all([first_flight, drive(second.held, second.to, FLING_STEPS, second.pause_ms)]);
  const downs = slide.log.filter((type) => type === "pointerdown").length;
  assert.equal(downs, 2);
  assert.equal(slide.log.filter((type) => type === "pointerup").length, 2);
});

test("a scroll-snap box scrolls by one view and gets no pointer events, and a box with no room is skipped", () => {
  const scrolls: unknown[] = [];
  const snap = element({ clientWidth: 300, scrollWidth: 900, clientHeight: 100, scrollHeight: 100, scrollBy: (init: unknown) => scrolls.push(init) });
  const slide = element({ parent: snap, parentElement: snap });
  const styles = new Map<unknown, string>([[snap, "x mandatory"]]);
  (globalThis as Record<string, unknown>).getComputedStyle = (target: unknown) => ({ scrollSnapType: styles.get(target) ?? "none" });
  try {
    assert.equal(snap_scroll(as_element(slide), "right"), true);
    assert.equal(snap_scroll(as_element(slide), "left"), true);
    assert.deepEqual(scrolls, [{ left: 300, top: 0, behavior: "smooth" }, { left: -300, top: 0, behavior: "smooth" }]);
    assert.equal(snap_scroll(as_element(slide), "down"), false);
    assert.deepEqual([slide.log, snap.log], [[], []]);
  } finally {
    delete (globalThis as Record<string, unknown>).getComputedStyle;
  }
});

test("the pause grows with the stroke, so the speed stays near 2 px per ms on any width", () => {
  const speed_on = (width: number) => {
    const slide = element({ getBoundingClientRect: () => ({ left: 0, top: 0, width, height: 20 }) });
    const { held, to, pause_ms } = start_fling(as_element(slide), "right");
    return Math.abs(to.x - held.start.x) / FLING_STEPS / pause_ms;
  };
  assert.ok(speed_on(600) <= 2);
  assert.ok(Math.abs(speed_on(1200) - 2) < 0.01);
  assert.ok(Math.abs(speed_on(1400) - 2) < 0.01);
  assert.ok(speed_on(200) < 2);
});
