import assert from "node:assert/strict";
import { test } from "node:test";
import { FORM_CONTROLS, focus_field, pick_field, place_of } from "../../src/content/hints/focus_fields.ts";

type Fake = {
  name: string;
  localName: string;
  type?: string;
  disabled?: boolean;
  in_disabled_fieldset?: boolean;
  editable?: "" | "true" | "false";
  size?: { width: number; height: number };
  top?: number;
  hidden?: boolean;
  shadow?: Fake[];
  frame?: Fake[];
};

const VIEW_HEIGHT = 600;
const events: string[] = [];
const view = { innerHeight: VIEW_HEIGHT, innerWidth: 800, getComputedStyle: () => ({ position: "static", display: "block", overflowX: "visible", overflowY: "visible" }) };

// Matches the one-tag selectors of FORM_CONTROLS: `tag:not([a=b]):not([disabled])` and `[contenteditable="v"]`.
function matches_selector(fake: Fake, selector: string): boolean {
  return selector.split(", ").some((part) => {
    const attribute = /^\[contenteditable="(.*)"\]$/.exec(part);
    if (attribute) return fake.editable === attribute[1];
    const [tag, ...nots] = part.split(":not(");
    if (tag !== fake.localName) return false;
    return nots.every((not) => {
      const condition = not.slice(0, -1);
      // Only the attribute is the fake's own; `:disabled` also holds for a control in a disabled fieldset.
      if (condition === "[disabled]") return !fake.disabled;
      if (condition === ":disabled") return !fake.disabled && !fake.in_disabled_fieldset;
      const [, value] = /^\[type=(.*)\]$/.exec(condition)!;
      return fake.type !== value;
    });
  });
}

const realized = new WeakMap<Fake, Element>();

function realize(fake: Fake): Element {
  const known = realized.get(fake);
  if (known) return known;
  const box = { top: fake.top ?? 100, left: 10, bottom: (fake.top ?? 100) + (fake.size?.height ?? 20), right: 10 + (fake.size?.width ?? 100) };
  const size = fake.size ?? { width: 100, height: 20 };
  const element = {
    name: fake.name,
    localName: fake.localName,
    children: [],
    parentElement: null,
    clientLeft: 0,
    clientTop: 0,
    ownerDocument: { defaultView: view },
    matches: (selector: string) => matches_selector(fake, selector),
    querySelectorAll: () => [],
    getClientRects: () => (size.width > 0 && size.height > 0 ? [{ left: box.left, top: box.top, right: box.right, bottom: box.top + size.height, width: size.width, height: size.height }] : []),
    getBoundingClientRect: () => ({ ...box, width: size.width, height: size.height }),
    checkVisibility: () => !fake.hidden,
    focus: () => void events.push(`focus ${fake.name}`),
    scrollIntoView: () => void events.push(`scroll ${fake.name}`),
    openOrClosedShadowRoot: fake.shadow ? { querySelectorAll: () => fake.shadow!.map(realize) } : null,
  };
  realized.set(fake, element as unknown as Element);
  return element as unknown as Element;
}

const page = (fakes: Fake[], active: Fake | null = null) => {
  const elements = fakes.map(realize);
  const by_name = new Map(elements.map((element) => [(element as unknown as { name: string }).name, element]));
  (globalThis as Record<string, unknown>).document = { activeElement: active ? by_name.get(active.name) : null };
  return { root: { querySelectorAll: () => elements } as unknown as ParentNode, by_name };
};

const field = (name: string, extra: Partial<Fake> = {}): Fake => ({ name, localName: "input", type: "text", ...extra });

