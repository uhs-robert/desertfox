import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { RuntimeRefusal } from "../src/shared/command.ts";
import "../src/background/command_modules.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { args_for_count } from "../src/content/invocation_args.ts";
import { SEND_KEY_MAX_TIMES } from "../src/shared/send_key_limit.ts";
import { check_args } from "../src/shared/registry/check_args.ts";
import { KEY_PAIR_GAP_MS, queued_in_page, send_key, send_key_queued } from "../src/content/site_actions/send_key.ts";

type Sent = { type: string; init: KeyboardEventInit };

function fake_page(selectors: Record<string, string>, focused: string | null) {
  const log: { element: string; event: Sent }[] = [];
  const element = (name: string) => ({ dispatchEvent: (event: Event) => (log.push({ element: name, event: event as unknown as Sent }), true) }) as unknown as EventTarget;
  const doc = { querySelector: (selector: string) => (selector === "#bad[" ? (() => { throw new SyntaxError("bad selector"); })() : selector in selectors ? element(selectors[selector]!) : null), activeElement: focused === null ? null : element(focused) };
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

test("send_key focuses the target before the keydown only when focus is on", () => {
  const order: string[] = [];
  const target = { focus: () => order.push("focus"), dispatchEvent: (event: Event) => (order.push((event as unknown as Sent).type), true) } as unknown as EventTarget;
  const doc = { querySelector: () => target, activeElement: null };
  const make_event = (type: string, init: KeyboardEventInit) => ({ type, init }) as unknown as Event;
  send_key(doc, { key: "ArrowDown", key_code: 40, target: "#map", focus: true }, make_event);
  send_key(doc, { key: "ArrowDown", key_code: 40, target: "#map" }, make_event);
  assert.deepEqual(order, ["focus", "keydown", "keyup", "keydown", "keyup"]);
  assert.equal(check_args(registry.get("page.send_key")!, { key: "ArrowDown", key_code: 40, focus: "yes" }, {}).ok, false);
});

test("send_key sets the modifier flags that are on and none otherwise", () => {
  const { doc, log, make_event } = fake_page({}, "focused");
  send_key(doc, { key: "Home", key_code: 36, ctrl: true, meta: true }, make_event);
  send_key(doc, { key: "a", key_code: 65 }, make_event);
  const flags = (index: number) => [log[index]!.event.init.ctrlKey, log[index]!.event.init.shiftKey, log[index]!.event.init.altKey, log[index]!.event.init.metaKey];
  assert.deepEqual([flags(0), flags(1), flags(2), flags(3)], [[true, false, false, true], [true, false, false, true], [false, false, false, false], [false, false, false, false]]);
});

test("send_key sends a keypress between keydown and keyup only when keypress is on", () => {
  const { doc, log, make_event } = fake_page({}, "focused");
  send_key(doc, { key: "x", key_code: 88, keypress: true }, make_event);
  send_key(doc, { key: "x", key_code: 88 }, make_event);
  assert.deepEqual(log.map((entry) => entry.event.type), ["keydown", "keypress", "keyup", "keydown", "keyup"]);
});

test("send_key skips the keypress when the keydown was cancelled, and still sends the keyup", () => {
  const sent: string[] = [];
  const target = { dispatchEvent: (event: Event) => (sent.push((event as unknown as Sent).type), (event as unknown as Sent).type !== "keydown") } as unknown as EventTarget;
  send_key({ querySelector: () => null, activeElement: target }, { key: "x", key_code: 88, keypress: true }, (type, init) => ({ type, init }) as unknown as Event);
  assert.deepEqual(sent, ["keydown", "keyup"]);
});

test("a keypress for a one-character key carries its character code, a named key does not", () => {
  const { doc, log, make_event } = fake_page({}, "focused");
  send_key(doc, { key: "x", key_code: 88, keypress: true }, make_event);
  send_key(doc, { key: "Enter", key_code: 13, keypress: true }, make_event);
  const presses = log.filter((entry) => entry.event.type === "keypress").map((entry) => [entry.event.init.charCode, entry.event.init.which]);
  assert.deepEqual(presses, [[120, 120], [undefined, undefined]]);
});

test("the modifier and keypress params default to off and refuse a non-boolean", () => {
  const command = registry.get("page.send_key")!;
  const checked = check_args(command, { key: "a", key_code: 65 }, {});
  assert.ok(checked.ok);
  assert.deepEqual([checked.args.ctrl, checked.args.shift, checked.args.alt, checked.args.meta, checked.args.keypress], [false, false, false, false, false]);
  assert.ok(check_args(command, { key: "a", key_code: 65, ctrl: true, keypress: true }, {}).ok);
  assert.equal(check_args(command, { key: "a", key_code: 65, ctrl: "yes" }, {}).ok, false);
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

test("send_key refuses a selector the page cannot parse", () => {
  const page = fake_page({}, "focused");
  assert.throws(() => send_key(page.doc, { key: "a", key_code: 65, target: "#bad[" }, page.make_event), RuntimeRefusal);
});

test("send_key takes the focused element for the args the validator fills in when target is omitted", () => {
  const checked = check_args(registry.get("page.send_key")!, { key: "ArrowLeft", key_code: 37 }, {});
  assert.ok(checked.ok);
  const page = fake_page({}, "focused");
  send_key(page.doc, checked.args as never, page.make_event);
  assert.deepEqual(page.log.map((entry) => entry.element), ["focused", "focused"]);
});

test("queued sends keep the gap between pairs and the order of calls, a count and two quick calls alike", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const page = fake_page({ "#e": "editor" }, null);
    const sent_at: { key: string | undefined; time: number }[] = [];
    const make_event = (type: string, init: KeyboardEventInit) => (type === "keydown" && sent_at.push({ key: init.key, time: Date.now() }), page.make_event(type, init));
    const call = (key: string) => send_key_queued(page.doc, { key, key_code: 1, target: "#e" }, make_event);
    // One call with times 3 and a second call that follows at once.
    const done = Promise.all([send_key_queued(page.doc, { key: "a", key_code: 1, target: "#e", times: 3 }, make_event), call("b")]);
    for (let step = 0; step < 20; step++) {
      mock.timers.tick(KEY_PAIR_GAP_MS / 2);
      await new Promise((resolve) => setImmediate(resolve));
    }
    await done;
    assert.deepEqual(sent_at.map((sent) => sent.key), ["a", "a", "a", "b"]);
    for (let index = 1; index < sent_at.length; index++) assert.ok(sent_at[index]!.time - sent_at[index - 1]!.time >= KEY_PAIR_GAP_MS, `pair ${index} came too soon`);
    assert.equal(page.log.length, 8);
  } finally {
    mock.timers.reset();
  }
});

test("a refused queued call rejects alone and the next call still sends", async () => {
  const page = fake_page({}, "focused");
  await assert.rejects(send_key_queued(page.doc, { key: "a", key_code: 1, target: "#gone" }, page.make_event), RuntimeRefusal);
  await send_key_queued(page.doc, { key: "a", key_code: 1 }, page.make_event);
  assert.equal(page.log.length, 2);
});

test("a backward clock jump does not stall the queue", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10_000_000 });
  try {
    const page = fake_page({ "#e": "editor" }, null);
    const call = () => send_key_queued(page.doc, { key: "a", key_code: 1, target: "#e" }, page.make_event);
    // The queue state is shared with earlier tests, so every call may wait one gap.
    const finish = async (pending: Promise<void>) => {
      await new Promise((resolve) => setImmediate(resolve));
      mock.timers.tick(KEY_PAIR_GAP_MS);
      await pending;
    };
    await finish(call());
    mock.timers.setTime(0);
    await finish(call());
    assert.equal(page.log.length, 4);
  } finally {
    mock.timers.reset();
  }
});

