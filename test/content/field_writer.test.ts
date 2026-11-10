import assert from "node:assert/strict";
import { test } from "node:test";

class FakeHTMLElement {
  tagName = "INPUT";
  type = "text";
  isContentEditable = false;
  isConnected = true;
  focused = false;
  focus() {
    this.focused = true;
    globals.document = { ...(globals.document as object), activeElement: this };
  }
}
class FakeHTMLInputElement extends FakeHTMLElement {}
const globals = globalThis as Record<string, unknown>;
globals.HTMLElement = FakeHTMLElement;
globals.HTMLInputElement = FakeHTMLInputElement;
const { write_into_field } = await import("../../src/content/text/field_writer.ts");
const { is_secret_field } = await import("../../src/content/text/secret_field.ts");

const field = (type = "text") => Object.assign(new FakeHTMLInputElement(), { type });

function document_with(active: unknown, accepts = true) {
  const typed: string[] = [];
  globals.document = { activeElement: active, execCommand: (command: string, _ui: boolean, text: string) => (command === "insertText" && accepts ? (typed.push(text), true) : false) };
  return typed;
}

test("the text goes into the focused field", () => {
  const typed = document_with(field());
  write_into_field("hello", undefined);
  assert.deepEqual(typed, ["hello"]);
});

test("with no focused field the field the last Escape left takes the text, focused first", () => {
  const typed = document_with(null);
  const left = field();
  write_into_field("again", left as unknown as Element);
  assert.equal(left.focused, true);
  assert.deepEqual(typed, ["again"]);
});

test("with no focused field and none left, it refuses", () => {
  document_with(null);
  assert.throws(() => write_into_field("x", undefined), { name: "RuntimeRefusal" });
  const detached = Object.assign(field(), { isConnected: false });
  assert.throws(() => write_into_field("x", detached as unknown as Element), { name: "RuntimeRefusal" });
  const not_a_field = Object.assign(field("checkbox"), {});
  assert.throws(() => write_into_field("x", not_a_field as unknown as Element), { name: "RuntimeRefusal" });
});

test("a field that does not take the text refuses", () => {
  document_with(field(), false);
  assert.throws(() => write_into_field("x", undefined), { name: "RuntimeRefusal" });
});

test("an autocomplete of a password or a one-time code is secret, and a field once secret stays secret", () => {
  for (const autocomplete of ["current-password", "new-password", "one-time-code", "username current-password"]) {
    assert.equal(is_secret_field(Object.assign(field(), { autocomplete }) as unknown as Element), true, autocomplete);
  }
  assert.equal(is_secret_field(Object.assign(field(), { autocomplete: "email" }) as unknown as Element), false);
  const toggled = field("password");
  assert.equal(is_secret_field(toggled as unknown as Element), true);
  toggled.type = "text";
  assert.equal(is_secret_field(toggled as unknown as Element), true);
});

test("only a password input is secret", () => {
  assert.equal(is_secret_field(field("password") as unknown as Element), true);
  assert.equal(is_secret_field(field("text") as unknown as Element), false);
  assert.equal(is_secret_field(null), false);
});
