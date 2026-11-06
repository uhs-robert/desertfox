import assert from "node:assert/strict";
import { test } from "node:test";
import { word_range_at, element_address, has_usable_address, is_inside_link, is_media, perform, player_box, takes_typing } from "../../src/content/hints/actions.ts";
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
  const images: [string, string][] = [];
  const deps = { open_link: (url: string, place: string) => opened.push([url, place]), copy: (text: string) => copied.push(text), image_action: (action: string, address: string) => images.push([action, address]), start_caret: (_target: unknown, mode: string) => started.push(mode) };
  const run = (action: HintAction) => perform(action, element as never, deps as never);
  return { calls, opened, copied, started, images, run, element };
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
  perform("here", element as never, { open_link: () => {}, copy: () => {}, image_action: () => Promise.resolve(), start_caret: () => {} });
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

test("element_address takes a link's href and refuses script addresses", () => {
  assert.equal(element_address({ localName: "a", href: "JavaScript:alert(1)" } as never), undefined);
  assert.equal(element_address({ localName: "a", href: "" } as never), undefined);
  assert.equal(element_address({ localName: "a", href: "https://a.test/" } as never), "https://a.test/");
});

const img = (extra: Record<string, unknown>) => ({ localName: "img", ...extra }) as never;

test("element_address of an image prefers what the browser loaded, then src, then a lazy attribute", () => {
  assert.equal(element_address(img({ currentSrc: "https://a.test/chosen.avif", src: "https://a.test/a.jpg" })), "https://a.test/chosen.avif");
  assert.equal(element_address(img({ currentSrc: "", src: "https://a.test/a.jpg" })), "https://a.test/a.jpg");
  const lazy = { currentSrc: "", src: "data:image/gif;base64,R0lG", getAttribute: (name: string) => (name === "data-src" ? "https://a.test/real.jpg" : null) };
  assert.equal(element_address(img(lazy)), "https://a.test/real.jpg");
  assert.equal(element_address(img({ currentSrc: "", src: "", getAttribute: () => null })), undefined);
});

test("element_address refuses blob addresses and long inline data, and keeps a short inline image", () => {
  assert.equal(element_address(img({ currentSrc: "blob:https://a.test/1" })), undefined);
  assert.equal(element_address(img({ currentSrc: `data:image/png;base64,${"A".repeat(9000)}` })), undefined);
  assert.equal(element_address(img({ currentSrc: "data:image/png;base64,AAAA" })), "data:image/png;base64,AAAA");
});

test("element_address reads an image button, a media source and, on request, a background", () => {
  assert.equal(element_address({ localName: "input", type: "image", src: "https://a.test/b.png" } as never), "https://a.test/b.png");
  assert.equal(element_address({ localName: "video", currentSrc: "https://a.test/v.mp4" } as never), "https://a.test/v.mp4");
  const box = { localName: "div", ownerDocument: { defaultView: { getComputedStyle: () => ({ backgroundImage: 'linear-gradient(red, blue), url("https://a.test/h.jpg")' }) } } } as never;
  assert.equal(element_address(box), undefined);
  assert.equal(element_address(box, true), "https://a.test/h.jpg");
});

test("a relative lazy attribute resolves against the base URL", () => {
  const lazy = { currentSrc: "", src: "", baseURI: "https://a.test/page/", getAttribute: () => "/img/real.jpg" };
  assert.equal(element_address(img(lazy)), "https://a.test/img/real.jpg");
});

test("a background url keeps a closing parenthesis inside its quotes", () => {
  const box = { localName: "div", ownerDocument: { defaultView: { getComputedStyle: () => ({ backgroundImage: 'url("https://a.test/a_(1).jpg")' }) } } } as never;
  assert.equal(element_address(box, true), "https://a.test/a_(1).jpg");
});

