import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOLBOX_CLOSED_MESSAGE } from "../../src/shared/inspect.ts";
import { hand_to_devtools } from "../../src/content/hints/inspect.ts";

function make_window(is_top = true) {
  const page: Record<string, unknown> = {};
  const win: { wrappedJSObject: Record<string, unknown>; top: unknown } = { wrappedJSObject: page, top: undefined };
  win.top = is_top ? win : {};
  return { win, page };
}

const element = { localName: "div" } as Element;

test("the element is on the page when the pick is sent", async () => {
  const { win, page } = make_window();
  let seen: unknown;
  const outcome = await hand_to_devtools(win, element, async () => ((seen = page.__desertfox_pick), { ok: true }), () => {}, () => {});
  assert.equal(seen, element);
  assert.deepEqual(outcome, { ok: true });
  // The devtools page deletes it after the select, so the content script leaves it.
  assert.equal(page.__desertfox_pick, element);
});

test("a pick that waits for the toolbox answers ok, shows the notice and keeps the property", async () => {
  const { win, page } = make_window();
  const notices: string[] = [];
  const outcome = await hand_to_devtools(win, element, async () => ({ ok: false, message: "press F12" }), () => {}, () => {});
  assert.deepEqual(outcome, { ok: false, message: "press F12" });
  assert.equal(page.__desertfox_pick, element);
});

test("a delivered pick shows no notice", async () => {
  const { win } = make_window();
  const notices: string[] = [];
  assert.deepEqual(await hand_to_devtools(win, element, async () => ({ ok: true }), () => {}, (message) => void notices.push(message)), { ok: true });
  assert.deepEqual(notices, []);
});

test("no answer from the background deletes the property", async () => {
  const { win, page } = make_window();
  const outcome = await hand_to_devtools(win, element, async () => undefined, () => {}, () => {});
  assert.equal(outcome.ok, false);
  assert.equal("__desertfox_pick" in page, false);
});

test("a failed send deletes the property", async () => {
  const { win, page } = make_window();
  const outcome = await hand_to_devtools(win, element, () => Promise.reject(new Error("gone")), () => {}, () => {});
  assert.equal(outcome.ok, false);
  assert.equal("__desertfox_pick" in page, false);
});

test("an unselected pick leaves the page after 60 s", async () => {
  const { win, page } = make_window();
  const timers: [() => void, number][] = [];
  await hand_to_devtools(win, element, async () => ({ ok: true, waiting: true }), (action, ms) => void timers.push([action, ms]), () => {});
  assert.equal(timers[0]![1], 60_000);
  timers[0]![0]();
  assert.equal("__desertfox_pick" in page, false);
});

test("the 60 s timer of an old pick leaves a newer pick alone", async () => {
  const { win, page } = make_window();
  const timers: (() => void)[] = [];
  const later = (action: () => void) => void timers.push(action);
  await hand_to_devtools(win, element, async () => ({ ok: true, waiting: true }), later, () => {});
  const newer = { localName: "p" } as Element;
  await hand_to_devtools(win, newer, async () => ({ ok: true, waiting: true }), later, () => {});
  timers[0]!();
  assert.equal(page.__desertfox_pick, newer);
});

test("a script in a frame refuses and sets nothing", async () => {
  const { win, page } = make_window(false);
  let sent = false;
  const outcome = await hand_to_devtools(win, element, async () => ((sent = true), { ok: true }), () => {}, () => {});
  assert.equal(outcome.ok, false);
  assert.equal(sent, false);
  assert.equal("__desertfox_pick" in page, false);
});
