import assert from "node:assert/strict";
import { test } from "node:test";
import { watch_user_left } from "../../src/content/next_page/user_left.ts";
import { fake_events } from "../support/fake_events.ts";

test("a hidden tab, a key press, the wheel and a pointer press each mark the user as left", () => {
  const cases: [string, (events: ReturnType<typeof fake_events>) => void][] = [
    ["hidden", (events) => events.hide()],
    ["key", (events) => events.press()],
    ["wheel", (events) => events.fire("win", "wheel")],
    ["pointer", (events) => events.fire("win", "pointerdown")],
  ];
  for (const [name, signal] of cases) {
    const events = fake_events();
    const user = watch_user_left(events.doc, events.win, events.pressed_keys);
    assert.equal(user.left_(), false, name);
    signal(events);
    assert.equal(user.left_(), true, name);
  }
});

test("a scroll, a blur, a shown tab and untrusted input do not", () => {
  const events = fake_events();
  const user = watch_user_left(events.doc, events.win, events.pressed_keys);
  events.fire("win", "scroll");
  events.fire("win", "blur");
  events.fire("win", "wheel", {}, false);
  events.show();
  assert.equal(user.left_(), false);
});

test("a tab that is hidden when asked counts as left", () => {
  const events = fake_events();
  const user = watch_user_left(events.doc, events.win, events.pressed_keys);
  events.hide();
  events.show();
  events.hide();
  assert.equal(user.left_(), true);
});

test("stop removes every listener", () => {
  const events = fake_events();
  const user = watch_user_left(events.doc, events.win, events.pressed_keys);
  assert.equal(events.listeners(), 3);
  user.stop_();
  assert.equal(events.listeners(), 0);
});

test("a key pressed before the watch started does not count", () => {
  const events = fake_events();
  events.press();
  const user = watch_user_left(events.doc, events.win, events.pressed_keys);
  assert.equal(user.left_(), false);
});