test("every kind of form control takes focus, in page order", () => {
  const kinds: Fake[] = [
    field("text"),
    { name: "textarea", localName: "textarea" },
    { name: "editable_empty", localName: "div", editable: "" },
    { name: "editable_true", localName: "div", editable: "true" },
    { name: "select", localName: "select" },
    field("checkbox", { type: "checkbox" }),
    field("radio", { type: "radio" }),
    field("input_button", { type: "button" }),
    field("submit", { type: "submit" }),
    field("reset", { type: "reset" }),
    field("image", { type: "image" }),
    { name: "button", localName: "button" },
  ];
  for (const [index, kind] of kinds.entries()) {
    events.length = 0;
    assert.equal(focus_field(page(kinds, kinds[index - 1] ?? null).root, undefined, "next", 1), undefined, kind.name);
    assert.deepEqual(events, [`focus ${kind.name}`], kind.name);
  }
});

test("hidden inputs, disabled controls, plain divs and contenteditable=false are left out", () => {
  const left_out: Fake[] = [field("hidden", { type: "hidden" }), field("off", { disabled: true }), { name: "off_area", localName: "textarea", disabled: true }, { name: "off_select", localName: "select", disabled: true }, { name: "off_button", localName: "button", disabled: true }, { name: "div", localName: "div" }, { name: "no_edit", localName: "div", editable: "false" }];
  for (const fake of left_out) assert.equal(matches_selector(fake, FORM_CONTROLS), false, fake.name);
});

test("a control inside a disabled fieldset is left out and skipped", () => {
  const fieldset_kinds: Fake[] = [field("in_fieldset", { in_disabled_fieldset: true }), { name: "area_in_fieldset", localName: "textarea", in_disabled_fieldset: true }, { name: "button_in_fieldset", localName: "button", in_disabled_fieldset: true }, { name: "select_in_fieldset", localName: "select", in_disabled_fieldset: true }];
  for (const fake of fieldset_kinds) assert.equal(matches_selector(fake, FORM_CONTROLS), false, fake.name);
  const fakes = [field("a"), field("stuck", { in_disabled_fieldset: true }), field("c")];
  events.length = 0;
  focus_field(page(fakes, fakes[0]).root, undefined, "next", 1);
  assert.deepEqual(events, ["focus c"]);
});

test("zero-size and hidden controls are skipped, offscreen ones are kept", () => {
  const { root } = page([field("flat", { size: { width: 0, height: 20 } }), field("invisible", { hidden: true }), field("far_below", { top: 5000 }), field("last")]);
  events.length = 0;
  assert.equal(focus_field(root, undefined, "next", 1), undefined);
  assert.equal(events[0], "focus far_below");
});

test("a far control is centered when it is not fully in view, and a near one is not scrolled", () => {
  events.length = 0;
  focus_field(page([field("far", { top: 5000 })]).root, undefined, "next", 1);
  assert.deepEqual(events, ["focus far", "scroll far"]);
  events.length = 0;
  focus_field(page([field("near")]).root, undefined, "next", 1);
  assert.deepEqual(events, ["focus near"]);
});

test("the focused control is the start point", () => {
  const fakes = [field("a"), field("b"), field("c")];
  events.length = 0;
  assert.equal(focus_field(page(fakes, fakes[1]).root, undefined, "next", 1), undefined);
  assert.equal(events[0], "focus c");
  events.length = 0;
  assert.equal(focus_field(page(fakes, fakes[1]).root, undefined, "prev", 1), undefined);
  assert.equal(events[0], "focus a");
});

test("with nothing focused the last blurred control is the start point, and it beats the view", () => {
  const fakes = [field("a", { top: -200 }), field("b"), field("c")];
  const { root, by_name } = page(fakes);
  events.length = 0;
  focus_field(root, by_name.get("b"), "next", 1);
  assert.equal(events[0], "focus c");
});

test("a focused element that is no control gives way to the last blurred one", () => {
  const fakes = [field("a"), field("b"), { name: "link", localName: "a" } as Fake];
  const { root, by_name } = page(fakes, fakes[2]);
  events.length = 0;
  focus_field(root, by_name.get("a"), "next", 1);
  assert.equal(events[0], "focus b");
});