test("under the images filter a background image wins over the href of its link", () => {
  const link = { localName: "a", href: "https://a.test/post", ownerDocument: { defaultView: { getComputedStyle: () => ({ backgroundImage: 'url("https://a.test/h.jpg")' }) } } } as never;
  assert.equal(element_address(link, true), "https://a.test/h.jpg");
  assert.equal(element_address(link), "https://a.test/post");
});

test("a short data image can be copied but not opened", () => {
  const inline = img({ currentSrc: "data:image/png;base64,AAAA" });
  assert.equal(has_usable_address(inline, true, true), false);
  assert.equal(has_usable_address(inline, true, false), true);
});

test("an image inside a link gives its own address, never the link's", () => {
  assert.equal(element_address(img({ currentSrc: "https://a.test/thumb.jpg", parentElement: { href: "https://a.test/post" } })), "https://a.test/thumb.jpg");
});

test("copy and the open actions use the image address", () => {
  const page = fixture("img", { currentSrc: "https://a.test/a.jpg" });
  page.run("copy");
  page.run("tab");
  assert.deepEqual(page.copied, ["https://a.test/a.jpg"]);
  assert.deepEqual(page.opened, [["https://a.test/a.jpg", "tab"]]);
});

test("copy of an image with no web address refuses and copies nothing", () => {
  const page = fixture("img", { currentSrc: "blob:https://a.test/1", textContent: "" });
  assert.deepEqual(page.run("copy"), { ok: false, message: "This element has no web address" });
  assert.deepEqual(page.copied, []);
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
  perform("focus", page.element as never, { open_link: () => {}, copy: () => {}, image_action: () => Promise.resolve(), start_caret: () => {} });
  assert.deepEqual(page.calls.slice(0, 3), ["set tabindex=-1", "focus", "outline 2px solid currentColor"]);
  assert.equal(page.outline.priority, "important");
  context.mock.timers.tick(5000);
  assert.equal(page.outline.value, "");
});

test("focus keeps a tabindex the page set and restores an outline the page set", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const page = box_fixture({ tabindex: "0" });
  page.outline.value = "1px dotted red";
  perform("focus", page.element as never, { open_link: () => {}, copy: () => {}, image_action: () => Promise.resolve(), start_caret: () => {} });
  assert.equal(page.attributes.tabindex, "0");
  context.mock.timers.tick(5000);
  assert.equal(page.outline.value, "1px dotted red");
});

test("focus on a box that is focusable already leaves its tabindex alone", () => {
  const link = box_fixture({});
  Object.assign(link.element, { localName: "a", tabIndex: 0 });
  perform("focus", link.element as never, { open_link: () => {}, copy: () => {}, image_action: () => Promise.resolve(), start_caret: () => {} });
  assert.equal("tabindex" in link.attributes, false);
});

test("focus twice inside the flash still restores the original outline", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const page = box_fixture({});
  page.outline.value = "1px dotted red";
  const deps = { open_link: () => {}, copy: () => {}, image_action: () => Promise.resolve(), start_caret: () => {} };
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

test("play_pause plays a paused media element and pauses a playing one", () => {
  const calls: string[] = [];
  const media = { paused: true, play: () => { calls.push("play"); f.element.paused = false; return Promise.resolve(); }, pause: () => { calls.push("pause"); f.element.paused = true; } };
  const f = fixture("video", media) as ReturnType<typeof fixture> & { element: { paused: boolean } };
  void f.run("play_pause");
  f.run("play_pause");
  assert.deepEqual(calls, ["play", "pause"]);
  assert.deepEqual(f.calls, []);
});

test("mute toggles muted and does not click", () => {
  const f = fixture("audio", { muted: false });
  f.run("mute");
  assert.equal((f.element as unknown as { muted: boolean }).muted, true);
  f.run("mute");
  assert.equal((f.element as unknown as { muted: boolean }).muted, false);
  assert.deepEqual(f.calls, []);
});

test("fullscreen leaves fullscreen when a document element is fullscreen, else shows the player box", () => {
  const entered: string[] = [];
  const box = { id: "box", requestFullscreen: () => { entered.push("box"); return Promise.resolve(); } };
  const doc = { fullscreenElement: null as unknown, exitFullscreen: () => { entered.push("exit"); return Promise.resolve(); } };
  const parent = { ...box, getBoundingClientRect: () => ({ width: 100, height: 40 }), parentElement: null, ownerDocument: { body: {}, documentElement: {} } };
  const f = fixture("video", { ownerDocument: doc, parentElement: parent, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 40 }) });
  void f.run("fullscreen");
  doc.fullscreenElement = parent;
  void f.run("fullscreen");
  assert.deepEqual(entered, ["box", "exit"]);
});

