import assert from "node:assert/strict";
import { test } from "node:test";
import { create_bundle_host } from "../../src/content/bundle_host.ts";
import { create_text_recorder, inserted_text } from "../../src/content/text/recorder.ts";
import type { Invocation } from "../../src/shared/invocation.ts";

type FakeField = { name: string; text: string };
const field_a: FakeField = { name: "a", text: "" };
const field_b: FakeField = { name: "b", text: "" };
const password: FakeField = { name: "password", text: "" };
const as_element = (field: FakeField) => field as unknown as Element;

function setup(entries: Map<Element | null, Invocation> = new Map()) {
  const recorded: Invocation[][] = [];
  const recorder = create_text_recorder({
    is_secret: (field) => field === as_element(password),
    take_entry: (field) => {
      const entry = entries.get(field);
      entries.clear();
      return entry;
    },
    read_text: (field) => (field as unknown as FakeField).text,
    record: (steps) => void recorded.push(steps),
  });
  // The page edits the field after the recorder saw the text before the edit.
  const edit = (field: FakeField, after: string) => {
    recorder.on_input(as_element(field), field.text);
    field.text = after;
  };
  return { recorded, recorder, edit };
}
const text_step = (text: string) => ({ id: "text.insert", args: { text } });

test.beforeEach(() => {
  for (const field of [field_a, field_b, password]) field.text = "";
});

test("inserted_text keeps what an edit put in, for every kind of edit", () => {
  assert.equal(inserted_text("", "hello"), "hello");
  assert.equal(inserted_text("ab", "abXY"), "XY");
  assert.equal(inserted_text("say cat", "say cat dog"), " dog");
  assert.equal(inserted_text("start end", "start mid end"), "mid ");
  // A word deleted by Ctrl+Backspace, forward delete and a deleted selection put nothing in.
  assert.equal(inserted_text("hello world", "hello "), "");
  assert.equal(inserted_text("hello world", "world"), "");
  // A selection replaced by a paste or an autocorrect.
  assert.equal(inserted_text("a teh b", "a the b"), "he");
  assert.equal(inserted_text("old text", "pasted"), "pasted");
  assert.equal(inserted_text("aaa", "aaaa"), "a");
  assert.equal(inserted_text("same", "same"), "");
});

test("an emoji typed before an equal-looking one is recorded whole", () => {
  assert.equal(inserted_text("\u{1F600}", "\u{1F601}\u{1F600}"), "\u{1F601}");
  assert.equal(inserted_text("\u{1F600}", "\u{1F600}\u{1F601}"), "\u{1F601}");
  assert.equal(inserted_text("a\u{1F600}b", "a\u{1F601}\u{1F600}b"), "\u{1F601}");
});

test("the text typed in one session is one text.insert step", () => {
  const { recorded, recorder, edit } = setup();
  edit(field_a, "h");
  field_a.text = "hey\nx";
  recorder.flush();
  assert.deepEqual(recorded, [[text_step("hey\nx")]]);
});

test("the command that focused the field leads the step", () => {
  const entry = { id: "page.focus_input" };
  const { recorded, recorder, edit } = setup(new Map([[as_element(field_a), entry]]));
  edit(field_a, "hi");
  recorder.flush();
  assert.deepEqual(recorded, [[entry, text_step("hi")]]);
});

test("word delete, forward delete and a deleted selection leave the typed text as the field has it", () => {
  const { recorded, recorder, edit } = setup();
  edit(field_a, "hello wor");
  field_a.text = "hello ";
  recorder.flush();
  assert.deepEqual(recorded, [[text_step("hello ")]]);
  // Text that was there before the session and is deleted is not recorded.
  field_a.text = "keep tail";
  edit(field_a, "keep tail");
  field_a.text = "keep ";
  recorder.flush();
  assert.equal(recorded.length, 1);
});

test("a paste and an autocorrect are recorded as the field shows them", () => {
  const { recorded, recorder, edit } = setup();
  field_a.text = "a teh b";
  edit(field_a, "a teh b pasted");
  field_a.text = "a the b pasted";
  recorder.flush();
  assert.deepEqual(recorded, [[text_step("he b pasted")]]);
});

