import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeRefusal } from "../src/shared/command.ts";
import { send_key } from "../src/content/site_actions/send_key.ts";

type Sent = { type: string; init: KeyboardEventInit };

function fake_page(selectors: Record<string, string>, focused: string | null) {
  const log: { element: string; event: Sent }[] = [];
  const element = (name: string) => ({ dispatchEvent: (event: Event) => (log.push({ element: name, event: event as unknown as Sent }), true) }) as unknown as EventTarget;
  const doc = { querySelector: (selector: string) => (selector in selectors ? element(selectors[selector]!) : null), activeElement: focused === null ? null : element(focused) };
  const make_event = (type: string, init: KeyboardEventInit) => ({ type, init }) as unknown as Event;
  return { doc, log, make_event };
}

test("send_key sends a keydown then a keyup with the key and key code to the selected element", () => {
  const { doc, log, make_event } = fake_page({ "#editor": "editor" }, "other");
  send_key(doc, { key: "ArrowDown", key_code: 40, target: "#editor" }, make_event);
  assert.deepEqual(
    log.map((entry) => [entry.element, entry.event.type, entry.event.init.key, entry.event.init.keyCode, entry.event.init.bubbles, entry.event.init.cancelable]),
    [["editor", "keydown", "ArrowDown", 40, true, true], ["editor", "keyup", "ArrowDown", 40, true, true]],
  );
});

test("send_key without a target uses the focused element", () => {
  const { doc, log, make_event } = fake_page({}, "focused");
  send_key(doc, { key: "ArrowLeft", key_code: 37 }, make_event);
  assert.deepEqual(log.map((entry) => entry.element), ["focused", "focused"]);
});

test("send_key refuses a selector that matches nothing and a missing focus", () => {
  const page = fake_page({}, null);
  assert.throws(() => send_key(page.doc, { key: "a", key_code: 65, target: "#gone" }, page.make_event), RuntimeRefusal);
  assert.throws(() => send_key(page.doc, { key: "a", key_code: 65 }, page.make_event), RuntimeRefusal);
  assert.equal(page.log.length, 0);
});
