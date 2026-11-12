import assert from "node:assert/strict";
import { test } from "node:test";

class FakeHTMLElement {
  tagName = "INPUT";
  type = "text";
  isContentEditable = false;
  isConnected = true;
  autocomplete = "";
  events: string[] = [];
  focus_handler: (() => void) | undefined;
  event_handler: ((type: string) => void) | undefined;
  focus() {
    this.focus_handler?.();
  }
  select() {}
  closest(selector: string) {
    return this.inside.some((name) => selector.includes(name)) ? this : null;
  }
  inside: string[] = [];
  dispatchEvent(event: Event) {
    this.events.push(event.type);
    this.event_handler?.(event.type);
    return true;
  }
}
// The setter lives on the element's own class, as the native one lives on HTMLInputElement.prototype.
class FakeHTMLInputElement extends FakeHTMLElement {
  stored = "";
  get value() {
    return this.stored;
  }
  set value(text: string) {
    this.stored = text;
  }
}
class FakeHTMLTextAreaElement extends FakeHTMLElement {}
// A single-line input drops line breaks, as a real one does.
class FakeSingleLineInput extends FakeHTMLInputElement {
  override set value(text: string) {
    this.stored = text.replaceAll("\n", "");
  }
  override get value() {
    return this.stored;
  }
}
class FakeEditableDiv extends FakeHTMLElement {
  override tagName = "DIV";
  override isContentEditable = true;
  innerText = "";
  selected_all = false;
}
const globals = globalThis as Record<string, unknown>;
globals.HTMLElement = FakeHTMLElement;
globals.HTMLInputElement = FakeHTMLInputElement;
globals.HTMLTextAreaElement = FakeHTMLTextAreaElement;

type Handler = (args: Record<string, unknown>) => Promise<void> | void;
const handlers = new Map<string, Handler>();
const toasts: string[] = [];
const sent: Record<string, unknown>[] = [];
let answer: unknown = { ok: true };
let register_answer: unknown = { ok: true };
let listener: ((message: unknown) => Promise<boolean> | undefined) | undefined;
let typed: string[] = [];
let accepts = true;
let selected: FakeEditableDiv | undefined;

globals.window = { desertfox_host: { register_handler_: (id: string, handler: Handler) => handlers.set(id, handler), show_toast_: (message: string) => toasts.push(message) } };
globals.browser = {
  runtime: {
    sendMessage: async (message: Record<string, unknown>) => (sent.push(message), message.type === "editor_open" ? answer : register_answer),
    onMessage: { addListener: (fn: typeof listener) => (listener = fn) },
  },
};
globals.getSelection = () => ({ selectAllChildren: (field: FakeEditableDiv) => (selected = field) });
globals.document = { activeElement: null, execCommand: (command: string, _ui: boolean, text?: string) => (typed.push(`${command}:${text ?? ""}`), accepts) };
await import("../../src/content/editor/main.ts");

const focus = (field: FakeHTMLElement | null) => ((globals.document as { activeElement: unknown }).activeElement = field);
const run = async (args: Record<string, unknown> = {}): Promise<void> => handlers.get("text.edit_external")!(args);
const opened = () => sent.filter((message) => message.type === "editor_open").at(-1) as { token: string; text: string; insert: boolean; ext?: string };
const done = (text?: string, token = opened().token) => listener!({ type: "editor_done", token, ...(text === undefined ? {} : { text }) });
const reset = () => ((sent.length = 0), (toasts.length = 0), (typed = []), (answer = { ok: true }), (register_answer = { ok: true }), (accepts = true), (selected = undefined));
const input = (value: string) => Object.assign(new FakeHTMLInputElement(), { value });
const div = (innerText: string) => Object.assign(new FakeEditableDiv(), { innerText });
const yanked = () => sent.filter((message) => message.type === "register_yank");

test("a field with text is sent with its text, the insert flag and the ext", async () => {
  reset();
  focus(input("draft"));
  await run({ insert: true, ext: "md" });
  assert.equal(opened().text, "draft");
  assert.equal(opened().insert, true);
  assert.equal(opened().ext, "md");
});

test("no focused field and a password field refuse before anything is sent", async () => {
  reset();
  focus(null);
  await assert.rejects(run(), /No text field/);
  focus(Object.assign(input(""), { type: "password" }));
  await assert.rejects(run(), /password/);
  assert.equal(sent.length, 0);
});

// The whole clipboard path is in editor_clipboard_fallback.test.ts. Here the page has no clipboard, so the copy fails.
test("a virtualized editor (CodeMirror 6 content, a hidden textarea of CM5, Ace or Monaco) goes through the clipboard, and a failed copy is refused before anything is sent", async () => {
  reset();
  for (const name of [".cm-editor", ".CodeMirror", ".monaco-editor", ".ace_editor"]) {
    focus(Object.assign(div("slice"), { inside: [name] }));
    await assert.rejects(run(), /only part of its text.*clipboard.*cannot be edited externally/, name);
    focus(Object.assign(input("slice"), { inside: [name] }));
    await assert.rejects(run(), /only part of its text.*clipboard.*cannot be edited externally/, name);
  }
  assert.equal(sent.length, 0);
});

test("a field over 128 KiB is refused with its size before anything is sent", async () => {
  reset();
  focus(input("x".repeat(128 * 1024 + 1)));
  await assert.rejects(run(), /129 KiB, over the 128 KiB/);
  assert.equal(sent.length, 0);
  focus(input("x".repeat(128 * 1024)));
  await run();
  assert.equal(sent.length, 1);
});

