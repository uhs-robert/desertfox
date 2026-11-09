import assert from "node:assert/strict";
import { test } from "node:test";

// `gi` stays in the content bundle and does not use the field list of `]i`. These cases fix which fields it picks.
class FakeHTMLElement {}
class FakeHTMLInputElement extends FakeHTMLElement {}
const globals = globalThis as Record<string, unknown>;
globals.HTMLElement = FakeHTMLElement;
globals.HTMLInputElement = FakeHTMLInputElement;
globals.innerHeight = 600;
globals.innerWidth = 800;
globals.getComputedStyle = (element: { visibility?: string }) => ({ visibility: element.visibility ?? "visible" });
const { page_focus_input } = await import("../../src/content/handlers/page.ts");

type Fake = { name: string; tag: "input" | "textarea" | "div" | "select" | "button"; type?: string; editable?: boolean; disabled?: boolean; top?: number; height?: number; visibility?: string };

function run_gi(fakes: Fake[]): string | undefined {
  let focused: string | undefined;
  const elements = fakes.map((fake) => {
    const element = Object.create(fake.tag === "input" ? FakeHTMLInputElement.prototype : FakeHTMLElement.prototype);
    Object.assign(element, {
      tagName: fake.tag.toUpperCase(),
      type: fake.type ?? "text",
      isContentEditable: fake.editable ?? false,
      disabled: fake.disabled ?? false,
      visibility: fake.visibility,
      getBoundingClientRect: () => ({ top: fake.top ?? 100, bottom: (fake.top ?? 100) + (fake.height ?? 20), left: 10, right: 110, width: 100, height: fake.height ?? 20 }),
      focus: () => void (focused = fake.name),
    });
    return element;
  });
  globals.document = { querySelectorAll: () => elements };
  page_focus_input.run({}, false);
  return focused;
}

test("gi picks the first text field that is in view", () => {
  assert.equal(run_gi([{ name: "above", tag: "input", top: -300 }, { name: "shown", tag: "textarea" }, { name: "second", tag: "input" }]), "shown");
});

test("gi falls back to the first visible field when none is in view", () => {
  assert.equal(run_gi([{ name: "far", tag: "input", top: 3000 }, { name: "farther", tag: "input", top: 4000 }]), "far");
});

test("gi takes text inputs and contenteditable, and passes over every other control", () => {
  const others: Fake[] = [
    { name: "checkbox", tag: "input", type: "checkbox" },
    { name: "radio", tag: "input", type: "radio" },
    { name: "submit", tag: "input", type: "submit" },
    { name: "button", tag: "button" },
    { name: "select", tag: "select" },
    { name: "disabled", tag: "input", disabled: true },
    { name: "flat", tag: "input", height: 0 },
    { name: "hidden_style", tag: "input", visibility: "hidden" },
  ];
  assert.equal(run_gi([...others, { name: "editable", tag: "div", editable: true }]), "editable");
  assert.equal(run_gi([...others, { name: "email", tag: "input", type: "email" }]), "email");
});

test("gi refuses on a page with no text field", () => {
  assert.throws(() => run_gi([{ name: "checkbox", tag: "input", type: "checkbox" }]), /No text field on this page/);
});
