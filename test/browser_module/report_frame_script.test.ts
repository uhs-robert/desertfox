import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { create_firefox } from "./fake_firefox.ts";

const REPORT = "desertfox-browser-module:report";
const BLUR = "desertfox-browser-module:blur";

// The core's report frame script as Firefox runs it in one tab: `content` is the shown top document with one search field, and the clock is the test's.
function report_frame() {
  const firefox = create_firefox();
  firefox.start_extension();
  firefox.make_window().load();
  const url = firefox.frame_scripts.find((each) => decodeURIComponent(each).includes(REPORT));
  assert.ok(url, "the core loads its report frame script");
  const events = new Map<string, ((event: unknown) => void)[]>();
  const messages = new Map<string, ((message: { data: unknown }) => void)[]>();
  const reports: Record<string, unknown>[] = [];
  const clock = { now: 1_000_000 };
  const field = { localName: "input", type: "text", blurred: 0, blur: () => field.blurred++ };
  const body = { localName: "body" };
  const user_activation = { hasBeenActive: false };
  const document = { activeElement: body as unknown, hidden: false, designMode: "off", documentElement: {} };
  const content = { document, navigator: { userActivation: user_activation }, windowGlobalChild: { innerWindowId: 7 } };
  const context = vm.createContext({
    Components: {
      classes: { "@mozilla.org/eventlistenerservice;1": { getService: () => ({ getListenerInfoFor: () => [] }) } },
      interfaces: { nsIEventListenerService: {} },
      utils: {},
    },
    ChromeUtils: { importESModule: () => ({ setTimeout: () => 0 }) },
    Services: { prefs: { getBoolPref: () => true } },
    Date: { now: () => clock.now },
    content,
    sendAsyncMessage: (name: string, data: Record<string, unknown>) => name === REPORT && reports.push(JSON.parse(JSON.stringify(data))),
    addEventListener: (type: string, listener: (event: unknown) => void) => events.set(type, [...(events.get(type) ?? []), listener]),
    addMessageListener: (name: string, listener: (message: { data: unknown }) => void) => messages.set(name, [...(messages.get(name) ?? []), listener]),
  });
  vm.runInContext(decodeURIComponent(url.slice(url.indexOf(",") + 1)), context);
  const fire = (type: string, event: Record<string, unknown> = {}) => {
    for (const listener of events.get(type) ?? []) listener({ target: document, isTrusted: true, repeat: false, ...event });
  };
  const show = () => ((document.hidden = false), fire("visibilitychange"));
  const hide = () => ((document.hidden = true), fire("visibilitychange"));
  const focus_field = () => ((document.activeElement = field), fire("focusin"));
  const last_load_focus = () => reports.at(-1)?.load_focus;
  const last_report = () => reports.at(-1) ?? {};
  // The core answers a marked report with a blur for the same document.
  const core_blurs = (data: Record<string, unknown> = { inner: 7 }) => {
    for (const listener of messages.get(BLUR) ?? []) listener({ data });
    return field.blurred;
  };
  return { document, last_report, clock, field, user_activation, fire, show, hide, focus_field, last_load_focus, core_blurs };
}

test("a tab shown again marks a field that already holds the focus, even on a page used before", () => {
  const frame = report_frame();
  frame.user_activation.hasBeenActive = true;
  frame.focus_field();
  assert.equal(frame.last_load_focus(), false, "with no window open, the focus is the user's");
  frame.hide();
  frame.show();
  assert.equal(frame.last_load_focus(), true);
  assert.equal(frame.core_blurs(), 1);
});

test("a page focus inside the switch window is marked, and one after it is not", () => {
  const frame = report_frame();
  frame.user_activation.hasBeenActive = true;
  frame.show();
  frame.clock.now += 900;
  frame.focus_field();
  assert.equal(frame.last_load_focus(), true);
  frame.clock.now += 200;
  frame.focus_field();
  assert.equal(frame.last_load_focus(), false);
  assert.equal(frame.core_blurs(), 0, "a blur that comes after the window is refused");
});

test("a key that is no repeat and no modifier, or a mouse press, ends the switch window", () => {
  for (const [what, type, event] of [
    ["a key", "keydown", { key: "j" }],
    ["a mouse press", "mousedown", {}],
  ] as const) {
    const frame = report_frame();
    frame.show();
    frame.fire(type, event);
    frame.focus_field();
    assert.equal(frame.last_load_focus(), false, what);
    assert.equal(frame.core_blurs(), 0, what);
  }
});

test("a held key's repeats, a modifier alone and an untrusted key keep the switch window open", () => {
  for (const [what, event] of [
    ["a repeat", { key: "J", repeat: true }],
    ["Shift alone", { key: "Shift" }],
    ["an untrusted key", { key: "j", isTrusted: false }],
  ] as const) {
    const frame = report_frame();
    frame.show();
    frame.fire("keydown", event);
    frame.focus_field();
    assert.equal(frame.last_load_focus(), true, what);
    assert.equal(frame.core_blurs(), 1, what);
  }
});

test("the tab going hidden ends the switch window, so a blur that arrives late is refused", () => {
  const frame = report_frame();
  frame.show();
  frame.focus_field();
  assert.equal(frame.last_load_focus(), true);
  frame.hide();
  assert.equal(frame.core_blurs(), 0);
});

test("a load window still refuses once the page has had a key or click", () => {
  const frame = report_frame();
  frame.fire("DOMContentLoaded");
  frame.user_activation.hasBeenActive = true;
  frame.focus_field();
  assert.equal(frame.last_load_focus(), false);
});

test("a blur marked escape works outside any window and after a key, but only for the same document and a field", () => {
  const frame = report_frame();
  frame.user_activation.hasBeenActive = true;
  frame.clock.now += 60_000;
  frame.focus_field();
  assert.equal(frame.core_blurs({ inner: 7 }), 0, "an unmarked blur is refused here");
  assert.equal(frame.core_blurs({ inner: 8, escape: true }), 0, "another document");
  assert.equal(frame.core_blurs({ inner: 7, escape: true }), 1);
  frame.document.activeElement = { localName: "button", blur: () => assert.fail("a button was blurred") };
  frame.core_blurs({ inner: 7, escape: true });
});

test("a blur marked escape leaves a design mode document alone", () => {
  const frame = report_frame();
  frame.document.designMode = "on";
  frame.document.activeElement = { localName: "body", blur: () => assert.fail("body was blurred") };
  frame.core_blurs({ inner: 7, escape: true });
});

test("the report says text_field for a real field and not for design mode, while field covers both", () => {
  const frame = report_frame();
  frame.focus_field();
  assert.deepEqual([frame.last_report().field, frame.last_report().text_field], [true, true]);
  const editable = report_frame();
  editable.document.designMode = "on";
  editable.fire("focusin");
  assert.deepEqual([editable.last_report().field, editable.last_report().text_field], [true, false]);
});
