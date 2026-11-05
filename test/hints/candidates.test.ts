import assert from "node:assert/strict";
import { test } from "node:test";
import type { Found } from "../../src/content/hints/candidates.ts";
import { collect, drop_redundant_weak, keep_visible_deduplicated, has_click_sign, has_text, make_weak_test, selector_for } from "../../src/content/hints/candidates.ts";

type Fake = { name: string; local: string; shadow?: Fake[]; frame?: Fake[] | "cross_origin"; href?: boolean };

// A page of fake elements. `matches` answers for the one selector the test passes in: "links" means a[href].
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
    matches: (selector: string) => selector === "links" && fake.local === "a" && fake.href === true,
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
  assert.deepEqual(names(collect(page, "links")), ["top", "in shadow", "in frame"]);
});

test("an element in a frame knows which frames hold it", () => {
  const page = root_of([{ name: "outer", local: "iframe", frame: [{ name: "inner", local: "iframe", frame: [{ name: "deep", local: "a", href: true }] }] }]);
  const [found] = collect(page, "links");
  assert.equal(found!.frames.length, 2);
});

test("a cross-origin frame is skipped, not an error", () => {
  const page = root_of([{ name: "ad", local: "iframe", frame: "cross_origin" }, { name: "top", local: "a", href: true }]);
  assert.deepEqual(names(collect(page, "links")), ["top"]);
});

test("an empty custom selector finds nothing", () => {
  assert.deepEqual(collect(root_of([{ name: "top", local: "a", href: true }]), selector_for("custom", undefined)), []);
});

test("each filter has its own selector", () => {
  assert.equal(selector_for("links", undefined), "a[href]");
  assert.match(selector_for("inputs", undefined), /textarea/);
  assert.match(selector_for("clickable", undefined), /a\[href\]/);
  assert.match(selector_for("clickable", undefined), /textarea/);
  assert.match(selector_for("all", undefined), /h1/);
  assert.equal(selector_for("custom", ".post a"), ".post a");
});

test("has_text matches a lower-cased needle in the visible text, ignoring case", () => {
  assert.equal(has_text({ innerText: "Read More", textContent: "" } as never, "more"), true);
  assert.equal(has_text({ textContent: "Read More" } as never, "read"), true);
  assert.equal(has_text({ textContent: "Read" } as never, "more"), false);
  // Hidden text gives an empty innerText, which must not fall back to textContent.
  assert.equal(has_text({ innerText: "", textContent: "Hidden" } as never, "hidden"), false);
});

test("the clickable selector adds roving-tabindex items", () => {
  const clickable = selector_for("clickable", undefined);
  assert.match(clickable, /\[role=menuitemcheckbox\]/);
  assert.match(clickable, /\[tabindex]:not\(\[tabindex="-1"]\)/);
});

// A fake page element for the click sign: a tag, a cursor, a parent and attributes.
type Dom = { name: string; local: string; cursor?: string; parent?: Dom; attrs?: Record<string, string>; in_menu?: boolean; plain?: boolean; focus_only?: boolean };
const dom_styles = {
  cursor_of: (e: Element) => (e as unknown as Dom).cursor ?? "auto",
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
    is_intersecting: (f: Found) => f.element !== child,
    rects_of: () => [{ left: 0, top: 0, right: 10, bottom: 10 }],
    clips_of: () => [],
    viewport_of: () => ({ width: 100, height: 100 }),
    is_hidden_by_style: () => false,
    is_reachable_at: () => true,
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
