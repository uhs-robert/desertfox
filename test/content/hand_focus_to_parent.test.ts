import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

// The hand-off of a hidden input frame, with a stub frame element, focus and clock.
class FakeHTMLElement {}
class FakeHTMLInputElement extends FakeHTMLElement {}
const DOCS_FRAME_BOX = { width: 625, height: 1 };
let frame_blurs = 0;
let now_ms = 10_000;
const frame = { box: DOCS_FRAME_BOX, getBoundingClientRect: () => frame.box, blur: () => void frame_blurs++ };
const body = Object.assign(new FakeHTMLElement(), { tagName: "BODY", isContentEditable: false });
const field = Object.assign(new FakeHTMLElement(), { tagName: "DIV", isContentEditable: true, id: "editor" });
const fake_window: { frameElement: typeof frame | null } = { frameElement: frame };
const fake_document = { activeElement: body as object, hasFocus: () => true };
Object.assign(globalThis, { HTMLElement: FakeHTMLElement, HTMLInputElement: FakeHTMLInputElement, window: fake_window, document: fake_document });
Date.now = () => now_ms;

const { hand_focus_to_parent } = await import("../../src/content/handlers/page.ts");
const { hand_focus_to_parent: hand_off } = await import("../../src/content/ui/hand_focus.ts");
const { is_editable_element } = await import("../../src/content/editable.ts");
const { page_mode } = await import("../../src/content/page_mode.ts");
const { mode_set } = await import("../../src/content/handlers/mode.ts");
const { bundles } = await import("../../src/content/bundles.ts");
const { create_bundle_host } = await import("../../src/content/bundle_host.ts");
// A caret mode stays pending, so the frame still reads as normal.
// The ui bundle loads after a tick, like an injection answers, and registers the handler as ui/main.ts does.
let ui_loads = 0;
let ui_calls = 0;
const load_ui = async () => {
  await Promise.resolve();
  ui_loads++;
  bundles.api.register_handler_("ui.hand_focus", (args) => (ui_calls++, hand_off(page_mode.get_mode_(), is_editable_element, args.keep_field as boolean)));
  return true;
};
// caret.js never loads here.
bundles.connect({ request_bundle_: (name) => (name === "ui" ? load_ui() : new Promise<boolean>(() => {})), on_idle_: () => {}, hold_first_: () => {}, set_mode_: page_mode.set_mode_, show_error_: () => {} });

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  // Insert mode clears the guard time, as it does between two real hand-offs.
  page_mode.set_mode_("insert");
  hand_focus_to_parent();
  await settled();
  page_mode.set_mode_("normal");
  await settled();
  frame_blurs = 0;
  frame.box = DOCS_FRAME_BOX;
  fake_window.frameElement = frame;
  fake_document.activeElement = body;
  fake_document.hasFocus = () => true;
});

test("a hidden frame in normal mode that holds the focus blurs its frame element", async () => {
  hand_focus_to_parent();
  await settled();
  assert.equal(frame_blurs, 1);
});

test("no hand-off in another mode, in a top frame, in a frame of usable size or without the focus", async () => {
  page_mode.set_mode_("insert");
  hand_focus_to_parent();
  await settled();
  page_mode.set_mode_("ignore");
  hand_focus_to_parent();
  await settled();
  page_mode.set_mode_("normal");
  fake_window.frameElement = null;
  hand_focus_to_parent();
  await settled();
  fake_window.frameElement = frame;
  frame.box = { width: 300, height: 200 };
  hand_focus_to_parent();
  await settled();
  frame.box = DOCS_FRAME_BOX;
  fake_document.hasFocus = () => false;
  hand_focus_to_parent();
  await settled();
  assert.equal(frame_blurs, 0);
  // None of these started the guard time.
  fake_document.hasFocus = () => true;
  hand_focus_to_parent();
  await settled();
  assert.equal(frame_blurs, 1);
});

