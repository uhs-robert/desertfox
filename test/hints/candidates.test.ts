import assert from "node:assert/strict";
import { test } from "node:test";
import type { Found } from "../../src/content/hints/candidates.ts";
import { keep_text_matches, collect, drop_redundant_weak, keep_visible_deduplicated, has_click_sign, has_own_text, is_every_target, KEEPS_ONE_CHILD, NO_OWN_TEXT, has_text, is_image, is_pickable_frame, make_weak_test, query_for } from "../../src/content/hints/candidates.ts";

type Fake = { name: string; local: string; shadow?: Fake[]; frame?: Fake[] | "cross_origin"; href?: boolean; side?: number };

// A page of fake elements. `matches` answers for the selector the test passes in: "links" means a[href], and the frames filter's selector means iframe and frame.
function root_of(elements: Fake[]): ParentNode {
  const wrap = (fake: Fake) => ({
    name: fake.name,
    localName: fake.local,
    openOrClosedShadowRoot: fake.shadow ? root_of(fake.shadow) : null,
    shadowRoot: null,
    get contentDocument() {
      if (fake.frame === "cross_origin") throw new Error("blocked");
      return fake.frame ? root_of(fake.frame) : null;
    },
    matches: (selector: string) => (selector === "links" && fake.local === "a" && fake.href === true) || (selector === query_for("frames", undefined).selector && (fake.local === "iframe" || fake.local === "frame")),
    getBoundingClientRect: () => ({ width: fake.side ?? 300, height: fake.side ?? 300 }),
    getRootNode: () => ({}),
  });
  return { querySelectorAll: () => elements.map(wrap) } as unknown as ParentNode;
}

const names = (found: { element: Element }[]) => found.map((item) => (item.element as unknown as { name: string }).name);

test("a link in the top document, an open or closed shadow root and a same-origin frame is found", () => {
  const page = root_of([
    { name: "top", local: "a", href: true },
    { name: "plain div", local: "div" },
    { name: "host", local: "div", shadow: [{ name: "in shadow", local: "a", href: true }] },
    { name: "frame", local: "iframe", frame: [{ name: "in frame", local: "a", href: true }] },
  ]);
  assert.deepEqual(names(collect(page, { selector: "links" })), ["top", "in shadow", "in frame"]);
});

test("an element in a frame knows which frames hold it", () => {
  const page = root_of([{ name: "outer", local: "iframe", frame: [{ name: "inner", local: "iframe", frame: [{ name: "deep", local: "a", href: true }] }] }]);
  const [found] = collect(page, { selector: "links" });
  assert.equal(found!.frames.length, 2);
});

test("a cross-origin frame is skipped, not an error", () => {
  const page = root_of([{ name: "ad", local: "iframe", frame: "cross_origin" }, { name: "top", local: "a", href: true }]);
  assert.deepEqual(names(collect(page, { selector: "links" })), ["top"]);
});

test("an empty custom selector finds nothing", () => {
  assert.deepEqual(collect(root_of([{ name: "top", local: "a", href: true }]), query_for("custom", undefined)), []);
});

test("each filter has its own selector", () => {
  assert.equal(query_for("links", undefined).selector, "a[href]");
  assert.match(query_for("inputs", undefined).selector, /textarea/);
  assert.match(query_for("clickable", undefined).selector, /a\[href\]/);
  assert.match(query_for("clickable", undefined).selector, /textarea/);
  assert.match(query_for("all", undefined).selector, /h1/);
  assert.equal(query_for("custom", ".post a").selector, ".post a");
});

test("has_text matches a lower-cased needle in the visible text, ignoring case", () => {
  assert.equal(has_text({ innerText: "Read More", textContent: "" } as never, "more"), true);
  assert.equal(has_text({ textContent: "Read More" } as never, "read"), true);
  assert.equal(has_text({ textContent: "Read" } as never, "more"), false);
  // Hidden text gives an empty innerText, which must not fall back to textContent.
  assert.equal(has_text({ innerText: "", textContent: "Hidden" } as never, "hidden"), false);
});

test("the clickable selector adds roving-tabindex items", () => {
  const clickable = query_for("clickable", undefined).selector;
  assert.match(clickable, /\[role=menuitemcheckbox\]/);
  assert.match(clickable, /\[tabindex]:not\(\[tabindex="-1"]\)/);
});