test("with no anchor, next takes the first control that is not above the view and prev takes the last one above", () => {
  const fakes = [field("above_1", { top: -300 }), field("above_2", { top: -100 }), field("shown"), field("below", { top: 900 })];
  events.length = 0;
  focus_field(page(fakes).root, undefined, "next", 1);
  assert.equal(events[0], "focus shown");
  events.length = 0;
  focus_field(page(fakes).root, undefined, "prev", 1);
  assert.equal(events[0], "focus above_2");
});

test("a toast message answers past the last control and before the first, and focus stays", () => {
  const fakes = [field("a"), field("b")];
  events.length = 0;
  assert.equal(focus_field(page(fakes, fakes[1]).root, undefined, "next", 1), "No next form control");
  assert.equal(focus_field(page(fakes, fakes[0]).root, undefined, "prev", 1), "No previous form control");
  assert.deepEqual(events, []);
});

test("a page with no control answers with a message", () => {
  assert.equal(focus_field(page([{ name: "p", localName: "p" }]).root, undefined, "next", 1), "No form control on this page");
});

test("controls inside a shadow root are reached in place, from either side", () => {
  const inner = field("inner");
  const fakes = [field("first"), { name: "host", localName: "my-form", shadow: [inner] } as Fake, field("after")];
  events.length = 0;
  focus_field(page(fakes, fakes[0]).root, undefined, "next", 1);
  focus_field(page(fakes).root, realize(inner), "next", 1);
  focus_field(page(fakes).root, realize(inner), "prev", 1);
  assert.deepEqual(events, ["focus inner", "focus after", "focus first"]);
});

test("a count moves that many controls and stops on the last", () => {
  const fakes = [field("a"), field("b"), field("c"), field("d")];
  events.length = 0;
  focus_field(page(fakes, fakes[0]).root, undefined, "next", 2);
  focus_field(page(fakes, fakes[0]).root, undefined, "next", 9);
  assert.deepEqual(events, ["focus c", "focus d"]);
});

test("pick_field moves by steps and clamps at the ends", () => {
  const on = (index: number) => ({ index, on_field: true });
  assert.deepEqual(pick_field(5, on(1), "next", 1), { index: 2 });
  assert.deepEqual(pick_field(5, on(1), "next", 2), { index: 3 });
  assert.deepEqual(pick_field(5, on(1), "next", 99), { index: 4 });
  assert.deepEqual(pick_field(5, on(3), "prev", 2), { index: 1 });
  assert.deepEqual(pick_field(5, on(3), "prev", 99), { index: 0 });
  assert.deepEqual(pick_field(5, on(4), "next", 1), { end: true });
  assert.deepEqual(pick_field(5, on(0), "prev", 1), { end: true });
});

test("pick_field from a point between controls counts the next control as the first step", () => {
  const between = (index: number) => ({ index, on_field: false });
  assert.deepEqual(pick_field(5, between(2), "next", 1), { index: 2 });
  assert.deepEqual(pick_field(5, between(2), "next", 2), { index: 3 });
  assert.deepEqual(pick_field(5, between(2), "prev", 1), { index: 1 });
  assert.deepEqual(pick_field(5, between(5), "next", 1), { end: true });
  assert.deepEqual(pick_field(5, between(0), "prev", 1), { end: true });
});

test("place_of takes the first anchor that is in the list", () => {
  const [a, b, c] = [{}, {}, {}] as Element[];
  const never = () => false;
  assert.deepEqual(place_of([a!, b!, c!], [b, c], never), { index: 1, on_field: true });
  assert.deepEqual(place_of([a!, b!, c!], [{} as Element, c], never), { index: 2, on_field: true });
  assert.deepEqual(place_of([a!, b!, c!], [null, undefined], never), { index: 0, on_field: false });
  assert.deepEqual(place_of([a!, b!, c!], [], (element) => element !== c), { index: 2, on_field: false });
  assert.deepEqual(place_of([a!, b!], [], () => true), { index: 2, on_field: false });
});