test("player_box climbs to the outermost ancestor of the same size and stops at a bigger one", () => {
  const body = {};
  const doc = { body, documentElement: {} };
  const sized = (width: number, height: number, parentElement: unknown, parentNode: unknown = parentElement) => ({ getBoundingClientRect: () => ({ width, height }), parentElement, parentNode, ownerDocument: doc });
  const page = sized(900, 700, null);
  const outer = sized(320, 180, page);
  const inner = sized(320.5, 180, outer);
  const video = sized(320, 180, inner);
  assert.equal(player_box(video as never), outer);
  assert.equal(player_box(sized(320, 180, page) as never) !== page, true);
});

test("player_box never takes the body, even when it has the size of the video", () => {
  const body = {};
  const doc = { body, documentElement: {} };
  const video = { getBoundingClientRect: () => ({ width: 320, height: 180 }), parentElement: body, parentNode: body, ownerDocument: doc };
  Object.assign(body, { getBoundingClientRect: () => ({ width: 320, height: 180 }), parentElement: null, parentNode: null, ownerDocument: doc });
  assert.equal(player_box(video as never), video);
});

test("player_box steps from a shadow root to its host and keeps checking the size", () => {
  const doc = { body: {}, documentElement: {} };
  const host = { getBoundingClientRect: () => ({ width: 320, height: 180 }), parentElement: null, parentNode: null, ownerDocument: doc };
  const root = { host, parentNode: null };
  const video = { getBoundingClientRect: () => ({ width: 320, height: 180 }), parentElement: null, parentNode: root, ownerDocument: doc };
  assert.equal(player_box(video as never), host);
  const big_host = { ...host, getBoundingClientRect: () => ({ width: 640, height: 360 }) };
  const in_big = { ...video, parentNode: { host: big_host, parentNode: null } };
  assert.equal(player_box(in_big as never), in_big);
});

test("a refused play() or requestFullscreen() comes back as a failed outcome with the browser's message", async () => {
  const refused = () => Promise.reject(new Error("The play method is not allowed"));
  const play = fixture("video", { paused: true, play: refused });
  assert.deepEqual(await play.run("play_pause"), { ok: false, message: "The play method is not allowed" });
  const doc = { fullscreenElement: null, exitFullscreen: refused };
  const box = fixture("video", { ownerDocument: doc, parentElement: null, requestFullscreen: () => Promise.reject(new Error("Fullscreen request denied")), getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }) });
  assert.deepEqual(await box.run("fullscreen"), { ok: false, message: "Fullscreen request denied" });
});

test("the media actions refuse an element that is not media and do nothing else", () => {
  for (const action of ["play_pause", "mute", "fullscreen"] as const) {
    const link = fixture("a", { href: "https://example.com/", paused: true, play: () => assert.fail("played a link") });
    assert.deepEqual(link.run(action), { ok: false, message: "Not a media element" });
    assert.deepEqual(link.calls, []);
    assert.equal((link.element as { muted?: boolean }).muted, undefined);
  }
});

test("is_media knows video and audio", () => {
  assert.equal(is_media({ localName: "video" }), true);
  assert.equal(is_media({ localName: "audio" }), true);
  assert.equal(is_media({ localName: "div" }), false);
});

const frame = (extra: Record<string, unknown> = {}) => fixture("iframe", { src: "https://embed.test/video", ...extra });
const NO_ADDRESS = { ok: false, message: "This element has no web address" };