// A fake page element for the click sign: a tag, a cursor, a parent and attributes.
type Dom = { name: string; local: string; cursor?: string; parent?: Dom; attrs?: Record<string, string>; in_menu?: boolean; plain?: boolean; focus_only?: boolean };
const dom_styles = {
  cursor_of_: (e: Element) => (e as unknown as Dom).cursor ?? "auto",
  parent_of: (e: Element) => ((e as unknown as Dom).parent ?? null) as unknown as Element | null,
};
const el = (d: Dom) =>
  Object.assign(d, {
    localName: d.local,
    hasAttribute: (n: string) => d.attrs?.[n] !== undefined,
    getAttribute: (n: string) => d.attrs?.[n] ?? null,
    matches: (s: string) => (s.includes("a[href]") ? d.plain !== true && !(d.focus_only === true && !s.includes("[tabindex]:not(")) : d.in_menu === true),
    parentNode: d.parent ?? null,
  }) as unknown as Element;

const pointer_card = el({ name: "card", local: "div", cursor: "pointer" });
const card_child = (local: string, extra: Partial<Dom> = {}) => el({ name: "in card", local, cursor: "pointer", parent: pointer_card as unknown as Dom, ...extra });
const plain_parent = { name: "p", local: "div" } as Dom;

test("click sign: what must get a hint and what must not", () => {
  const cases: [string, Element, boolean][] = [
    ["a pointer where it starts", el({ name: "x", local: "div", cursor: "pointer", parent: plain_parent }), true],
    ["a pointer span with no parent", el({ name: "x", local: "span", cursor: "pointer" }), true],
    ["a bare a under a pointer list", card_child("a"), true],
    ["a span inside a pointer card (inherited)", card_child("span"), false],
    ["text inside a pointer card", card_child("b"), false],
    ["a default cursor", el({ name: "x", local: "div", parent: plain_parent }), false],
    ["a disabled pointer", el({ name: "x", local: "button", cursor: "pointer", attrs: { disabled: "" } }), false],
    ["an aria-disabled pointer", el({ name: "x", local: "div", cursor: "pointer", attrs: { "aria-disabled": "true" } }), false],
    ["body with a pointer", el({ name: "x", local: "body", cursor: "pointer" }), false],
  ];
  for (const [label, element, expected] of cases) assert.equal(has_click_sign(element, dom_styles), expected, label);
});

test("a menu item with tabindex -1 is weak even with no cursor", () => {
  const weak = make_weak_test(dom_styles);
  assert.equal(weak(el({ name: "item", local: "li", in_menu: true })), true);
  assert.equal(weak(el({ name: "other", local: "li" })), false);
});

const strong = (element: Element): Found => ({ element, frames: [] });
const weak = (element: Element): Found => ({ element, frames: [], weak: true });
const names_of = (found: Found[]) => found.map((item) => (item.element as unknown as Dom).name);

test("redundant weak candidates are dropped: wrappers of hinted things, and things inside a hinted element", () => {
  const list = el({ name: "ul", local: "ul", cursor: "pointer" });
  const row = (name: string, tag: string) => el({ name, local: tag, parent: list as unknown as Dom });
  const strong_row = row("strong li", "li");
  const strong_link = el({ name: "link", local: "a", parent: strong_row as unknown as Dom });
  const weak_row = row("weak li", "li");
  const weak_link = el({ name: "log out", local: "a", cursor: "pointer", parent: weak_row as unknown as Dom });
  const button = el({ name: "button", local: "button" });
  const inner_span = el({ name: "span in button", local: "span", cursor: "pointer", parent: button as unknown as Dom });
  const lone = el({ name: "lone pointer", local: "div", cursor: "pointer" });
  const kept = drop_redundant_weak([weak(list), weak(strong_row), strong(strong_link), weak(weak_row), weak(weak_link), strong(button), weak(inner_span), weak(lone)]);
  assert.deepEqual(names_of(kept), ["link", "log out", "button", "lone pointer"]);
});

