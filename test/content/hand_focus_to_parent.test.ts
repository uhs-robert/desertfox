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
const { page_mode } = await import("../../src/content/page_mode.ts");
const { mode_set } = await import("../../src/content/handlers/mode.ts");
const { bundles } = await import("../../src/content/bundles.ts");
// caret.js never loads here, so a caret mode stays pending and the frame still reads as normal.
bundles.connect({ request_bundle_: () => new Promise<boolean>(() => {}), on_idle_: () => {}, hold_first_: () => {}, set_mode_: page_mode.set_mode_, show_error_: () => {} });

beforeEach(() => {
  // Insert mode clears the guard time, as it does between two real hand-offs.
  page_mode.set_mode_("insert");
  hand_focus_to_parent();
  page_mode.set_mode_("normal");
  frame_blurs = 0;
  frame.box = DOCS_FRAME_BOX;
  fake_window.frameElement = frame;
  fake_document.activeElement = body;
  fake_document.hasFocus = () => true;
});

test("a hidden frame in normal mode that holds the focus blurs its frame element", () => {
  hand_focus_to_parent();
  assert.equal(frame_blurs, 1);
});

test("no hand-off in another mode, in a top frame, in a frame of usable size or without the focus", () => {
  page_mode.set_mode_("insert");
  hand_focus_to_parent();
  page_mode.set_mode_("ignore");
  hand_focus_to_parent();
  page_mode.set_mode_("normal");
  fake_window.frameElement = null;
  hand_focus_to_parent();
  fake_window.frameElement = frame;
  frame.box = { width: 300, height: 200 };
  hand_focus_to_parent();
  frame.box = DOCS_FRAME_BOX;
  fake_document.hasFocus = () => false;
  hand_focus_to_parent();
  assert.equal(frame_blurs, 0);
  // None of these started the guard time.
  fake_document.hasFocus = () => true;
  hand_focus_to_parent();
  assert.equal(frame_blurs, 1);
});

test("a focused field blocks the hand-off unless the caller gives it up", () => {
  fake_document.activeElement = field;
  hand_focus_to_parent();
  assert.equal(frame_blurs, 0);
  hand_focus_to_parent(false);
  assert.equal(frame_blurs, 1);
});

test("a frame that gains the focus again within the guard time keeps it, and hands off after it", () => {
  hand_focus_to_parent();
  now_ms += 400;
  hand_focus_to_parent();
  assert.equal(frame_blurs, 1, "a page that fights for the focus got a second hand-off");
  now_ms += 200;
  hand_focus_to_parent();
  assert.equal(frame_blurs, 2);
});

test("insert mode between two hand-offs ends the guard time", () => {
  hand_focus_to_parent();
  page_mode.set_mode_("insert");
  hand_focus_to_parent();
  page_mode.set_mode_("normal");
  hand_focus_to_parent();
  assert.equal(frame_blurs, 2);
});

test("mode.set hands off for normal mode only, so a caret mode that waits on its bundle keeps the focus and the field", () => {
  fake_document.activeElement = field;
  void mode_set.run({ mode: "caret" }, false);
  assert.equal(page_mode.get_mode_(), "normal", "the caret mode did not stay pending, so the case proves nothing");
  assert.equal(frame_blurs, 0, "mode.set to caret blurred the hidden frame");
  void mode_set.run({ mode: "normal" }, false);
  assert.equal(frame_blurs, 1);
});
