import assert from "node:assert/strict";
import { test } from "node:test";
import { checkbox_in } from "../src/content/item_act/checkbox.ts";

// An item of fake elements. A selector matches the elements whose `kind` it names, and `shown` stands for the visibility rule.
type Fake = { name: string; kind: string; shown: boolean };
const shown_box = (name: string, kind: string): Fake => ({ name, kind, shown: true });
const item_of = (elements: Fake[], own?: Fake) =>
  ({
    matches: (selector: string) => !!own && selector.includes(own.kind),
    name: own?.name,
    checkVisibility: () => own?.shown ?? true,
    getClientRects: () => (own?.shown === false ? [] : [{}]),
    querySelectorAll: (selector: string) =>
      elements
        .filter((element) => selector.includes(element.kind))
        .map((element) => ({ matches: () => true, name: element.name, checkVisibility: () => element.shown, getClientRects: () => (element.shown ? [{}] : []) })),
  }) as unknown as Element;
const name_of = (element: Element | undefined) => (element as unknown as { name: string } | undefined)?.name;

test("a shown native checkbox comes before a role checkbox, even one earlier in the item", () => {
  const item = item_of([shown_box("aria", 'role="checkbox"'), shown_box("native", 'type="checkbox"')]);
  assert.equal(name_of(checkbox_in(item)), "native");
});

test("with no native checkbox the first shown role checkbox is taken", () => {
  const item = item_of([{ name: "hidden aria", kind: 'role="checkbox"', shown: false }, shown_box("aria", 'role="checkbox"')]);
  assert.equal(name_of(checkbox_in(item)), "aria");
});

test("a hidden native checkbox is skipped, and an item with none shown has no checkbox", () => {
  const item = item_of([{ name: "hidden", kind: 'type="checkbox"', shown: false }]);
  assert.equal(checkbox_in(item), undefined);
});

test("a target selector replaces the search", () => {
  const item = item_of([shown_box("native", 'type="checkbox"'), shown_box("star", ".star")]);
  assert.equal(name_of(checkbox_in(item, ".star")), "star");
  assert.equal(checkbox_in(item, ".missing"), undefined);
});

test("the item_act bundle registers page.item_action and page.item_focus, and registers once", async () => {
  const registered: string[] = [];
  (globalThis as Record<string, unknown>).window = { desertfox_host: { register_handler_: (id: string) => void registered.push(id) } };
  const bundle_url = new URL("../src/content/item_act/main.ts", import.meta.url).href;
  await import(`${bundle_url}?first`);
  await import(`${bundle_url}?second`);
  assert.deepEqual(registered, ["page.item_action", "page.item_focus"]);
});

test("target goes with toggle only, and the action is required", async () => {
  await import("../src/background/command_modules.ts");
  const { registry } = await import("../src/shared/registry/builtin.ts");
  const { check_args } = await import("../src/shared/registry/index.ts");
  const command = registry.get("page.item_action")!;
  assert.equal(check_args(command, { action: "toggle", target: ".star" }).ok, true);
  assert.equal(check_args(command, { action: "open", target: ".star" }).ok, false);
  assert.equal(check_args(command, { action: "open" }).ok, true);
  assert.equal(check_args(command, {}).ok, false);
});

test("an item that is itself a checkbox is the checkbox", () => {
  const item = item_of([], shown_box("self", 'role="checkbox"'));
  assert.equal(name_of(checkbox_in(item)), "self");
});

// Focus ring. An element is a fake with a `tabIndex`, a `disabled` flag and a `shown` flag, and the item holds its children.
import { next_focus } from "../src/content/item_act/focus.ts";
type Ring = { name: string; tabIndex: number; disabled: boolean; shown: boolean };
const ring_el = (name: string, over: Partial<Ring> = {}) => ({ name, tabIndex: 0, disabled: false, shown: true, ...over }) as Ring;
type Fake_el = Element & Ring;
const as_el = (fake: Ring) => Object.assign(fake, { matches: (selector: string) => (selector === ":disabled" ? fake.disabled : true), checkVisibility: () => fake.shown, getClientRects: () => (fake.shown ? [{}] : []) }) as unknown as Fake_el;
const ring_item = (children: Ring[], own_focusable = false) => {
  const els = children.map(as_el);
  return { els, item: { matches: () => own_focusable, querySelectorAll: () => els, contains: (other: unknown) => els.includes(other as never) } as unknown as Element };
};
const is_field = (element: Element) => (element as Fake_el).name.startsWith("field");
const step = (item: Element, active: Element | null, direction: "next" | "prev", page: Element[] = []) => (next_focus(item, active, direction, () => page, is_field) as Fake_el | undefined)?.name;

test("Tab steps through the children of the item in order and wraps", () => {
  const { els, item } = ring_item([ring_el("link"), ring_el("button"), ring_el("input")]);
  assert.equal(step(item, els[0]!, "next"), "button");
  assert.equal(step(item, els[1]!, "next"), "input");
  assert.equal(step(item, els[2]!, "next"), "link");
});

test("Shift-Tab steps back and wraps from the first to the last", () => {
  const { els, item } = ring_item([ring_el("link"), ring_el("button"), ring_el("input")]);
  assert.equal(step(item, els[2]!, "prev"), "button");
  assert.equal(step(item, els[0]!, "prev"), "input");
});

test("focus outside the ring starts at the first on Tab and at the last on Shift-Tab", () => {
  const { item } = ring_item([ring_el("a"), ring_el("b")]);
  assert.equal(step(item, null, "next"), "a");
  assert.equal(step(item, null, "prev"), "b");
});

test("disabled, tabindex -1 and hidden elements are skipped", () => {
  const { els, item } = ring_item([ring_el("link"), ring_el("off", { disabled: true }), ring_el("skip", { tabIndex: -1 }), ring_el("gone", { shown: false }), ring_el("button")]);
  assert.equal(step(item, els[0]!, "next"), "button");
  assert.equal(step(item, els[4]!, "prev"), "link");
});

test("a text field is skipped, so the ring wraps past it", () => {
  const { els, item } = ring_item([ring_el("link"), ring_el("field q"), ring_el("button")]);
  assert.equal(step(item, els[0]!, "next"), "button");
  assert.equal(step(item, els[2]!, "next"), "link");
  assert.equal(step(item, els[0]!, "prev"), "button");
  assert.equal(step(ring_item([ring_el("field only")]).item, null, "next"), undefined);
});

test("an item with no focusable child refuses", () => {
  const { item } = ring_item([ring_el("off", { disabled: true })]);
  assert.equal(step(item, null, "next"), undefined);
});

test("an item with only its link steps on through the page's focusables", () => {
  const { els, item } = ring_item([ring_el("link")]);
  const page = [as_el(ring_el("previous result")), els[0]!, as_el(ring_el("next result"))];
  assert.equal(step(item, els[0]!, "next", page), "next result");
  assert.equal(step(item, els[0]!, "prev", page), "previous result");
});

test("a step from a page control after the item's link goes on from that control, not from the link again", () => {
  const { els, item } = ring_item([ring_el("link")]);
  const page = [els[0]!, as_el(ring_el("second")), as_el(ring_el("third"))];
  assert.equal(step(item, page[1]!, "next", page), "third");
  assert.equal(step(item, page[2]!, "prev", page), "second");
});

test("a focusable item root joins the ring", () => {
  const { els, item } = ring_item([ring_el("button")], true);
  assert.equal(next_focus(item, null, "next", () => [item, els[0]!], is_field), item, "an item whose root and one child are focusable has a ring of two, starting at the root");
});
