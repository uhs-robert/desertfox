import assert from "node:assert/strict";
import { test } from "node:test";

// The grab bundle reads `window` when it loads and registers its handlers on the host it finds there.
class FakeEvent {
  type: string;
  clientX = 0;
  constructor(type: string, init: Record<string, unknown> = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}
Object.assign(globalThis, { Event: FakeEvent, MouseEvent: FakeEvent, PointerEvent: FakeEvent, DragEvent: FakeEvent, getComputedStyle: () => ({ scrollSnapType: "none" }) });

type Handler = (args: Record<string, unknown>) => unknown;
const handlers = new Map<string, Handler>();
let exit_sink: () => void = () => {};
const host = {
  register_handler_: (name: string, handler: Handler) => handlers.set(name, handler),
  register_sink_: (_mode: string, sink: { exit: () => void }) => void (exit_sink = sink.exit),
  set_mode_: () => {},
  show_toast_: () => {},
  escape_: () => exit_sink(),
};
const page = { desertfox_host: host } as Record<string, unknown>;
Object.assign(globalThis, { window: page });
await import("../../src/content/grab/main.ts");

// One carousel box that logs each pointer event with where it landed and how many presses are down at once.
function carousel() {
  const log: { type: string; x: number; down_now: number; at: number }[] = [];
  let down_now = 0;
  const box: Record<string, unknown> = {
    localName: "div",
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 100 }),
    contains: () => true,
    dispatchEvent(event: FakeEvent) {
      if (event.type === "pointerdown") down_now++;
      if (event.type === "pointerup") down_now--;
      if (event.type.startsWith("pointer")) log.push({ type: event.type, x: event.clientX, down_now, at: Date.now() });
      return true;
    },
  };
  box.ownerDocument = { elementFromPoint: () => box, body: box };
  return { box, log, count: (type: string) => log.filter((entry) => entry.type === type).length };
}

const start_swipe = async (box: unknown) => {
  page.desertfox_pick_target = box;
  await handlers.get("grab.mode")!({ mode: "grab_swipe" });
};
const key = (direction: string) => handlers.get("grab.move")!({ direction });
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

test("two fast l presses run two flings one after the other, never two presses at once", async () => {
  const { box, log, count } = carousel();
  await start_swipe(box);
  await Promise.all([key("right"), key("right")]);
  assert.deepEqual([count("pointerdown"), count("pointerup")], [2, 2]);
  assert.ok(log.every((entry) => entry.down_now <= 1));
  // The second fling waits for the library to settle after the first release.
  const first_up = log.find((entry) => entry.type === "pointerup")!;
  const second_down = log.filter((entry) => entry.type === "pointerdown")[1]!;
  assert.ok(second_down.at - first_up.at >= 340, `the gap was ${second_down.at - first_up.at} ms`);
  exit_sink();
});

test("mixed keys run in the order they came", async () => {
  const { box, log } = carousel();
  await start_swipe(box);
  await Promise.all([key("right"), key("left"), key("right")]);
  // The press of a fling starts on the side the key names: right at 240, left at 60.
  assert.deepEqual(log.filter((entry) => entry.type === "pointerdown").map((entry) => entry.x), [240, 60, 240]);
  exit_sink();
});

test("Escape in the middle of the queue releases the press and starts no queued fling", async () => {
  const { box, count } = carousel();
  await start_swipe(box);
  const keys = Promise.all([key("right"), key("right"), key("right")]);
  await wait(50);
  exit_sink();
  await keys;
  await wait(400);
  assert.deepEqual([count("pointerdown"), count("pointerup")], [1, 1]);
  // A new swipe works after the exit and is not held up by the dropped queue.
  await start_swipe(box);
  await key("left");
  assert.deepEqual([count("pointerdown"), count("pointerup")], [2, 2]);
  exit_sink();
});

test("a key past the queue cap is dropped", async () => {
  const { box, count } = carousel();
  await start_swipe(box);
  await Promise.all(Array.from({ length: 12 }, () => key("right")));
  // The cap counts the flings that have not started, and none has when the keys arrive together.
  assert.equal(count("pointerdown"), 4);
  assert.equal(count("pointerup"), 4);
  exit_sink();
});
