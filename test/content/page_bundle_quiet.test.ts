import assert from "node:assert/strict";
import { test } from "node:test";
import { LEAVE_QUIET_MS } from "../../src/content/page/leave_watch.ts";

// The `page` bundle as it starts in a top frame, with the host, the background and the Navigation API faked.
const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
const listeners: ((message: { type: string }) => unknown)[] = [];
const sent: { type: string }[] = [];
const state = { now: 50_000, y: 0 };
const navigation = new EventTarget();
const box = {
  scrollLeft: 0,
  get scrollTop() {
    return state.y;
  },
  scrollTo: ({ top }: { top: number }) => void (state.y = top),
};
const page = {
  location: { href: "https://app.test/doc" },
  document: { hidden: false },
  performance: { now: () => state.now },
  navigation,
  addEventListener: () => undefined,
  top: undefined as unknown,
  desertfox_host: {
    register_handler_: (id: string, handler: (args: Record<string, unknown>) => Promise<unknown>) => void handlers.set(id, handler),
    scroll_box_: () => box,
  },
};
page.top = page;
Object.assign(globalThis, {
  window: page,
  location: page.location,
  browser: {
    runtime: {
      // A step on the same page answers the place to scroll to.
      sendMessage: async (message: { type: string }) => (sent.push(message), message.type === "jump_step" ? { ok: true, x: 0, y: 3000 } : { ok: true }),
      onMessage: { addListener: (listener: (message: { type: string }) => unknown) => void listeners.push(listener) },
    },
  },
});
await import("../../src/content/page/main.ts");

// The page's own script changes the address as the step's scroll reaches another section.
const section_push = (section: string) => {
  const url = `https://app.test/doc?section=${section}`;
  navigation.dispatchEvent(Object.assign(new Event("navigate"), { navigationType: "push", hashChange: false, destination: { url, sameDocument: true } }));
  page.location.href = url;
  navigation.dispatchEvent(new Event("currententrychange"));
};
const pushes = () => sent.filter((message) => message.type === "jump_push");

test("a step's scroll starts the quiet window, so the address change it sets off records nothing, and a change after the window records", async () => {
  await handlers.get("page.jump")!({ direction: "older", steps: 1 });
  assert.equal(state.y, 3000);
  state.now += LEAVE_QUIET_MS - 1;
  section_push("2");
  assert.deepEqual(pushes(), []);
  state.now += LEAVE_QUIET_MS;
  section_push("3");
  assert.equal(pushes().length, 1);
});

test("the router's offset read starts the quiet window too", async () => {
  state.now += 10 * LEAVE_QUIET_MS;
  const before = pushes().length;
  await listeners[0]!({ type: "get_jump_offset" });
  section_push("4");
  assert.equal(pushes().length, before);
});