test("Escape and focusout both flush, and the second one records nothing", () => {
  const { recorded, recorder, edit } = setup();
  edit(field_a, "once");
  recorder.flush();
  recorder.flush();
  assert.equal(recorded.length, 1);
});

test("a session whose edits cancel out records nothing", () => {
  const { recorded, recorder, edit } = setup();
  edit(field_a, "a");
  field_a.text = "";
  recorder.flush();
  assert.deepEqual(recorded, []);
});

test("an edit in another field ends the first session before it starts a second", () => {
  const { recorded, recorder, edit } = setup();
  edit(field_a, "one");
  edit(field_b, "two");
  recorder.flush();
  assert.deepEqual(recorded, [[text_step("one")], [text_step("two")]]);
});

test("a password field is never recorded, and it ends the session before it", () => {
  const { recorded, recorder, edit } = setup();
  edit(field_a, "user");
  edit(password, "hunter2");
  password.text = "hunter3";
  recorder.flush();
  assert.deepEqual(recorded, [[text_step("user")]]);
  assert.ok(!JSON.stringify(recorded).includes("hunter"));
});

test("a field that turns secret mid-session records nothing", () => {
  const secret = { name: "toggled", text: "" };
  let is_password = false;
  const recorded: Invocation[][] = [];
  const recorder = create_text_recorder({ is_secret: () => is_password, take_entry: () => undefined, read_text: () => secret.text, record: (steps) => void recorded.push(steps) });
  recorder.on_input(as_element(secret), "");
  secret.text = "pw";
  is_password = true;
  recorder.flush();
  assert.deepEqual(recorded, []);
});

test("the replay's own input events do not start a session", () => {
  const { recorded, recorder, edit } = setup();
  recorder.while_replaying(() => edit(field_a, "replayed"));
  recorder.flush();
  assert.deepEqual(recorded, []);
  edit(field_a, "typed");
  recorder.flush();
  assert.equal(recorded.length, 1);
});

test("an event the recorder ignores answers false, so typing after a replay opens a session and is recorded", () => {
  const { recorded, recorder } = setup();
  let answer: boolean | undefined;
  recorder.while_replaying(() => void (answer = recorder.on_input(as_element(field_a), "")));
  assert.equal(answer, false);
  field_a.text = "replayed";
  assert.equal(recorder.on_input(as_element(field_a), field_a.text), true);
  field_a.text = "replayed new";
  recorder.flush();
  assert.deepEqual(recorded, [[text_step(" new")]]);
});

test("a replay that throws still lets the next typing record", () => {
  const { recorded, recorder, edit } = setup();
  assert.throws(() => recorder.while_replaying(() => { throw new Error("no field"); }));
  edit(field_a, "after");
  recorder.flush();
  assert.equal(recorded.length, 1);
});

// The content script forwards each edit and each flush through the bundle host before the recorder bundle exists.
test("an edit before the bundle loads is recorded, and a flush queued behind it sees it", async () => {
  const host = create_bundle_host();
  let finish_load!: () => void;
  const load = new Promise<boolean>((resolve) => (finish_load = () => resolve(true)));
  host.connect({ request_bundle_: () => load, on_idle_: () => undefined, hold_first_: () => undefined, show_error_: (message) => assert.fail(message), set_mode_: () => undefined, on_sink_missing_: () => undefined });
  const { recorded, recorder } = setup();
  const pending = [
    host.run_command_("text.input", "text", { field_: as_element(field_a), before_: "" }, "", false),
    host.run_command_("text.flush", "text", {}, "", false),
  ];
  field_a.text = "go!";
  assert.deepEqual(recorded, []);
  host.api.register_handler_("text.input", (args) => void recorder.on_input(args.field_ as Element, args.before_ as string));
  host.api.register_handler_("text.flush", recorder.flush);
  finish_load();
  await Promise.all(pending);
  assert.deepEqual(recorded, [[text_step("go!")]]);
});