test("the address of a same-site frame is the page it shows now", () => {
  const page = frame({ contentDocument: { URL: "https://embed.test/moved" } });
  assert.equal(element_address(page.element as never), "https://embed.test/moved");
});

test("the address of a frame from another site is its src, because reading the document throws", () => {
  const page = frame();
  Object.defineProperty(page.element, "contentDocument", { get: () => { throw new Error("cross origin"); } });
  assert.equal(element_address(page.element as never), "https://embed.test/video");
});

test("a srcdoc frame, an about:blank frame and a frame with no src have no address", () => {
  assert.equal(element_address(frame({ getAttribute: () => "<p>x</p>" }).element as never), undefined);
  assert.equal(element_address(frame({ src: "about:blank", contentDocument: { URL: "about:blank" } }).element as never), undefined);
  assert.equal(element_address(frame({ src: "" }).element as never), undefined);
});

test("a same-site frame that still loads shows about:blank, so its src stands in", () => {
  const page = frame({ contentDocument: { URL: "about:blank" } });
  assert.equal(element_address(page.element as never), "https://embed.test/video");
});

test("a frame opens and copies its address, and refuses when it has none", () => {
  const page = frame();
  page.run("tab");
  page.run("copy");
  assert.deepEqual(page.opened, [["https://embed.test/video", "tab"]]);
  assert.deepEqual(page.copied, ["https://embed.test/video"]);
  const blank = frame({ src: "" });
  assert.deepEqual(blank.run("window"), NO_ADDRESS);
  assert.deepEqual(blank.run("copy"), NO_ADDRESS);
  assert.deepEqual(blank.calls, []);
});

test("a frame has no text to copy", () => {
  const page = frame();
  assert.deepEqual(page.run("copy_text"), { ok: false, message: "A frame has no text" });
  assert.deepEqual(page.copied, []);
});

test("focus, hover and delete reach a frame, and here focuses it instead of clicking", () => {
  const page = frame({ tabIndex: 0 });
  page.run("focus");
  page.run("here");
  assert.deepEqual(page.calls, ["focus", "focus"]);
  page.run("delete");
  assert.equal(page.calls.at(-1), "remove");
});

test("focus on a frame also focuses the frame's window, the call that enters a frame of another site", () => {
  const window_focus_calls: string[] = [];
  const page = frame({ tabIndex: 0, contentWindow: { focus: () => window_focus_calls.push("window") } });
  page.run("focus");
  assert.deepEqual(page.calls, ["focus"]);
  assert.deepEqual(window_focus_calls, ["window"]);
});

test("copy_image and download send the picture address to the background", () => {
  const image = fixture("img", { currentSrc: "https://example.com/cat.png", src: "https://example.com/cat.png" });
  image.run("copy_image");
  image.run("download");
  assert.deepEqual(image.images, [["copy_image", "https://example.com/cat.png"], ["download", "https://example.com/cat.png"]]);
});

test("download sends the href of a link", () => {
  const link = fixture("a", { href: "https://example.com/file.zip" });
  link.run("download");
  assert.deepEqual(link.images, [["download", "https://example.com/file.zip"]]);
});

test("copy_image and download refuse an element with no address, and send nothing", () => {
  for (const address of [{}, { currentSrc: "blob:https://example.com/1", src: "blob:https://example.com/1" }, { src: "data:image/png;base64," + "A".repeat(9000) }]) {
    const image = fixture("img", address);
    assert.deepEqual(image.run("copy_image"), { ok: false, message: "This element has no web address" });
    assert.deepEqual(image.run("download"), { ok: false, message: "This element has no web address" });
    assert.deepEqual(image.images, []);
  }
});

const PRESS = ["pointerdown", "mousedown", "focus", "pointerup", "mouseup"];

