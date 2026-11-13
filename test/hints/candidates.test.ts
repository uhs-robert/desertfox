import assert from "node:assert/strict";
import { test } from "node:test";
import type { Found } from "../../src/content/hints/candidates.ts";
import { text_of, keep_text_matches, collect, drop_off_screen, drop_redundant_weak, keep_visible_deduplicated, has_click_sign, is_rect_off_screen, has_own_text, is_draggable, is_swipeable, is_every_target, KEEPS_ONE_CHILD, NO_OWN_TEXT, has_text, is_image, is_pickable_frame, make_weak_test, query_for, with_site_selectors } from "../../src/content/hints/candidates.ts";

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

// A fake page with real rects: each fake has a box, and each root has its own window size, so the walk can judge what is in view.
type Placed = { name: string; local: string; top?: number; left?: number; side?: number; href?: boolean; shadow?: Placed[]; frame?: Placed[]; frame_view?: { clientWidth: number; clientHeight: number } };
function placed_root(elements: Placed[], view = { clientWidth: 100, clientHeight: 50 }): ParentNode {
  const wrap = (fake: Placed) => {
    const side = fake.side ?? 10;
    const left = fake.left ?? 0;
    const top = fake.top ?? 0;
    return {
      name: fake.name,
      localName: fake.local,
      openOrClosedShadowRoot: fake.shadow ? placed_root(fake.shadow, view) : null,
      shadowRoot: null,
      get contentDocument() {
        return fake.frame ? placed_root(fake.frame, fake.frame_view ?? view) : null;
      },
      matches: (selector: string) => selector === "links" && fake.local === "a" && fake.href === true,
      getBoundingClientRect: () => ({ left, top, width: side, height: side, right: left + side, bottom: top + side }),
    };
  };
  return { querySelectorAll: () => elements.map(wrap), compatMode: "CSS1Compat", documentElement: view, body: null, defaultView: { innerWidth: view.clientWidth, innerHeight: view.clientHeight } } as unknown as ParentNode;
}

test("the walk with only_in_view skips an off-screen element before matches and the weak test", () => {
  const tested: string[] = [];
  const page = placed_root([{ name: "below", local: "a", href: true, top: 900 }, { name: "shown", local: "a", href: true }, { name: "empty far away", local: "a", href: true, top: 900, side: 0 }]);
  const found = collect(page, { selector: "links" }, (e) => (tested.push((e as unknown as { name: string }).name), false), true);
  assert.deepEqual(names(found), ["shown", "empty far away"]);
  assert.deepEqual(tested, []);
  assert.deepEqual(names(collect(page, { selector: "links" })), ["below", "shown", "empty far away"]);
});

test("an off-screen frame element is not entered, an on-screen one is", () => {
  const inner = [{ name: "inside", local: "a", href: true }];
  const page = placed_root([
    { name: "far frame", local: "iframe", top: 900, frame: inner },
    { name: "near frame", local: "iframe", frame: inner },
  ]);
  assert.deepEqual(names(collect(page, { selector: "links" }, undefined, true)), ["inside"]);
  assert.equal(collect(page, { selector: "links" }).length, 2);
});

test("an off-screen shadow host is not a candidate, but its shadow content in view is", () => {
  const page = placed_root([{ name: "far host", local: "a", href: true, top: 900, shadow: [{ name: "fixed in view", local: "a", href: true }, { name: "far inside", local: "a", href: true, top: 900 }] }]);
  assert.deepEqual(names(collect(page, { selector: "links" }, undefined, true)), ["fixed in view"]);
});

test("an off-screen parent does not hide an on-screen child of it", () => {
  const page = placed_root([{ name: "tall parent", local: "div", top: 900 }, { name: "positioned child", local: "a", href: true, top: 5 }]);
  assert.deepEqual(names(collect(page, { selector: "links" }, undefined, true)), ["positioned child"]);
});

test("a frame is judged by its own window, not the top one", () => {
  const link = [{ name: "at 150", local: "a", href: true, left: 150 }];
  const wide = placed_root([{ name: "wide frame", local: "iframe", frame: link, frame_view: { clientWidth: 300, clientHeight: 50 } }]);
  assert.deepEqual(names(collect(wide, { selector: "links" }, undefined, true)), ["at 150"], "inside the wide frame, outside the 100 px top window");
  const narrow = placed_root([{ name: "narrow frame", local: "iframe", frame: link, frame_view: { clientWidth: 100, clientHeight: 50 } }], { clientWidth: 400, clientHeight: 50 });
  assert.deepEqual(names(collect(narrow, { selector: "links" }, undefined, true)), [], "outside the narrow frame, inside the 400 px top window");
});