test("a refusal from the background reaches the key as a refusal and the page waits for nothing", async () => {
  reset();
  focus(input("a"));
  answer = { ok: false, message: "An editor is already open for this tab" };
  await assert.rejects(run(), /already open/);
  assert.equal(await done("b"), false);
  assert.deepEqual(typed, []);
});

test("an unchanged plain field takes the result through the native setter and input and change events", async () => {
  reset();
  const field = input("draft");
  focus(field);
  await run();
  assert.equal(await done("final"), true);
  assert.equal(field.value, "final");
  assert.deepEqual(field.events, ["input", "change"]);
  assert.deepEqual(typed, []);
  assert.deepEqual(toasts, []);
});

test("an unchanged contenteditable takes the result as one insert over its whole content", async () => {
  reset();
  const field = div("draft");
  focus(field);
  await run();
  assert.equal(await done("final"), true);
  assert.equal(selected, field);
  assert.deepEqual(typed, ["insertText:final"]);
  assert.deepEqual(toasts, []);
});

test("an empty result clears a contenteditable with delete, which insertText refuses", async () => {
  reset();
  focus(div("draft"));
  await run();
  await done("");
  assert.deepEqual(typed, ["delete:"]);
});

test("a result equal to the text at the press and a message of another page write nothing", async () => {
  reset();
  focus(input("draft"));
  await run();
  assert.equal(await done("final", "someone-else"), false);
  assert.equal(await done(undefined), true);
  assert.deepEqual(typed, []);
  assert.equal(yanked().length, 0);
  focus(input("same"));
  await run();
  assert.equal(await done("same"), true);
  assert.equal(yanked().length, 0);
});

test("a field that changed meanwhile keeps its text, the result goes to the register and the toast says the field changed", async () => {
  reset();
  const field = input("draft");
  focus(field);
  await run();
  field.value = "draft, then typed";
  await done("final");
  assert.equal(field.value, "draft, then typed");
  assert.deepEqual(yanked().at(-1), { type: "register_yank", name: "", text: "final" });
  assert.match(toasts[0] ?? "", /field changed.*unnamed register/);
});

test("a field that left the page counts as changed", async () => {
  reset();
  const field = input("draft");
  focus(field);
  await run();
  field.isConnected = false;
  await done("final");
  assert.equal(yanked().length, 1);
  assert.match(toasts[0] ?? "", /field changed/);
});

test("a focus handler that edits the field is seen: the check runs again after focus and the result goes to the register", async () => {
  reset();
  const field = input("draft");
  focus(field);
  await run();
  field.focus_handler = () => (field.value = "edited by the page on focus");
  await done("final");
  assert.equal(field.value, "edited by the page on focus");
  assert.equal(yanked().length, 1);
  assert.match(toasts[0] ?? "", /field changed/);
});

test("a write the field refuses goes to the register with its own message, not the field changed one", async () => {
  reset();
  const field = div("draft");
  focus(field);
  await run();
  accepts = false;
  await done("final");
  assert.deepEqual(yanked().at(-1), { type: "register_yank", name: "", text: "final" });
  assert.match(toasts[0] ?? "", /did not take the edited text.*unnamed register/);
  assert.doesNotMatch(toasts[0] ?? "", /changed/);
});

test("a register that did not take the text is said, and the toast does not claim it did", async () => {
  reset();
  const field = input("draft");
  focus(field);
  await run();
  field.value = "other";
  register_answer = { ok: false, message: "storage full" };
  await done("final");
  assert.match(toasts[0] ?? "", /5 characters.*could not be saved.*storage full/);
  assert.doesNotMatch(toasts[0] ?? "", /is in the unnamed register/);
});

test("a result that arrives before the answer to the open still finds its edit", async () => {
  reset();
  const field = input("draft");
  focus(field);
  const original = (globals.browser as { runtime: { sendMessage: unknown } }).runtime.sendMessage as (m: Record<string, unknown>) => Promise<unknown>;
  (globals.browser as { runtime: { sendMessage: unknown } }).runtime.sendMessage = async (message: Record<string, unknown>) => {
    if (message.type === "editor_open") void listener!({ type: "editor_done", token: message.token, text: "fast" });
    return original(message);
  };
  await run();
  (globals.browser as { runtime: { sendMessage: unknown } }).runtime.sendMessage = original;
  assert.equal(field.value, "fast");
});

test("a field that sanitizes the value counts as refusing it: the result goes to the register and no event fires", async () => {
  reset();
  const field = Object.assign(new FakeSingleLineInput(), { value: "draft" });
  focus(field);
  await run();
  await done("line one\nline two");
  assert.deepEqual(field.events, []);
  assert.equal(field.value, "draft", "the field is put back to the text it had");
  assert.deepEqual(yanked().at(-1), { type: "register_yank", name: "", text: "line one\nline two" });
  assert.match(toasts[0] ?? "", /did not take the edited text/);
});

test("a page handler that puts its own value back during input or change makes the write refused, and the result goes to the register", async () => {
  for (const event_type of ["input", "change"]) {
    reset();
    const field = input("draft");
    focus(field);
    await run();
    field.event_handler = (type) => type === event_type && (field.value = "draft");
    await done("final");
    assert.equal(field.value, "draft", `the page keeps the value it set during ${event_type}`);
    assert.deepEqual(yanked().at(-1), { type: "register_yank", name: "", text: "final" });
    assert.match(toasts[0] ?? "", /did not take the edited text/);
  }
});