test("double_click sends two presses with click counts 1 and 2, a click after each, then dblclick", () => {
  const sent: { type: string; detail?: number }[] = [];
  const page = fixture("div", { dispatchEvent: (event: { type: string; detail?: number }) => { sent.push(event); return true; } });
  page.run("double_click");
  assert.deepEqual(sent.map((event) => event.type), ["pointerover", "pointerenter", "mouseover", "pointerdown", "mousedown", "pointerup", "mouseup", "click", "pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick"]);
  assert.deepEqual(sent.filter((event) => /^(mouse(down|up)|click|dblclick)$/.test(event.type)).map((event) => event.detail), [1, 1, 1, 2, 2, 2, 2]);
  assert.deepEqual(sent.filter((event) => event.type.startsWith("pointer")).map((event) => event.detail), Array(6).fill(undefined));
  assert.deepEqual(sent.slice(0, 3).map((event) => event.detail), [undefined, undefined, 0]);
});

test("double_click gives the focus on each press and calls click() never", () => {
  const page = fixture("div", { click: () => page_calls.push("native-click") });
  const page_calls = page.calls;
  page.run("double_click");
  assert.equal(page.calls.filter((call) => call === "focus").length, 2);
  assert.equal(page.calls.filter((call) => call === "click").length, 2);
  assert.equal(page.calls.filter((call) => call === "native-click").length, 0);
});

test("word_range_at finds the word at its start, middle and end, and nothing between non-words", () => {
  const text = "say hello, world";
  assert.deepEqual(word_range_at(text, 4), [4, 9]);
  assert.deepEqual(word_range_at(text, 6), [4, 9]);
  assert.deepEqual(word_range_at(text, 8), [4, 9]);
  assert.deepEqual(word_range_at(text, 3), [0, 3]);
  assert.deepEqual(word_range_at(text, 9), [4, 9]);
  assert.deepEqual(word_range_at(text, 16), [11, 16]);
  assert.equal(word_range_at(text, 10), undefined);
  assert.equal(word_range_at("a  b", 2), undefined);
});

test("double_click selects the word under the middle of a text target and nothing on others", () => {
  const steps: string[] = [];
  const text = { nodeType: 3, data: "say hello  there" };
  const selection = { removeAllRanges: () => steps.push("clear"), addRange: (range: { start: number; end: number }) => steps.push(`add ${range.start} ${range.end}`) };
  Object.assign(globalThis, { Node: { TEXT_NODE: 3 } });
  const document_with = (node: unknown, offset = 4) => ({
    caretPositionFromPoint: (x: number, y: number) => (steps.push(`point ${x} ${y}`), { offsetNode: node, offset }),
    createRange: () => { const range = { start: 0, end: 0, setStart: (_n: unknown, at: number) => { range.start = at; }, setEnd: (_n: unknown, at: number) => { range.end = at; } }; return range; },
    defaultView: { getSelection: () => selection },
  });
  fixture("p", { ownerDocument: document_with(text), contains: (node: unknown) => node === text }).run("double_click");
  assert.deepEqual(steps, ["point 60 40", "clear", "add 4 9"]);
  steps.length = 0;
  fixture("div", { ownerDocument: document_with({ nodeType: 1 }), contains: () => true }).run("double_click");
  fixture("input", { type: "text", ownerDocument: document_with(text), contains: () => true }).run("double_click");
  fixture("p", { ownerDocument: document_with(text), contains: () => false }).run("double_click");
  fixture("p", { ownerDocument: document_with(text, 10), contains: () => true }).run("double_click");
  assert.deepEqual(steps.filter((step) => !step.startsWith("point")), []);
});

test("is_inside_link is true for a link and for its children", () => {
  const node = (matches: boolean, parent: unknown = null, host: unknown = null) => ({ matches: () => matches, parentElement: parent, parentNode: host ? { host } : null });
  assert.equal(is_inside_link(node(true) as never), true);
  assert.equal(is_inside_link(node(false, node(true)) as never), true);
  assert.equal(is_inside_link(node(false, null, node(true)) as never), true);
  assert.equal(is_inside_link(node(false, node(false)) as never), false);
});