test("a page with only off-screen candidates collects nothing, and the full walk still sees them", () => {
  const page = placed_root([{ name: "a", local: "a", href: true, top: 500 }, { name: "b", local: "a", href: true, left: 500 }]);
  assert.deepEqual(collect(page, { selector: "links" }, undefined, true), []);
  assert.equal(collect(page, { selector: "links" }).length, 2);
});

test("hint_add matches take the view cut too, so off-screen ones never reach the observer", () => {
  const page = placed_root([{ name: "near", local: "a", href: true }, { name: "far", local: "a", href: true, top: 900 }]);
  const sites = { add: ["links"], remove: [] };
  assert.deepEqual(names(with_site_selectors(page, "clickable", [], sites, true)), ["near"]);
  assert.deepEqual(names(with_site_selectors(page, "clickable", [], sites)), ["near", "far"]);
});

test("the weak test makes no style read for what collect already dropped", () => {
  const reads: string[] = [];
  const counting = { ...dom_styles, cursor_of_: (e: Element) => (reads.push((e as unknown as Dom).name), dom_styles.cursor_of_(e)) };
  assert.equal(make_weak_test(counting)(el({ name: "shown", local: "div", cursor: "pointer" })), true);
  assert.deepEqual(reads, ["shown"]);
});

test("the off-screen rule: empty boxes stay, each edge rejects, a box just inside stays", () => {
  const box = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height });
  const off = (rect: ReturnType<typeof box>) => is_rect_off_screen(rect, 100, 50);
  assert.equal(off(box(500, 500, 0, 0)), false, "empty on both axes");
  assert.equal(off(box(500, 500, 0, 10)), false, "zero width");
  assert.equal(off(box(500, 500, 10, 0)), false, "zero height");
  assert.equal(off(box(-20, 10, 10, 10)), true, "left of the window");
  assert.equal(off(box(10, -20, 10, 10)), true, "above the window");
  assert.equal(off(box(101, 10, 10, 10)), true, "right of the window");
  assert.equal(off(box(10, 51, 10, 10)), true, "below the window");
  assert.equal(off(box(-9, 10, 10, 10)), false, "one pixel inside on the left");
  assert.equal(off(box(100, 50, 10, 10)), false, "touching the right and bottom edge");
});

// An element whose rect is read in its own window: a frame's element is judged by the frame's size, not the top window's.
const placed = (name: string, rect: { left: number; top: number; width: number; height: number }, window_size = { innerWidth: 100, innerHeight: 50 }): Found => {
  const element = { name, ownerDocument: { compatMode: "CSS1Compat", documentElement: { clientWidth: window_size.innerWidth, clientHeight: window_size.innerHeight }, body: null, defaultView: window_size }, getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }) };
  return { element: element as unknown as Element, frames: [] };
};

test("pruning drops the off-screen boxes before the costly tests and keeps every box that may show", () => {
  const found = [
    placed("below", { left: 10, top: 900, width: 10, height: 10 }),
    placed("in view", { left: 10, top: 10, width: 10, height: 10 }),
    placed("fixed bar in view", { left: 0, top: 0, width: 100, height: 20 }),
    placed("half above the top", { left: 10, top: -5, width: 10, height: 10 }),
    placed("below the view, so dropped even inside a scroll box", { left: 10, top: 60, width: 10, height: 10 }),
    placed("zero size far away", { left: 500, top: 500, width: 0, height: 0 }),
    placed("display contents far away", { left: 0, top: 0, width: 0, height: 0 }),
    placed("right of the view", { left: 120, top: 10, width: 10, height: 10 }),
  ];
  assert.deepEqual(names(drop_off_screen(found)), ["in view", "fixed bar in view", "half above the top", "zero size far away", "display contents far away"]);
});