test("Knack dropdown: the href-less Log Out link gets the hint, its li and ul do not", () => {
  const ul = el({ name: "ul", local: "ul" });
  const href_li = el({ name: "li my-info", local: "li", parent: ul as unknown as Dom });
  const href_a = el({ name: "my-info", local: "a", cursor: "pointer", attrs: { href: "#my-info" }, parent: href_li as unknown as Dom });
  const out_li = el({ name: "li logout", local: "li", cursor: "pointer", parent: ul as unknown as Dom });
  const out_a = el({ name: "log out", local: "a", cursor: "pointer", parent: out_li as unknown as Dom });
  const icon = el({ name: "icon", local: "span", cursor: "pointer", parent: out_a as unknown as Dom });
  const weak_test = make_weak_test(dom_styles);
  const page = [ul, href_li, href_a, out_li, out_a, icon];
  const found = page.map((element) => (element === href_a ? strong(element) : weak_test(element) ? weak(element) : undefined)).filter((f): f is Found => f !== undefined);
  assert.deepEqual(names_of(drop_redundant_weak(found)), ["my-info", "log out"]);
});

const plain_li = (parent: Dom) => el({ name: "plain li", local: "li", plain: true, parent });
const knack_log_out = () => {
  const li = plain_li({ name: "ul", local: "ul" });
  const a = el({ name: "log out", local: "a", cursor: "pointer", parent: li as unknown as Dom });
  return { li, a };
};

test("with the all filter a plain li or p around a weak link does not hide it", () => {
  const { li, a } = knack_log_out();
  assert.deepEqual(names_of(drop_redundant_weak([strong(li), weak(a)])), ["plain li", "log out"]);
});

test("with the all filter a plain p inside a weak wrapper does not hide the wrapper", () => {
  const wrapper = el({ name: "pointer card", local: "div", cursor: "pointer" });
  const text = plain_li(wrapper as unknown as Dom);
  assert.deepEqual(names_of(drop_redundant_weak([weak(wrapper), strong(text)])), ["pointer card", "plain li"]);
});

test("a visible wrapper keeps its hint when the clickable child inside it is hidden", () => {
  const wrapper = el({ name: "wrapper", local: "div", cursor: "pointer" });
  const child = el({ name: "hidden button", local: "button", parent: wrapper as unknown as Dom });
  const probe = {
    is_intersecting_: (f: Found) => f.element !== child,
    rects_of_: () => [{ left: 0, top: 0, right: 10, bottom: 10 }],
    clips_of_: () => [],
    viewport_of_: () => ({ width: 100, height: 100 }),
    is_hidden_by_style_: () => false,
    is_reachable_at_: () => true,
  };
  assert.deepEqual(names_of(keep_visible_deduplicated([weak(wrapper), strong(child)], probe)), ["wrapper"]);
});

test("the roving group rule is part of the weak menu selector, so plain-list menus are found", () => {
  const seen: string[] = [];
  make_weak_test(dom_styles)(Object.assign(el({ name: "item", local: "li" }), { matches: (s: string) => (seen.push(s), false) }));
  assert.ok(seen.some((s) => s.includes('[tabindex="0"] ~ [tabindex="-1"]') && s.includes(':has(~ [tabindex="0"])')));
});

test("a focusable ARIA menu does not hide its roving items", () => {
  const menu = el({ name: "menu", local: "ul", focus_only: true });
  const item = (name: string) => el({ name, local: "li", parent: menu as unknown as Dom });
  const [one, two] = [item("one"), item("two")];
  assert.deepEqual(names_of(drop_redundant_weak([strong(menu), weak(one), weak(two)])), ["menu", "one", "two"]);
});

const text_node = (value: string) => ({ nodeType: 3, nodeValue: value });
const with_children = (local: string, children: unknown[], hidden = false) => ({ localName: local, hidden, childNodes: children }) as unknown as Element;

test("prose keeps an element with a text node of its own", () => {
  assert.equal(has_own_text(with_children("span", [text_node("hello")])), true);
  assert.equal(has_own_text(with_children("div", [{ nodeType: 1 }, text_node(" tail ")])), true);
});

test("prose skips a wrapper whose text sits in its children, and blank text", () => {
  assert.equal(has_own_text(with_children("div", [{ nodeType: 1, nodeValue: null }])), false);
  assert.equal(has_own_text(with_children("div", [text_node(" \n\t "), { nodeType: 8, nodeValue: "comment" }])), false);
  assert.equal(has_own_text(with_children("div", [])), false);
});

