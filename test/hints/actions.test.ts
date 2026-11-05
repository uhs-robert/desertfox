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
  return { calls, opened, copied, started, run, element };
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

const ENTER = ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"];
const LEAVE = ["pointerout", "pointerleave", "mouseout", "mouseleave"];

test("hover sends the enter events in order, with no click and no focus", async () => {
  const { unhover } = await import("../../src/content/hints/hover.ts");
  unhover();
  const page = fixture("div");
  page.run("hover");
  assert.deepEqual(page.calls, ENTER);
  unhover();
});

test("hover events bubble except enter and leave, and come from the middle", async () => {
  const { hover, unhover } = await import("../../src/content/hints/hover.ts");
  const sent: { type: string; bubbles: boolean; clientX: number; clientY: number }[] = [];
  hover({ localName: "div", click: () => {}, focus: () => {}, remove: () => {}, dispatchEvent: (event: never) => sent.push(event), getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 40 }) } as never);
  unhover();
  for (const event of sent) assert.equal(event.bubbles, !/(enter|leave)$/.test(event.type), event.type);
  assert.deepEqual([sent[0]!.clientX, sent[0]!.clientY], [60, 40]);
});

test("a second hover clears the first exactly once, before its own enter events", async () => {
  const { unhover } = await import("../../src/content/hints/hover.ts");
  const first = fixture("div");
  const second = fixture("div");
  first.run("hover");
  second.run("hover");
  assert.deepEqual(first.calls, [...ENTER, ...LEAVE]);
  assert.deepEqual(second.calls, ENTER);
  unhover();
  unhover();
  assert.deepEqual(second.calls, [...ENTER, ...LEAVE]);
});

test("unhover with nothing hovered sends nothing, and a removed element is dropped without events", async () => {
  const { unhover } = await import("../../src/content/hints/hover.ts");
  unhover();
  const page = fixture("div", { isConnected: true });
  const element = fixture("div", { isConnected: false });
  page.run("hover");
  element.run("hover");
  assert.deepEqual(page.calls, [...ENTER, ...LEAVE]);
  unhover();
  assert.deepEqual(element.calls, ENTER);
});

// Nested fakes: a menu holds an item, and contains() answers for the tree.
function tree() {
  const menu = fixture("div");
  const item = fixture("a", { href: "https://example.com/" });
  const outside = fixture("div");
  Object.assign(menu.element, { parentElement: null });
  Object.assign(item.element, { parentElement: menu.element });
  return { menu, item, outside };
}

const OUT_ONLY = ["pointerout", "mouseout"];

test("hovering an item inside the hovered menu leaves the menu entered", async () => {
  const { unhover } = await import("../../src/content/hints/hover.ts");
  unhover();
  const { menu, item } = tree();
  menu.run("hover");
  const before = menu.calls.length;
  item.run("hover");
  assert.deepEqual(menu.calls.slice(before), OUT_ONLY);
  assert.deepEqual(item.calls.filter((type) => type === "mouseenter" || type === "pointerenter"), ["pointerenter", "mouseenter"]);
  unhover();
  assert.deepEqual(item.calls.slice(-4), LEAVE);
});

test("hovering an item inside the menu enters the item and not the menu again", async () => {
  const { unhover } = await import("../../src/content/hints/hover.ts");
  unhover();
  const { menu, item } = tree();
  menu.run("hover");
  item.run("hover");
  assert.equal(menu.calls.filter((type) => type === "mouseenter").length, 1);
  unhover();
});

test("a click pick inside the hovered menu leaves the menu entered, then clicks", async () => {
  const { unhover } = await import("../../src/content/hints/hover.ts");
  unhover();
  const { menu, item } = tree();
  menu.run("hover");
  const before = menu.calls.length;
  item.run("here");
  assert.deepEqual(menu.calls.slice(before), OUT_ONLY);
  assert.equal(item.calls.at(-1), "click");
});

test("after a pick inside the hovered menu, Escape still closes the menu", async () => {
  const { unhover } = await import("../../src/content/hints/hover.ts");
  unhover();
  const { menu, item } = tree();
  menu.run("hover");
  item.run("here");
  const before = menu.calls.length;
  unhover();
  assert.deepEqual(menu.calls.slice(before), ["pointerleave", "mouseleave"]);
});

test("a click pick outside the hovered element leaves it fully, before the click", async () => {
  const { unhover } = await import("../../src/content/hints/hover.ts");
  unhover();
  const { menu, outside } = tree();
  menu.run("hover");
  outside.run("here");
  assert.deepEqual(menu.calls, [...ENTER, ...LEAVE]);
  unhover();
  assert.deepEqual(menu.calls, [...ENTER, ...LEAVE]);
});