test("a focused field blocks the hand-off unless the caller gives it up", async () => {
  fake_document.activeElement = field;
  hand_focus_to_parent();
  await settled();
  assert.equal(frame_blurs, 0);
  hand_focus_to_parent(false);
  await settled();
  assert.equal(frame_blurs, 1);
});

test("a frame that gains the focus again within the guard time keeps it, and hands off after it", async () => {
  hand_focus_to_parent();
  await settled();
  now_ms += 400;
  hand_focus_to_parent();
  await settled();
  assert.equal(frame_blurs, 1, "a page that fights for the focus got a second hand-off");
  now_ms += 200;
  hand_focus_to_parent();
  await settled();
  assert.equal(frame_blurs, 2);
});

test("insert mode between two hand-offs ends the guard time", async () => {
  hand_focus_to_parent();
  await settled();
  page_mode.set_mode_("insert");
  hand_focus_to_parent();
  await settled();
  page_mode.set_mode_("normal");
  hand_focus_to_parent();
  await settled();
  assert.equal(frame_blurs, 2);
});

test("mode.set hands off for normal mode only, so a caret mode that waits on its bundle keeps the focus and the field", async () => {
  fake_document.activeElement = field;
  void mode_set.run({ mode: "caret" }, false);
  await settled();
  assert.equal(page_mode.get_mode_(), "normal", "the caret mode did not stay pending, so the case proves nothing");
  assert.equal(frame_blurs, 0, "mode.set to caret blurred the hidden frame");
  void mode_set.run({ mode: "normal" }, false);
  await settled();
  assert.equal(frame_blurs, 1);
});

test("a top frame and a frame without the focus never reach the ui handler, and a focused child frame does", async () => {
  const before = ui_calls;
  fake_window.frameElement = null;
  hand_focus_to_parent();
  fake_window.frameElement = frame;
  fake_document.hasFocus = () => false;
  hand_focus_to_parent();
  await settled();
  assert.equal(ui_calls, before, "a frame that cannot hand off called ui");
  fake_document.hasFocus = () => true;
  hand_focus_to_parent();
  await settled();
  assert.equal(ui_calls, before + 1);
  assert.equal(ui_loads, 1, "ui loaded more than once");
});

test("a frame that has never loaded ui requests nothing for a top frame or an unfocused frame", async () => {
  const requested: string[] = [];
  bundles.connect({ request_bundle_: async (name) => (requested.push(name), true), on_idle_: () => {}, hold_first_: () => {}, set_mode_: () => {}, show_error_: () => {} });
  fake_window.frameElement = null;
  hand_focus_to_parent();
  fake_window.frameElement = frame;
  fake_document.hasFocus = () => false;
  hand_focus_to_parent();
  await settled();
  assert.deepEqual(requested, []);
});

test("the first hand-off waits on the load and reads the mode then, so a mode change during the load wins", async () => {
  const { create_bundle_host } = await import("../../src/content/bundle_host.ts");
  const host = create_bundle_host();
  let resolve_load: (loaded: boolean) => void = () => {};
  const pending = { promise: new Promise<boolean>((resolve) => (resolve_load = resolve)) };
  host.connect({ request_bundle_: () => pending.promise, on_idle_: () => {}, hold_first_: () => {}, set_mode_: () => {}, show_error_: () => {} });
  let mode: "normal" | "insert" = "normal";
  const call = host.run_command_("ui.hand_focus", "ui", { keep_field: true }, "", false);
  host.api.register_handler_("ui.hand_focus", (args) => hand_off(mode, is_editable_element, args.keep_field as boolean));
  await settled();
  assert.equal(frame_blurs, 0, "the hand-off ran before the bundle answered");
  mode = "insert";
  resolve_load(true);
  assert.deepEqual(await call, { ok: true });
  assert.equal(frame_blurs, 0, "a hand-off of a frame now in insert mode blurred it");
});