test("prose skips hidden elements and elements whose text is not page text", () => {
  assert.equal(has_own_text(with_children("span", [text_node("hello")], true)), false);
  for (const local of ["script", "style", "noscript", "template", "textarea", "option"]) assert.equal(has_own_text(with_children(local, [text_node("x")])), false, local);
});

test("prose covers inline, custom and unlisted tags and skips the tags that hold no prose", () => {
  assert.equal(query_for("prose", undefined).selector, "*");
  for (const local of ["b", "i", "small", "time", "summary", "figcaption", "yt-formatted-string"]) assert.equal(has_own_text(with_children(local, [text_node("x")])), true, local);
  for (const local of ["svg", "math", "title", "head", "tspan"]) assert.ok(NO_OWN_TEXT.has(local), local);
});

test("buttons matches button-like elements and skips disabled ones", () => {
  const { selector } = query_for("buttons", undefined);
  for (const part of ["button:not([disabled])", '[role="button"]:not([disabled])', 'input[type="submit"]:not([disabled])', 'input[type="reset"]:not([disabled])', 'input[type="image"]:not([disabled])', 'input[type="button"]:not([disabled])'])
    assert.ok(selector.split(", ").includes(part), part);
  assert.ok(!selector.includes("a[href]") && !selector.includes("textarea"));
});

// A fake element for the every filter: its child count, its own text, its tag and whether it is a link, button or label.
const every_fake = (children: number, options: { text?: string; local?: string; width?: number; height?: number } = {}) =>
  ({
    localName: options.local ?? "div",
    hidden: false,
    children: { length: children },
    childNodes: options.text ? [text_node(options.text)] : [],
    matches: (selector: string) => selector.split(", ").some((part) => part === (options.local ?? "div") || (part === "[role=link]" && options.local === "role_link")),
    getBoundingClientRect: () => ({ width: options.width ?? 100, height: options.height ?? 20 }),
  }) as unknown as Element;

test("every keeps a box with a size and several children, or none", () => {
  assert.equal(query_for("every", undefined).selector, "*");
  assert.equal(is_every_target(every_fake(2)), true);
  assert.equal(is_every_target(every_fake(0)), true);
});

test("every skips a box with no width or no height", () => {
  assert.equal(is_every_target(every_fake(2, { width: 0 })), false);
  assert.equal(is_every_target(every_fake(0, { height: 0 })), false);
});

test("every skips a wrapper of one element and no text of its own, but keeps one with text", () => {
  assert.equal(is_every_target(every_fake(1)), false);
  assert.equal(is_every_target(every_fake(1, { text: "caption" })), true);
});

test("every keeps a link, button or label that wraps one child", () => {
  for (const local of ["a", "button", "label", "role_link"]) assert.equal(is_every_target(every_fake(1, { local })), true, local);
  assert.equal(is_every_target(every_fake(1, { local: "a", width: 0 })), false);
});

test("every keeps the exemptions the clickable selector lists, and skips the page root and body", () => {
  for (const part of ["a", "button", "label", "[role=link]", "[onclick]"]) assert.ok(KEEPS_ONE_CHILD.split(", ").includes(part), part);
  assert.equal(is_every_target(every_fake(2, { local: "html" })), false);
  assert.equal(is_every_target(every_fake(2, { local: "body" })), false);
});

test("the prose filter carries its test and the others carry none", () => {
  assert.equal(query_for("prose", undefined).test, has_own_text);
  for (const filter of ["all", "clickable", "buttons", "inputs", "links"] as const) assert.equal(query_for(filter, undefined).test, undefined, filter);
});

test("collect keeps only the elements that pass the test", () => {
  const page = root_of([{ name: "kept", local: "a", href: true }, { name: "dropped", local: "a", href: true }]);
  const found = collect(page, { selector: "links", test: (element) => (element as unknown as { name: string }).name === "kept" });
  assert.deepEqual(names(found), ["kept"]);
});

test("the media filter takes video and audio", () => {
  assert.equal(query_for("media", undefined).selector, "video, audio");
});

test("the images filter tests every element for a picture", () => {
  const query = query_for("images", undefined);
  assert.equal(query.selector, "*");
  assert.equal(typeof query.test, "function");
});

const sized = (side: number, extra: Record<string, unknown>) =>
  ({ getBoundingClientRect: () => ({ width: side, height: side }), ownerDocument: { defaultView: { getComputedStyle: () => ({ backgroundImage: "none" }) } }, ...extra }) as never;

