import assert from "node:assert/strict";
import { test } from "node:test";

// `gi` runs from the page bundle and does not use the field list of `]i`. These cases fix which fields it picks.
class FakeHTMLElement {}
class FakeHTMLInputElement extends FakeHTMLElement {}
const globals = globalThis as Record<string, unknown>;
globals.HTMLElement = FakeHTMLElement;
globals.HTMLInputElement = FakeHTMLInputElement;
globals.innerHeight = 600;
globals.innerWidth = 800;
globals.getComputedStyle = (element: { visibility?: string }) => ({ visibility: element.visibility ?? "visible" });
const { focus_first_input } = await import("../../src/content/handlers/focus_input.ts");

type Fake = { name: string; tag: "input" | "textarea" | "div" | "select" | "button"; type?: string; editable?: boolean; disabled?: boolean; top?: number; height?: number; visibility?: string };

type FakeFrame = { top: number; height: number; fields?: Fake[] };

function run_gi(fakes: Fake[], frames: FakeFrame[] = []): string | undefined {
  let focused: string | undefined;
  const to_element = (fake: Fake) => {
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
  };
  const elements = fakes.map(to_element);
  // A frame of another site has no `contentDocument`.
  const frame_elements = frames.map((frame) => ({
    ownerDocument: { documentElement: { clientWidth: 800, clientHeight: 600 } },
    getBoundingClientRect: () => ({ top: frame.top, bottom: frame.top + frame.height, left: 0, right: 600, width: 600, height: frame.height }),
    contentDocument: frame.fields && { querySelectorAll: () => frame.fields!.map(to_element) },
  }));
  globals.document = { querySelectorAll: (selector: string) => (selector === "iframe" ? frame_elements : elements) };
  focus_first_input();
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

const DOCS_LIKE_FRAME: FakeFrame = { top: -10000, height: 1, fields: [{ name: "frame_editor", tag: "div", editable: true }] };

test("gi focuses the field inside a hidden input frame when the page itself has no field", () => {
  assert.equal(run_gi([{ name: "checkbox", tag: "input", type: "checkbox" }], [{ top: -10000, height: 1 }, { top: -10000, height: 1, fields: [] }, DOCS_LIKE_FRAME]), "frame_editor");
});

test("gi picks a hidden input frame's field ahead of a visible field of the page", () => {
  assert.equal(run_gi([{ name: "title", tag: "input" }], [DOCS_LIKE_FRAME]), "frame_editor");
});

test("gi does not reach into a frame the user can see", () => {
  const shown_frame: FakeFrame = { top: 100, height: 200, fields: [{ name: "shown_frame_field", tag: "input" }] };
  assert.throws(() => run_gi([], [shown_frame]), /No text field on this page/);
});
