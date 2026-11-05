import assert from "node:assert/strict";
import { test } from "node:test";
import { link_address, perform, takes_typing } from "../../src/content/hints/actions.ts";
import type { HintAction } from "../../src/content/hints/actions.ts";

// Node has no DOM events. The fakes only need the type and the position.
class FakeMouseEvent {
  type: string;
  constructor(type: string, init: { clientX?: number; clientY?: number; button?: number } = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}
Object.assign(globalThis, { MouseEvent: FakeMouseEvent, PointerEvent: FakeMouseEvent });

function fixture(local: string, extra: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const element = { localName: local, click: () => calls.push("click"), focus: () => calls.push("focus"), remove: () => calls.push("remove"), dispatchEvent: (event: { type: string }) => { calls.push(event.type); return !(extra.cancel as string[] | undefined)?.includes(event.type); }, getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 40 }), ...extra };
  const opened: [string, string][] = [];
  const copied: string[] = [];
  const started: string[] = [];
  const deps = { open_link: (url: string, place: string) => opened.push([url, place]), copy: (text: string) => copied.push(text), start_caret: (_target: unknown, mode: string) => started.push(mode) };
  const run = (action: HintAction) => perform(action, element as never, deps as never);
  return { calls, opened, copied, started, run };
}

const MOUSE_SEQUENCE = ["pointerover", "pointerenter", "mouseover", "pointerdown", "mousedown", "focus", "pointerup", "mouseup", "click"];

test("here sends the mouse events a real click sends, with click last", () => {
  const page = fixture("a", { href: "https://example.com/" });
  page.run("here");
  assert.deepEqual(page.calls, MOUSE_SEQUENCE);
  assert.deepEqual(page.opened, []);
});

test("a cancelled mousedown keeps the focus where the page put it", () => {
  const page = fixture("a", { href: "https://example.com/", cancel: ["mousedown"] });
  page.run("here");
  assert.deepEqual(page.calls, MOUSE_SEQUENCE.filter((type) => type !== "focus"));
});

test("a cancelled pointerdown skips mousedown, mouseup and focus and still clicks", () => {
  const page = fixture("a", { href: "https://example.com/", cancel: ["pointerdown"] });
  page.run("here");
  assert.deepEqual(page.calls, ["pointerover", "pointerenter", "mouseover", "pointerdown", "pointerup", "click"]);
});

test("here sends the mouse events from the middle of the element", () => {
  const sent: { type: string; clientX?: number; clientY?: number; button?: number }[] = [];
  const element = { localName: "div", click: () => {}, focus: () => {}, remove: () => {}, dispatchEvent: (event: never) => sent.push(event), getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 40 }) };
  perform("here", element as never, { open_link: () => {}, copy: () => {}, start_caret: () => {} });
  const down = sent.find((event) => event.type === "mousedown");
  assert.deepEqual([down?.clientX, down?.clientY, down?.button], [60, 40, 0]);
});

test("here clicks a link", () => {
  const page = fixture("a", { href: "https://example.com/" });
  page.run("here");
  assert.equal(page.calls.at(-1), "click");
  assert.deepEqual(page.opened, []);
});

test("tab, background and window open the address in that place", () => {
  for (const place of ["tab", "background", "window"] as const) {
    const page = fixture("a", { href: "https://example.com/x" });
    page.run(place);
    assert.deepEqual(page.opened, [["https://example.com/x", place]]);
    assert.deepEqual(page.calls, []);
  }
});

test("an element with no usable address is clicked instead of opened", () => {
  const page = fixture("button");
  page.run("tab");
  assert.deepEqual(page.calls, MOUSE_SEQUENCE);
  const script = fixture("a", { href: "javascript:void(0)" });
  script.run("background");
  assert.deepEqual(script.opened, []);
});

test("here focuses a text field and clicks a checkbox", () => {
  const text = fixture("input", { type: "text" });
  text.run("here");
  assert.deepEqual(text.calls, ["focus"]);
  const box = fixture("input", { type: "checkbox" });
  box.run("here");
  assert.deepEqual(box.calls, MOUSE_SEQUENCE);
});

test("focus focuses and delete removes", () => {
  const page = fixture("div");
  page.run("focus");
  page.run("delete");
  assert.deepEqual(page.calls, ["focus", "remove"]);
});