test("is_image keeps an img and an image button from 24 px, and drops a tracking pixel and a small icon", () => {
  assert.equal(is_image(sized(32, { localName: "img" })), true);
  assert.equal(is_image(sized(24, { localName: "input", type: "image" })), true);
  assert.equal(is_image(sized(1, { localName: "img" })), false);
  assert.equal(is_image(sized(23, { localName: "img" })), false);
});

test("is_image keeps a sized box with a background url, and not inline svg or a plain box", () => {
  const background = { ownerDocument: { defaultView: { getComputedStyle: () => ({ backgroundImage: 'url("https://a.test/h.jpg")' }) } } };
  assert.equal(is_image(sized(200, { localName: "div", ...background })), true);
  assert.equal(is_image(sized(200, { localName: "svg" })), false);
  assert.equal(is_image(sized(200, { localName: "div" })), false);
  assert.equal(is_image(sized(10, { localName: "div", ...background })), false);
});

test("the scrollable filter keeps only the scroll boxes", () => {
  const query = query_for("scrollable", undefined);
  assert.equal(query.selector, "*");
  assert.equal(typeof query.test, "function");
});

test("the scrollable filter leaves out a text field that overflows, because focusing it starts typing", (context) => {
  const global_scope = globalThis as unknown as { getComputedStyle?: unknown };
  global_scope.getComputedStyle = () => ({ overflowX: "visible", overflowY: "auto" });
  context.after(() => delete global_scope.getComputedStyle);
  const owner = { documentElement: {}, body: {} };
  const overflowing = (local: string, extra: Record<string, unknown> = {}) =>
    ({ localName: local, scrollWidth: 100, clientWidth: 100, scrollHeight: 900, clientHeight: 100, ownerDocument: owner, ...extra }) as unknown as Element;
  const { test: is_hit } = query_for("scrollable", undefined);
  assert.equal(is_hit?.(overflowing("div")), true);
  assert.equal(is_hit?.(overflowing("textarea")), false);
  assert.equal(is_hit?.(overflowing("div", { isContentEditable: true })), false);
});

test("text keeps the links whose text holds it", () => {
  const item = (local: string, text: string, href?: string) => ({ element: { localName: local, innerText: text, href } as unknown as Element, frames: [] });
  const found = [item("h2", "Introduction"), item("a", "Intro link", "https://example.com/"), item("a", "Intro without address")];
  assert.deepEqual(keep_text_matches(found, "intro").map((entry) => (entry.element as unknown as { innerText: string }).innerText), ["Intro link"]);
});

test("the frames filter takes iframe and frame elements that pass the size test", () => {
  const query = query_for("frames", undefined);
  assert.equal(query.selector, "iframe, frame");
  assert.equal(typeof query.test, "function");
});

test("is_pickable_frame drops a frame under 24 px, and keeps a frame of any site from 24 px", () => {
  assert.equal(is_pickable_frame(sized(300, { localName: "iframe" })), true);
  assert.equal(is_pickable_frame(sized(24, { localName: "frame" })), true);
  assert.equal(is_pickable_frame(sized(1, { localName: "iframe" })), false);
  assert.equal(is_pickable_frame(sized(23, { localName: "iframe" })), false);
});

test("is_pickable_frame skips the frame of the command line layer", () => {
  const holder = (layer: boolean) => ({ getRootNode: () => ({ host: { hasAttribute: (name: string) => layer && name === "data-desertfox-layer" } }) });
  assert.equal(is_pickable_frame(sized(300, { localName: "iframe", ...holder(true) })), false);
  assert.equal(is_pickable_frame(sized(300, { localName: "iframe", ...holder(false) })), true);
});

test("the frames filter lists a frame of another site without entering it, a frame inside a same-origin frame, and no 10 px frame", () => {
  const page = root_of([
    { name: "embed", local: "iframe", frame: "cross_origin" },
    { name: "pixel", local: "iframe", side: 10, frame: "cross_origin" },
    { name: "same", local: "iframe", frame: [{ name: "nested", local: "frame" }] },
  ]);
  assert.deepEqual(names(collect(page, query_for("frames", undefined))), ["embed", "same", "nested"]);
});
