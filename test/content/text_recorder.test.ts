import assert from "node:assert/strict";
import { test } from "node:test";
import { create_bundle_host } from "../../src/content/bundle_host.ts";
import { create_text_recorder } from "../../src/content/text/recorder.ts";
import type { Invocation } from "../../src/shared/invocation.ts";

const field_a = { name: "a" } as unknown as Element;
const field_b = { name: "b" } as unknown as Element;
const password = { name: "password" } as unknown as Element;
const typed = (data: string, field: Element | null = field_a) => ({ input_type: "insertText", data, field });

function setup(entries: Map<Element | null, Invocation> = new Map()) {
  const recorded: Invocation[][] = [];
  const recorder = create_text_recorder({
    is_secret: (field) => field === password,
    take_entry: (field) => {
      const entry = entries.get(field);
      entries.clear();
      return entry;
    },
    record: (steps) => void recorded.push(steps),
  });
  return { recorded, recorder };
}

test("the text of one session is one text.insert step", () => {
  const { recorded, recorder } = setup();
  for (const character of "hey") recorder.on_input(typed(character));
  recorder.on_input({ input_type: "insertLineBreak", data: null, field: field_a });
  recorder.on_input(typed("x"));
  recorder.flush();
  assert.deepEqual(recorded, [[{ id: "text.insert", args: { text: "hey\nx" } }]]);
});

test("the command that focused the field leads the step", () => {
  const entry = { id: "page.focus_input" };
  const { recorded, recorder } = setup(new Map([[field_a, entry]]));
  recorder.on_input(typed("hi"));
  recorder.flush();
  assert.deepEqual(recorded, [[entry, { id: "text.insert", args: { text: "hi" } }]]);
});

test("a backspace removes only text of the session", () => {
  const { recorded, recorder } = setup();
  recorder.on_input({ input_type: "deleteContentBackward", data: null, field: field_a });
  recorder.on_input(typed("abc"));
  recorder.on_input({ input_type: "deleteContentBackward", data: null, field: field_a });
  recorder.flush();
  assert.deepEqual(recorded, [[{ id: "text.insert", args: { text: "ab" } }]]);
});

test("Escape and focusout both flush, and the second one records nothing", () => {
  const { recorded, recorder } = setup();
  recorder.on_input(typed("once"));
  recorder.flush();
  recorder.flush();
  assert.equal(recorded.length, 1);
});

test("a session with no text records nothing", () => {
  const { recorded, recorder } = setup();
  recorder.on_input(typed("a"));
  recorder.on_input({ input_type: "deleteContentBackward", data: null, field: field_a });
  recorder.flush();
  assert.deepEqual(recorded, []);
});

test("typing in another field ends the first session before it starts a second", () => {
  const { recorded, recorder } = setup();
  recorder.on_input(typed("one", field_a));
  recorder.on_input(typed("two", field_b));
  recorder.flush();
  assert.deepEqual(recorded, [[{ id: "text.insert", args: { text: "one" } }], [{ id: "text.insert", args: { text: "two" } }]]);
});

test("a password field is never recorded, and it ends the session before it", () => {
  const { recorded, recorder } = setup();
  recorder.on_input(typed("user", field_a));
  recorder.on_input(typed("hunter2", password));
  recorder.on_input(typed("hunter3", password));
  recorder.flush();
  assert.deepEqual(recorded, [[{ id: "text.insert", args: { text: "user" } }]]);
  assert.ok(!JSON.stringify(recorded).includes("hunter"));
});

test("the replay's own input events are not recorded", () => {
  const { recorded, recorder } = setup();
  recorder.while_replaying(() => recorder.on_input(typed("replayed")));
  recorder.flush();
  assert.deepEqual(recorded, []);
  recorder.on_input(typed("typed"));
  recorder.flush();
  assert.equal(recorded.length, 1);
});

test("a replay that throws still lets the next typing record", () => {
  const { recorded, recorder } = setup();
  assert.throws(() => recorder.while_replaying(() => { throw new Error("no field"); }));
  recorder.on_input(typed("after"));
  recorder.flush();
  assert.equal(recorded.length, 1);
});

// The content script forwards each input event and each flush through the bundle host before the recorder bundle exists.
test("input typed before the bundle loads is recorded in order, ahead of a flush queued behind it", async () => {
  const host = create_bundle_host();
  let finish_load!: () => void;
  const load = new Promise<boolean>((resolve) => (finish_load = () => resolve(true)));
  host.connect({ request_bundle_: () => load, on_idle_: () => undefined, hold_first_: () => undefined, show_error_: (message) => assert.fail(message), set_mode_: () => undefined, on_sink_missing_: () => undefined });
  const { recorded, recorder } = setup();
  const pending = [
    ...["g", "o", "!"].map((data) => host.run_command_("text.input", "text", { data }, "", false)),
    host.run_command_("text.flush", "text", {}, "", false),
  ];
  assert.deepEqual(recorded, []);
  host.api.register_handler_("text.input", (args) => recorder.on_input(typed(args.data as string)));
  host.api.register_handler_("text.flush", recorder.flush);
  finish_load();
  await Promise.all(pending);
  assert.deepEqual(recorded, [[{ id: "text.insert", args: { text: "go!" } }]]);
});
