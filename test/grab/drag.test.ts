import assert from "node:assert/strict";
import { test } from "node:test";
import { abort, drive, move_to, nudge, press, release, route_of } from "../../src/content/grab/drag.ts";

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
}
Object.assign(globalThis, { Event: FakeEvent, MouseEvent: FakeEvent, PointerEvent: FakeEvent, DragEvent: FakeEvent, DataTransfer: FakeDataTransfer });

type Fake = { localName: string; type?: string; value?: string; draggable_: boolean; log: string[]; on: Record<string, (event: FakeEvent) => boolean | void> } & Record<string, unknown>;

// One element that is also its own document: elementFromPoint answers it, and every event lands in its log.
function element(extra: Partial<Fake> = {}): Fake {
  const self: Fake = {
    localName: "div",
    draggable_: false,
    log: [],
    on: {},
    isConnected: true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 20 }),
    closest: () => (self.draggable_ ? self : null),
    dispatchEvent(event: FakeEvent) {
      self.log.push(event.type);
      const result = self.on[event.type]?.(event);
      return result !== false;
    },
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
  assert.deepEqual(source.log, ["pointerdown", "mousedown", "pointermove", "mousemove", "pointermove", "mousemove", "pointerup", "mouseup"]);
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