test("the leave events name the element the pointer goes to", async () => {
  const { hover, unhover } = await import("../../src/content/hints/hover.ts");
  unhover();
  const sent: { type: string; relatedTarget: unknown }[] = [];
  const make = () => ({ localName: "div", click: () => {}, focus: () => {}, remove: () => {}, dispatchEvent: (event: never) => sent.push(event) });
  const one = make();
  const two = make();
  hover(one as never);
  hover(two as never);
  assert.equal(sent.find((event) => event.type === "mouseout")!.relatedTarget, two);
  assert.equal(sent.filter((event) => event.type === "mouseover").at(-1)!.relatedTarget, one);
  unhover();
});

test("the tab listener goes on once and a hidden tab clears the hover", async () => {
  const { hover, unhover } = await import("../../src/content/hints/hover.ts");
  unhover();
  const listeners: (() => void)[] = [];
  const fake_document = { hidden: false, addEventListener: (_type: string, listener: () => void) => void listeners.push(listener) };
  Object.assign(globalThis, { document: fake_document });
  const page = fixture("div");
  try {
    hover(page.element as never);
    hover(page.element as never);
    assert.equal(listeners.length, 1);
    fake_document.hidden = true;
    const before = page.calls.length;
    listeners[0]!();
    assert.deepEqual(page.calls.slice(before), LEAVE);
  } finally {
    delete (globalThis as Record<string, unknown>).document;
    unhover();
  }
});

test("a move from a shadow host to an item inside its shadow root keeps the host entered", async () => {
  const { unhover } = await import("../../src/content/hints/hover.ts");
  unhover();
  const host = fixture("div");
  const inner = fixture("div");
  Object.assign(inner.element, { parentElement: null, getRootNode: () => ({ host: host.element }) });
  host.run("hover");
  const before = host.calls.length;
  inner.run("hover");
  assert.deepEqual(host.calls.slice(before), OUT_ONLY);
  unhover();
  assert.deepEqual(host.calls.slice(before + 2), ["pointerleave", "mouseleave"]);
});

test("every event of one move shares the point, whatever box its element has", async () => {
  const { hover, unhover } = await import("../../src/content/hints/hover.ts");
  unhover();
  const sent: { type: string; clientX: number; clientY: number }[] = [];
  const make = (box: { left: number; top: number; width: number; height: number }, parent?: unknown) => ({ localName: "div", click: () => {}, focus: () => {}, remove: () => {}, parentElement: parent ?? null, dispatchEvent: (event: never) => sent.push(event), getBoundingClientRect: () => box });
  const wide = make({ left: 0, top: 0, width: 1000, height: 1000 });
  const small = make({ left: 10, top: 10, width: 20, height: 20 }, wide);
  const other = make({ left: 500, top: 500, width: 10, height: 10 });
  hover(small as never);
  const entered = sent.splice(0);
  assert.deepEqual(new Set(entered.map((event) => `${event.clientX},${event.clientY}`)), new Set(["20,20"]));
  hover(other as never);
  const left = sent.filter((event) => event.type.endsWith("out") || event.type.endsWith("leave"));
  const entered_other = sent.filter((event) => !left.includes(event));
  assert.deepEqual(new Set(left.map((event) => `${event.clientX},${event.clientY}`)), new Set(["20,20"]));
  assert.deepEqual(new Set(entered_other.map((event) => `${event.clientX},${event.clientY}`)), new Set(["505,505"]));
  unhover();
});

test("hovering the element that is already hovered sends nothing", async () => {
  const { unhover } = await import("../../src/content/hints/hover.ts");
  unhover();
  const page = fixture("div");
  page.run("hover");
  page.run("hover");
  assert.deepEqual(page.calls, ENTER);
  unhover();
  assert.deepEqual(page.calls, [...ENTER, ...LEAVE]);
});

test("enter and leave events stay inside their shadow tree, the others cross it", async () => {
  const { hover, unhover } = await import("../../src/content/hints/hover.ts");
  unhover();
  const sent: { type: string; composed: boolean }[] = [];
  hover({ localName: "div", click: () => {}, focus: () => {}, remove: () => {}, dispatchEvent: (event: never) => sent.push(event) } as never);
  unhover();
  for (const event of sent) assert.equal(event.composed, !/(enter|leave)$/.test(event.type), event.type);
  assert.ok(sent.some((event) => event.type === "mouseover" && event.composed));
});

test("scroll puts the element at the top of the view and does nothing else to it", () => {
  const scrolls: unknown[] = [];
  const page = fixture("h2", { scrollIntoView: (options: unknown) => scrolls.push(options), setAttribute: () => page.calls.push("setAttribute") });
  page.run("scroll");
  assert.deepEqual(scrolls, [{ block: "start", behavior: "instant" }]);
  assert.deepEqual(page.calls, []);
});

test("scroll also scrolls each frame that holds the element, innermost first, so the top view follows", () => {
  const scrolls: string[] = [];
  const at = (name: string) => ({ scrollIntoView: () => scrolls.push(name) });
  const page = fixture("h2", at("heading"));
  perform("scroll", page.element as never, { open_link: () => {}, copy: () => {}, start_caret: () => {} }, [at("outer") as never, at("inner") as never]);
  assert.deepEqual(scrolls, ["heading", "inner", "outer"]);
});