test("times accepts 99 and refuses 100 with a clear error", () => {
  const command = registry.get("page.send_key")!;
  assert.ok(check_args(command, { key: "a", key_code: 65, times: 99 }, {}).ok);
  const refused = check_args(command, { key: "a", key_code: 65, times: 100 }, {});
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? "" : refused.error, /times/);
});

test("a count over the limit is refused by the handler after args_for_count fills times", async () => {
  const checked = check_args(registry.get("page.send_key")!, { key: "a", key_code: 65 }, {});
  assert.ok(checked.ok);
  const page = fake_page({}, "focused");
  const [args] = args_for_count(checked.args as never, 9999, { param: "times" });
  await assert.rejects(send_key_queued(page.doc, args as never, page.make_event), /over the limit of 99 for page.send_key/);
  assert.equal(page.log.length, 0);
  assert.equal(SEND_KEY_MAX_TIMES, 99);
});

import { clipboard_action } from "../src/content/site_actions/clipboard.ts";

// A page whose `execCommand` fires its event only when `fires` is set, as a browser that runs the action does. `takes_focus` false is a target that cannot be focused. The listener is the document's capture listener, so `listeners` holds what is attached after the call.
function clipboard_page(fires: boolean, accepts = fires, takes_focus = true) {
  const calls: string[] = [];
  const listeners: Record<string, () => void> = {};
  const target = {} as EventTarget & { focus: () => void };
  const doc = {
    querySelector: (selector: string) => (selector === "#e" ? target : null),
    activeElement: null as EventTarget | null,
    addEventListener: (type: string, listener: () => void) => (listeners[type] = listener),
    removeEventListener: (type: string) => delete listeners[type],
    execCommand: (command: string) => (calls.push(command), fires && listeners[command]?.(), accepts),
  };
  target.focus = () => (calls.push("focus"), takes_focus && (doc.activeElement = target));
  return { doc, calls, listeners };
}