test("takes_typing knows fields from buttons", () => {
  assert.equal(takes_typing({ localName: "textarea" } as never), true);
  assert.equal(takes_typing({ localName: "select" } as never), true);
  assert.equal(takes_typing({ localName: "div", isContentEditable: true } as never), true);
  assert.equal(takes_typing({ localName: "input", type: "submit" } as never), false);
  assert.equal(takes_typing({ localName: "a" } as never), false);
});

test("link_address refuses script addresses", () => {
  assert.equal(link_address({ href: "JavaScript:alert(1)" } as never), undefined);
  assert.equal(link_address({ href: "" } as never), undefined);
  assert.equal(link_address({ href: "https://a.test/" } as never), "https://a.test/");
});

test("copy writes the link address and copy_text writes the text", () => {
  const link = fixture("a", { href: "https://a.test/x", textContent: "  A link " });
  link.run("copy");
  link.run("copy_text");
  assert.deepEqual(link.copied, ["https://a.test/x", "A link"]);
  assert.deepEqual(link.calls, []);
});

test("copy falls back to the text for an element with no address", () => {
  const heading = fixture("h1", { textContent: "Title" });
  heading.run("copy");
  assert.deepEqual(heading.copied, ["Title"]);
});

test("caret and visual hand the element to the caret start and do nothing else", () => {
  for (const mode of ["caret", "visual"] as const) {
    const page = fixture("p");
    page.run(mode);
    assert.deepEqual(page.started, [mode]);
    assert.deepEqual(page.calls, []);
  }
  for (const action of ["here", "tab", "copy", "copy_text", "delete", "focus"] as const) {
    const page = fixture("a", { href: "https://example.com/" });
    page.run(action);
    assert.deepEqual(page.started, []);
  }
});

function box_fixture(attributes: Record<string, string>) {
  const calls: string[] = [];
  const outline = { value: "", priority: "" };
  const style = {
    getPropertyValue: () => outline.value,
    getPropertyPriority: () => outline.priority,
    setProperty: (_name: string, value: string, priority = "") => { outline.value = value; outline.priority = priority; calls.push(`outline ${value}`); },
  };
  const element = {
    localName: "div",
    click: () => {},
    remove: () => {},
    focus: () => calls.push("focus"),
    tabIndex: Number(attributes.tabindex ?? -1),
    setAttribute: (name: string, value: string) => { attributes[name] = value; calls.push(`set ${name}=${value}`); },
    style,
  };
  return { element, calls, outline, attributes };
}

test("focus gives a box without tabindex tabindex=-1 before it focuses, and flashes an outline that then goes away", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const page = box_fixture({});
  perform("focus", page.element as never, { open_link: () => {}, copy: () => {}, start_caret: () => {} });
  assert.deepEqual(page.calls.slice(0, 3), ["set tabindex=-1", "focus", "outline 2px solid currentColor"]);
  assert.equal(page.outline.priority, "important");
  context.mock.timers.tick(5000);
  assert.equal(page.outline.value, "");
});

test("focus keeps a tabindex the page set and restores an outline the page set", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const page = box_fixture({ tabindex: "0" });
  page.outline.value = "1px dotted red";
  perform("focus", page.element as never, { open_link: () => {}, copy: () => {}, start_caret: () => {} });
  assert.equal(page.attributes.tabindex, "0");
  context.mock.timers.tick(5000);
  assert.equal(page.outline.value, "1px dotted red");
});

test("focus on a box that is focusable already leaves its tabindex alone", () => {
  const link = box_fixture({});
  Object.assign(link.element, { localName: "a", tabIndex: 0 });
  perform("focus", link.element as never, { open_link: () => {}, copy: () => {}, start_caret: () => {} });
  assert.equal("tabindex" in link.attributes, false);
});

test("focus twice inside the flash still restores the original outline", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const page = box_fixture({});
  page.outline.value = "1px dotted red";
  const deps = { open_link: () => {}, copy: () => {}, start_caret: () => {} };
  perform("focus", page.element as never, deps);
  context.mock.timers.tick(300);
  perform("focus", page.element as never, deps);
  context.mock.timers.tick(5000);
  assert.equal(page.outline.value, "1px dotted red");
});
