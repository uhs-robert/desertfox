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

// Enter clicks the element that Tab focused only while the current item holds it. On a list that does not move the focus (an ARIA list with an active descendant), the current item can differ from the one Tab left the focus in.
test("Enter clicks the Tab-focused child of the current item, and the link when the current item is another one", async () => {
  const clicked: string[] = [];
  const globals = globalThis as Record<string, unknown>;
  const control = (name: string) => ({ name, tabIndex: 0, matches: (selector: string) => selector !== ":disabled", checkVisibility: () => true, getClientRects: () => [{}], focus() { globals.document = { ...(globals.document as object), activeElement: this }; }, click: () => void clicked.push(name) });
  const link = control("link");
  const button = control("button");
  const other_link = control("other link");
  const item_of = (...own: object[]) => ({ matches: () => false, querySelectorAll: () => own, contains: (element: unknown) => own.includes(element as object) });
  let current: { item: unknown; link: unknown } = { item: item_of(link, button), link };
  globals.document = { activeElement: link, documentElement: { querySelectorAll: () => [] }, addEventListener() {}, removeEventListener() {} };
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<void>>();
  globals.window = {
    addEventListener() {},
    removeEventListener() {},
    desertfox_host: {
      register_handler_: (id: string, handler: never) => void handlers.set(id, handler),
      run_command_: async (_id: string, _bundle: string, args: { take: (item: unknown, link: unknown) => void }) => args.take(current.item, current.link),
      is_editable_: () => false,
    },
  };
  await import(`${new URL("../src/content/item_act/main.ts", import.meta.url).href}?enter_rule`);
  await handlers.get("page.item_focus")!({ direction: "next" });
  await handlers.get("page.item_action")!({ action: "open" });
  assert.deepEqual(clicked, ["button"], "Enter clicks the control Tab focused");
  // A move that does not focus makes another item current while the focus stays on the button.
  current = { item: item_of(other_link), link: other_link };
  await handlers.get("page.item_action")!({ action: "open" });
  assert.deepEqual(clicked, ["button", "other link"], "Enter opens the link of the current item");
});

// Drives the real handler with a fake host. A row is a fake item. The host answers each row's link by the row's own rule (`addresses`), as the item bundle does, while the first a[href] of the row (`first_links`, a vote link) is a different address.
async function run_open(action: string, mode: "item" | "item_visual", range: { addresses: (string | undefined)[]; from: number; to: number; first_links?: string[] }) {
  const sent: { url: string; where: string }[] = [];
  const events: string[] = [];
  const row = (address: string | undefined, index: number) => ({ link: address ? { href: address } : undefined, matches: () => false, querySelector: () => ({ href: range.first_links?.[index] ?? "https://first-link/" }) });
  const rows = range.addresses.map(row);
  const link_of = (item: (typeof rows)[number]) => item.link;
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  const host = {
    register_handler_: (id: string, handler: (args: Record<string, unknown>) => Promise<unknown>) => handlers.set(id, handler),
    run_command_: (id: string, _bundle: string, args: { take: (...taken: unknown[]) => void }) => {
      if (id === "item.range" && mode === "item_visual") args.take(rows, rows.map((_, index) => `i${index}`), range.from, range.to, range.from, link_of);
      if (id === "item.current") args.take(rows[range.from], link_of(rows[range.from]!));
      return Promise.resolve({ ok: true });
    },
    set_mode_: (next: string) => events.push(`mode ${next}`),
    show_toast_: () => {},
  };
  const globals = globalThis as Record<string, unknown>;
  globals.window = { desertfox_host: host };
  globals.browser = {
    runtime: {
      sendMessage: (message: { invocations: { args: { url: string; where: string } }[] }) => {
        sent.push(message.invocations[0]!.args);
        events.push(`open ${message.invocations[0]!.args.url}`);
        return Promise.resolve({ ok: true });
      },
    },
  };
  await import(`${new URL("../src/content/item_act/main.ts", import.meta.url).href}?open_${Math.random()}`);
  const outcome = await handlers.get("page.item_action")!({ action }).then(() => "ok", (error: Error) => error.message);
  return { sent, events, outcome };
}

test("open_range opens the first item here, the rest in background tabs in order, then ends the selection", async () => {
  const { sent, events } = await run_open("open_range", "item_visual", { addresses: ["https://a/", "https://b/", "https://c/", "https://d/"], from: 0, to: 2 });
  assert.deepEqual(sent.map((one) => one.url).sort(), ["https://a/", "https://b/", "https://c/"]);
  assert.deepEqual(sent.filter((one) => one.where === "here").map((one) => one.url), ["https://a/"]);
  assert.deepEqual(events, ["open https://b/", "open https://c/", "open https://a/", "mode item"]);
});

test("open_range skips an item with no link and takes the first link as the one opened here", async () => {
  const { sent } = await run_open("open_range", "item_visual", { addresses: [undefined, "https://b/", "https://c/"], from: 0, to: 2 });
  assert.deepEqual(sent, [{ url: "https://c/", where: "background" }, { url: "https://b/", where: "here" }]);
});

test("open_background opens every selected item in background tabs and ends the selection", async () => {
  const { sent, events } = await run_open("open_background", "item_visual", { addresses: ["https://a/", "https://b/"], from: 0, to: 1 });
  assert.deepEqual(sent, [{ url: "https://b/", where: "background" }, { url: "https://a/", where: "background" }]);
  assert.equal(events.at(-1), "mode item");
});

test("open_background in item mode opens the current item in a background tab and leaves the mode", async () => {
  const { sent, events } = await run_open("open_background", "item", { addresses: ["https://a/", "https://b/"], from: 1, to: 1 });
  assert.deepEqual(sent, [{ url: "https://b/", where: "background" }]);
  assert.deepEqual(events, ["open https://b/"]);
});

test("a range with no link refuses and keeps the selection", async () => {
  const { sent, events, outcome } = await run_open("open_range", "item_visual", { addresses: [undefined], from: 0, to: 0 });
  assert.equal(outcome, "No link to open");
  assert.deepEqual([sent, events], [[], []]);
});

test("the link of each item is the row's link, not the first a[href] of the item", async () => {
  const { sent } = await run_open("open_range", "item_visual", { addresses: ["https://story-a/", "https://story-b/"], first_links: ["https://vote-a/", "https://vote-b/"], from: 0, to: 1 });
  assert.deepEqual(sent, [{ url: "https://story-b/", where: "background" }, { url: "https://story-a/", where: "here" }]);
  const single = await run_open("open_background", "item", { addresses: ["https://story-a/"], first_links: ["https://vote-a/"], from: 0, to: 0 });
  assert.deepEqual(single.sent, [{ url: "https://story-a/", where: "background" }]);
});

test("an item whose row link finds nothing refuses, though it holds other links", async () => {
  const visual = await run_open("open_range", "item_visual", { addresses: [undefined, undefined], first_links: ["https://vote-a/", "https://vote-b/"], from: 0, to: 1 });
  assert.equal(visual.outcome, "No link to open");
  assert.deepEqual(visual.sent, []);
  const single = await run_open("open_background", "item", { addresses: [undefined], first_links: ["https://vote-a/"], from: 0, to: 0 });
  assert.equal(single.outcome, "No link to open");
  assert.deepEqual(single.sent, []);
});