test("pruning uses the window of the element, so a frame's box is judged by the frame's size", () => {
  const rect = { left: 150, top: 10, width: 10, height: 10 };
  const found = [placed("in a wide frame", rect, { innerWidth: 300, innerHeight: 50 }), placed("in the narrow top window", rect)];
  assert.deepEqual(names(drop_off_screen(found)), ["in a wide frame"]);
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

test("the draggable filter keeps explicit drag signs and grab cursors where they start, and no plain link, image or button", (context) => {
  const global_scope = globalThis as unknown as { getComputedStyle?: unknown };
  const cursors = new Map<unknown, string>();
  const touch_none = new Set<unknown>();
  global_scope.getComputedStyle = (element: unknown) => ({ cursor: cursors.get(element) ?? "auto", touchAction: touch_none.has(element) ? "none" : "auto" });
  context.after(() => delete global_scope.getComputedStyle);
  const draggable_selector = query_for("draggable", undefined).selector;
  assert.equal(draggable_selector, "*");
  const fake = (local: string, signs: boolean, parent: Element | null = null) => {
    const element = { localName: local, parentElement: parent, ownerDocument: { defaultView: globalThis }, matches: () => signs } as unknown as Element;
    return element;
  };
  assert.equal(is_draggable(fake("div", true)), true);
  assert.equal(is_draggable(fake("a", false)), false);
  assert.equal(is_draggable(fake("img", false)), false);
  assert.equal(is_draggable(fake("button", false)), false);
  const card = fake("div", false);
  cursors.set(card, "grab");
  assert.equal(is_draggable(card), true);
  const inside = fake("span", false, card);
  cursors.set(inside, "grab");
  assert.equal(is_draggable(inside), false);
  const pointer = fake("div", false);
  cursors.set(pointer, "pointer");
  assert.equal(is_draggable(pointer), false);
  assert.equal(is_draggable(fake("body", true)), false);
  for (const direction of ["n", "s", "e", "w", "ne", "nw", "se", "sw", "ew", "ns", "col", "row", "nwse", "nesw"]) {
    const resizer = fake("div", false);
    cursors.set(resizer, `${direction}-resize`);
    assert.equal(is_draggable(resizer), true, direction);
  }
  const pointer_card = fake("div", false);
  touch_none.add(pointer_card);
  assert.equal(is_draggable(pointer_card), true);
});

test("the swipeable filter keeps carousel containers, scroll-snap boxes and what a drag moves, and no plain box or page root", (context) => {
  const global_scope = globalThis as unknown as { getComputedStyle?: unknown };
  const snaps = new Set<unknown>();
  global_scope.getComputedStyle = (element: unknown) => ({ cursor: "auto", touchAction: "auto", scrollSnapType: snaps.has(element) ? "x mandatory" : "none" });
  context.after(() => delete global_scope.getComputedStyle);
  assert.equal(query_for("swipeable", undefined).selector, "*");
  const fake = (local: string, matching: string) => ({ localName: local, parentElement: null, ownerDocument: { defaultView: globalThis }, matches: (selector: string) => selector.includes(matching) }) as unknown as Element;
  assert.equal(is_swipeable(fake("div", ".swiper")), true);
  assert.equal(is_swipeable(fake("div", ".splide")), true);
  assert.equal(is_swipeable(fake("div", "[draggable")), true);
  const snap = fake("div", "none");
  snaps.add(snap);
  assert.equal(is_swipeable(snap), true);
  assert.equal(is_swipeable(fake("div", "none")), false);
  const root = fake("body", ".swiper");
  snaps.add(root);
  assert.equal(is_swipeable(root), false);
});

test("hint_add matches are added for the draggable filter too", () => {
  const page = placed_root([{ name: "handle", local: "a", href: true }]);
  assert.deepEqual(names(with_site_selectors(page, "draggable", [], { add: ["links"], remove: [] })), ["handle"]);
  assert.deepEqual(names(with_site_selectors(page, "links", [], { add: ["links"], remove: [] })), []);
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

type TextFake = { local?: string; type?: string; innerText?: string; textContent?: string; attrs?: Record<string, string>; image_alt?: string; value?: unknown };
const text_fake = (fake: TextFake) =>
  ({
    localName: fake.local ?? "a",
    type: fake.type,
    innerText: fake.innerText,
    textContent: fake.textContent,
    value: fake.value,
    getAttribute: (name: string) => fake.attrs?.[name] ?? null,
    querySelector: () => (fake.image_alt === undefined ? null : { getAttribute: () => fake.image_alt }),
  }) as unknown as Element;

test("text_of reads the visible text first, with whitespace squeezed", () => {
  assert.equal(text_of(text_fake({ innerText: "  Read \n  more ", attrs: { "aria-label": "other" } })), "Read more");
});

test("text_of falls back to aria-label, title, a picture's alt, then an input value", () => {
  assert.equal(text_of(text_fake({ innerText: "", attrs: { "aria-label": "Close", title: "t" } })), "Close");
  assert.equal(text_of(text_fake({ innerText: " ", attrs: { title: "Tip" }, image_alt: "alt" })), "Tip");
  assert.equal(text_of(text_fake({ innerText: "", image_alt: "Logo" })), "Logo");
  assert.equal(text_of(text_fake({ local: "input", innerText: "", value: "Send" })), "Send");
});

test("text_of uses textContent when innerText is missing, ignores a numeric value, and clips a long text", () => {
  assert.equal(text_of(text_fake({ textContent: "plain" })), "plain");
  assert.equal(text_of(text_fake({ innerText: "", value: 0 })), "");
  assert.equal(text_of(text_fake({ local: "button", innerText: "", value: "form data" })), "");
  assert.equal(text_of(text_fake({ local: "input", type: "password", innerText: "", value: "hunter2" })), "");
  assert.equal(text_of(text_fake({ innerText: "x".repeat(1000) })).length, 400);
});

// Elements that match a selector list of `.class` entries by their classes, and find `closest` through their parents.
type Classed = { name: string; classes: string[]; parent?: Classed };
function classed_page(fakes: Classed[]): { root: ParentNode; element: (name: string) => Element } {
  const elements = new Map<Classed, Element>();
  const has_any = (fake: Classed, selector: string) => selector.split(", ").some((entry) => fake.classes.includes(entry.slice(1)));
  for (const fake of fakes) {
    elements.set(fake, {
      name: fake.name,
      localName: "div",
      openOrClosedShadowRoot: null,
      matches: (selector: string) => has_any(fake, selector),
      closest: (selector: string) => {
        for (let up: Classed | undefined = fake; up; up = up.parent) if (has_any(up, selector)) return elements.get(up)!;
        return null;
      },
    } as unknown as Element);
  }
  return { root: { querySelectorAll: () => [...elements.values()] } as unknown as ParentNode, element: (name) => [...elements.entries()].find(([fake]) => fake.name === name)![1] };
}

test("hint_add labels its matches for all, clickable and every, once each, and not for a filter that promises an address", () => {
  const nav = { name: "nav", classes: ["nav"] };
  const { root, element } = classed_page([nav, { name: "tile", classes: ["tile"] }, { name: "link in nav", classes: ["tile"], parent: nav }]);
  const base: Found[] = [strong(element("link in nav"))];
  const selectors = { add: [".tile"], remove: [] };
  assert.deepEqual(names(with_site_selectors(root, "all", base, selectors)), ["tile", "link in nav"]);
  assert.equal(with_site_selectors(root, "every", base, selectors).length, 2);
  assert.equal(with_site_selectors(root, "clickable", base, selectors).length, 2);
  for (const filter of ["links", "images", "inputs", "buttons", "custom"] as const) assert.deepEqual(names(with_site_selectors(root, filter, base, selectors)), ["link in nav"], filter);
});

test("hint_remove drops a candidate inside a match for every filter but custom, an added one too", () => {
  const nav = { name: "nav", classes: ["nav"] };
  const { root, element } = classed_page([nav, { name: "tile", classes: ["tile"] }, { name: "link in nav", classes: ["tile"], parent: nav }]);
  const base: Found[] = [strong(element("link in nav")), strong(element("nav"))];
  const selectors = { add: [".tile"], remove: [".nav"] };
  assert.deepEqual(names(with_site_selectors(root, "all", base, selectors)), ["tile"]);
  assert.deepEqual(names(with_site_selectors(root, "links", base, selectors)), []);
  assert.deepEqual(names(with_site_selectors(root, "custom", base, selectors)), ["link in nav", "nav"]);
});

test("an added element inside a pointer wrapper takes the hint from the wrapper", () => {
  const wrapper = el({ name: "wrapper", local: "div", cursor: "pointer" });
  const inner = el({ name: "added", local: "span", plain: true, parent: wrapper as unknown as Dom });
  assert.deepEqual(names_of(drop_redundant_weak([weak(wrapper), { element: inner, frames: [], added: true }])), ["added"]);
  assert.deepEqual(names_of(drop_redundant_weak([weak(wrapper), strong(inner)])), ["wrapper", "added"]);
});