test("page.clipboard takes cut, copy and paste with an optional target and refuses anything else", () => {
  const command = registry.get("page.clipboard")!;
  for (const action of ["cut", "copy", "paste"]) assert.ok(check_args(command, { action, target: "#e" }, {}).ok);
  assert.ok(check_args(command, { action: "paste" }, {}).ok);
  assert.equal(check_args(command, { action: "undo" }, {}).ok, false);
  assert.equal(check_args(command, {}, {}).ok, false);
});

test("clipboard_action focuses the target, then runs the command, and skips the fallback when the event fired", async () => {
  const page = clipboard_page(true);
  let fell_back = false;
  await clipboard_action(page.doc, { action: "paste", target: "#e" }, async () => void (fell_back = true));
  assert.deepEqual(page.calls, ["focus", "paste"]);
  assert.equal(fell_back, false);
});

test("clipboard_action falls back to the clipboard API for a paste that fired no event, and refuses a cut that did", async () => {
  const page = clipboard_page(false);
  let fell_back = false;
  await clipboard_action(page.doc, { action: "paste", target: "#e" }, async () => void (fell_back = true));
  assert.equal(fell_back, true);
  await assert.rejects(clipboard_action(page.doc, { action: "cut", target: "#e" }, async () => undefined), RuntimeRefusal);
  await assert.rejects(clipboard_action(page.doc, { action: "copy", target: "#gone" }, async () => undefined), RuntimeRefusal);
});

test("clipboard_action counts a fired event as taken even when execCommand returns false, so a handled paste is not pasted twice", async () => {
  const page = clipboard_page(true, false);
  let fell_back = false;
  await clipboard_action(page.doc, { action: "paste", target: "#e" }, async () => void (fell_back = true));
  await clipboard_action(page.doc, { action: "cut", target: "#e" }, async () => undefined);
  assert.equal(fell_back, false);
  assert.deepEqual(page.listeners, {});
});

test("an execCommand that throws still removes the capture listener, so the user's next copy is not marked", async () => {
  const page = clipboard_page(true);
  page.doc.execCommand = () => {
    throw new Error("page bug");
  };
  await assert.rejects(clipboard_action(page.doc, { action: "copy", target: "#e" }, async () => undefined), /page bug/);
  assert.deepEqual(page.listeners, {});
});

test("clipboard_action refuses a target that did not take focus, without running the command", async () => {
  const page = clipboard_page(true, true, false);
  await assert.rejects(clipboard_action(page.doc, { action: "paste", target: "#e" }, async () => undefined), /did not take focus/);
  assert.deepEqual(page.calls, ["focus"]);
});

test("a clipboard action queued behind a count of key pairs runs after the last pair", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const order: string[] = [];
    const page = fake_page({ "#e": "editor" }, null);
    const make_event = (type: string, init: KeyboardEventInit) => (type === "keydown" && order.push("key"), page.make_event(type, init));
    const clip = clipboard_page(true);
    const execute = clip.doc.execCommand;
    clip.doc.execCommand = (command: string) => (order.push(command), execute(command));
    const done = Promise.all([send_key_queued(page.doc, { key: "l", key_code: 39, target: "#e", times: 2 }, make_event), queued_in_page(() => clipboard_action(clip.doc, { action: "cut", target: "#e" }, async () => undefined))]);
    for (let step = 0; step < 20; step++) {
      mock.timers.tick(KEY_PAIR_GAP_MS / 2);
      await new Promise((resolve) => setImmediate(resolve));
    }
    await done;
    assert.deepEqual(order, ["key", "key", "cut"]);
  } finally {
    mock.timers.reset();
  }
});
