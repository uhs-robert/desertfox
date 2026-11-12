import assert from "node:assert/strict";
import { test } from "node:test";

class FakeHTMLElement {
  tagName = "INPUT";
  type = "text";
  isContentEditable = false;
  isConnected = true;
  value = "";
  autocomplete = "";
  focus() {}
  select() {}
}
class FakeHTMLInputElement extends FakeHTMLElement {}
class FakeHTMLTextAreaElement extends FakeHTMLElement {}
const globals = globalThis as Record<string, unknown>;
globals.HTMLElement = FakeHTMLElement;
globals.HTMLInputElement = FakeHTMLInputElement;
globals.HTMLTextAreaElement = FakeHTMLTextAreaElement;

type Handler = (args: Record<string, unknown>) => Promise<void> | void;
const handlers = new Map<string, Handler>();
const toasts: string[] = [];
const sent: Record<string, unknown>[] = [];
let answer: unknown = { ok: true };
let listener: ((message: unknown) => unknown) | undefined;
let typed: string[] = [];

globals.window = { desertfox_host: { register_handler_: (id: string, handler: Handler) => handlers.set(id, handler), show_toast_: (message: string) => toasts.push(message) } };
globals.browser = {
  runtime: {
    sendMessage: async (message: Record<string, unknown>) => (sent.push(message), message.type === "editor_open" ? answer : undefined),
    onMessage: { addListener: (fn: (message: unknown) => unknown) => (listener = fn) },
  },
};
globals.document = { activeElement: null, execCommand: (command: string, _ui: boolean, text?: string) => (typed.push(`${command}:${text ?? ""}`), true) };
await import("../../src/content/editor/main.ts");

const focus = (field: FakeHTMLElement | null) => ((globals.document as { activeElement: unknown }).activeElement = field);
const run = async (args: Record<string, unknown> = {}): Promise<void> => handlers.get("text.edit_external")!(args);
const opened = () => sent.filter((message) => message.type === "editor_open").at(-1) as { token: string; text: string; insert: boolean; ext?: string };
const reset = () => ((sent.length = 0), (toasts.length = 0), (typed = []), (answer = { ok: true }));

test("a field with text is sent with its text, the insert flag and the ext", async () => {
  reset();
  const field = Object.assign(new FakeHTMLInputElement(), { value: "draft" });
  focus(field);
  await run({ insert: true, ext: "md" });
  assert.equal(opened().text, "draft");
  assert.equal(opened().insert, true);
  assert.equal(opened().ext, "md");
});

test("no focused field and a password field refuse before anything is sent", async () => {
  reset();
  focus(null);
  await assert.rejects(run(), /No text field/);
  focus(Object.assign(new FakeHTMLInputElement(), { type: "password" }));
  await assert.rejects(run(), /password/);
  assert.equal(sent.length, 0);
});

test("a field over 128 KiB is refused with its size before anything is sent", async () => {
  reset();
  focus(Object.assign(new FakeHTMLInputElement(), { value: "x".repeat(128 * 1024 + 1) }));
  await assert.rejects(run(), /129 KiB, over the 128 KiB/);
  assert.equal(sent.length, 0);
  focus(Object.assign(new FakeHTMLInputElement(), { value: "x".repeat(128 * 1024) }));
  await run();
  assert.equal(sent.length, 1);
});

test("a refusal from the background reaches the key as a refusal and the page waits for nothing", async () => {
  reset();
  const field = Object.assign(new FakeHTMLInputElement(), { value: "a" });
  focus(field);
  answer = { ok: false, message: "An editor is already open for this tab" };
  await assert.rejects(run(), /already open/);
  const { token } = opened();
  listener!({ type: "editor_done", token, text: "b" });
  assert.deepEqual(typed, []);
});

test("an unchanged field takes the result as one insert over the whole text", async () => {
  reset();
  const field = Object.assign(new FakeHTMLInputElement(), { value: "draft" });
  focus(field);
  await run();
  listener!({ type: "editor_done", token: opened().token, text: "final" });
  assert.deepEqual(typed, ["insertText:final"]);
  assert.deepEqual(toasts, []);
});

test("an edit that changed nothing and a message of another page write nothing", async () => {
  reset();
  const field = Object.assign(new FakeHTMLInputElement(), { value: "draft" });
  focus(field);
  await run();
  listener!({ type: "editor_done", token: "someone-else", text: "x" });
  listener!({ type: "editor_done", token: opened().token });
  assert.deepEqual(typed, []);
  assert.equal(sent.some((message) => message.type === "register_yank"), false);
});

test("a field that changed meanwhile keeps its text, the result goes to the register and a toast says so", async () => {
  reset();
  const field = Object.assign(new FakeHTMLInputElement(), { value: "draft" });
  focus(field);
  await run();
  field.value = "draft, then typed";
  listener!({ type: "editor_done", token: opened().token, text: "final" });
  assert.deepEqual(typed, []);
  assert.deepEqual(sent.at(-1), { type: "register_yank", name: "", text: "final" });
  assert.match(toasts[0] ?? "", /unnamed register/);
});

test("a field that left the page counts as changed", async () => {
  reset();
  const field = Object.assign(new FakeHTMLInputElement(), { value: "draft" });
  focus(field);
  await run();
  field.isConnected = false;
  listener!({ type: "editor_done", token: opened().token, text: "final" });
  assert.equal(sent.at(-1)?.type, "register_yank");
});

test("an empty result clears the field with delete, which insertText refuses", async () => {
  reset();
  const field = Object.assign(new FakeHTMLInputElement(), { value: "draft" });
  focus(field);
  await run();
  listener!({ type: "editor_done", token: opened().token, text: "" });
  assert.deepEqual(typed, ["delete:"]);
});

test("a result that arrives before the answer to the open still finds its edit", async () => {
  reset();
  const field = Object.assign(new FakeHTMLInputElement(), { value: "draft" });
  focus(field);
  const original = (globals.browser as { runtime: { sendMessage: unknown } }).runtime.sendMessage as (m: Record<string, unknown>) => Promise<unknown>;
  (globals.browser as { runtime: { sendMessage: unknown } }).runtime.sendMessage = async (message: Record<string, unknown>) => {
    if (message.type === "editor_open") listener!({ type: "editor_done", token: message.token, text: "fast" });
    return original(message);
  };
  await run();
  (globals.browser as { runtime: { sendMessage: unknown } }).runtime.sendMessage = original;
  assert.deepEqual(typed, ["insertText:fast"]);
});
