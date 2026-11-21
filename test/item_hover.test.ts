import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import "../src/background/command_modules.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch, TreeLeaf } from "../src/shared/prefix_tree.ts";
import { page_keymap_for } from "../src/background/page_keymap.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { create_item_overlay } from "../src/content/item/overlay.ts";
import { hover_at, thumbnail } from "../src/content/item/hover.ts";
import { move_item } from "../src/content/item/pick.ts";
import type { ItemArgs, ItemPage } from "../src/content/item/pick.ts";

// A page of fake elements: a chain document > tile > link > picture, so the events of a hover land on a known path. `events` logs `type@name` for each dispatch.
type Rect = { left: number; top: number; width: number; height: number };
type Fake = { name: string; parentElement: Fake | null; offsetWidth: number; rect: Rect; pictures: Fake[]; isConnected: boolean };
let events: string[] = [];
let under_point: Fake | null = null;

const fake = (name: string, parentElement: Fake | null = null, offsetWidth = 0): Fake => ({ name, parentElement, offsetWidth, rect: { left: 0, top: 0, width: 200, height: 100 }, pictures: [], isConnected: true });
const as_element = (value: Fake) => value as unknown as Element;
const globals = globalThis as unknown as Record<string, unknown>;

function install_fakes() {
  events = [];
  under_point = null;
  const event_class = class { type: string; clientX!: number; clientY!: number; bubbles!: boolean; constructor(type: string, init: { clientX: number; clientY: number; bubbles: boolean }) { Object.assign(this, init); this.type = type; } };
  globals["PointerEvent"] = event_class;
  globals["MouseEvent"] = event_class;
  globals["document"] = {
    elementFromPoint: () => under_point,
    createElement: () => ({ style: { cssText: "" }, remove: () => {}, isConnected: false, attachShadow: () => ({ append: () => {} }) }),
    documentElement: { append: (host: { isConnected: boolean }) => { host.isConnected = true; } },
    activeElement: null,
  };
  globals["window"] = { addEventListener: () => {}, removeEventListener: () => {} };
  globals["innerWidth"] = 1000;
  globals["innerHeight"] = 800;
  globals["getComputedStyle"] = () => ({ overflow: "visible" });
}

// Gives a fake the members the code under test reads.
function wire(element: Fake): Fake {
  Object.assign(element, {
    getBoundingClientRect: () => element.rect,
    querySelectorAll: () => element.pictures,
    dispatchEvent: (event: { type: string }) => events.push(`${event.type}@${element.name}`),
    contains: (node: Fake) => { for (let at: Fake | null = node; at; at = at.parentElement) if (at === element) return true; return false; },
    matches: () => false,
    isConnected: true,
  });
  return element;
}

beforeEach(() => {
  install_fakes();
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
});
afterEach(() => {
  mock.timers.reset();
  for (const name of ["PointerEvent", "MouseEvent", "document", "window", "innerWidth", "innerHeight", "getComputedStyle"]) delete globals[name];
});

const page_root = wire(fake("page"));
function tile(name: string, with_picture: boolean): Fake {
  const element = wire(fake(name, page_root));
  const link = wire(fake(`${name}-link`, element));
  if (with_picture) element.pictures.push(wire(fake(`${name}-img`, link, 160)));
  return element;
}

test("a hover sends over on the picture, then enter down the chain outermost first, pointer events then mouse events", () => {
  hover_at(as_element(tile("t", true)));
  assert.deepEqual(events, [
    "pointerover@t-img", "pointerenter@page", "pointerenter@t", "pointerenter@t-link", "pointerenter@t-img",
    "mouseover@t-img", "mouseenter@page", "mouseenter@t", "mouseenter@t-link", "mouseenter@t-img",
  ]);
});

test("the unhover sends the thumbnail its exit, then leaves the layer the page put at the point", () => {
  const item = tile("t", true);
  const undo = hover_at(as_element(item));
  events = [];
  const layer = wire(fake("preview-layer", item));
  under_point = layer;
  undo();
  assert.deepEqual(events.filter((event) => event.startsWith("mouse")), ["mouseout@t-img", "mouseleave@t-img", "mouseleave@t-link", "mouseout@preview-layer", "mouseleave@preview-layer", "mouseleave@t", "mouseleave@page"]);
});

test("after a scroll the old tile still gets its leave, even when another tile now lies at the old point", () => {
  const item = tile("a", true);
  const undo = hover_at(as_element(item));
  const other = tile("b", true);
  // The scroll moved the tile and put another one under the point of the hover.
  item.pictures[0]!.rect = { left: 0, top: -500, width: 200, height: 100 };
  under_point = other.pictures[0]!;
  events = [];
  undo();
  assert.ok(events.includes("mouseleave@a-img") && events.includes("mouseout@a-img"), events.join());
  assert.ok(!events.some((event) => event.endsWith("@b-img")), events.join());
});

test("an item with no picture is hovered at its own centre, and the events carry that point", () => {
  const item = tile("plain", false);
  item.rect = { left: 10, top: 20, width: 100, height: 40 };
  const seen: { clientX: number; clientY: number }[] = [];
  (item as unknown as { dispatchEvent: (event: { clientX: number; clientY: number }) => void }).dispatchEvent = (event) => seen.push(event);
  hover_at(as_element(item));
  assert.deepEqual(seen.map((event) => [event.clientX, event.clientY]), seen.map(() => [60, 40]));
  assert.ok(seen.length > 0);
});

test("only a picture at least 96 px wide is a thumbnail", () => {
  const item = tile("t", false);
  item.pictures.push(wire(fake("favicon", item, 16)));
  assert.equal(thumbnail(as_element(item)), undefined);
  item.pictures.push(wire(fake("big", item, 120)));
  assert.equal((thumbnail(as_element(item)) as unknown as Fake).name, "big");
});

// The overlay drives the hover: `show` with the hover flag waits, a change of item or a clear undoes it.
function overlay(mode: () => string = () => "item") {
  return create_item_overlay(mode, () => ({ left_: () => false, stop_: () => {} }), () => {}, () => undefined, () => {});
}
const entered = () => events.filter((event) => event.startsWith("mouseenter"));
const left = () => events.filter((event) => event.startsWith("mouseleave"));

test("the hover starts about 300 ms after the land, not at once", () => {
  const box = overlay();
  box.show(as_element(tile("a", true)), "div", () => true);
  assert.deepEqual(events, []);
  mock.timers.tick(299);
  assert.deepEqual(events, []);
  mock.timers.tick(1);
  assert.ok(entered().length > 0);
  box.clear();
});

test("a held j starts no hover on the tiles it passes, only on the one it stops on", () => {
  const box = overlay();
  const tiles = ["a", "b", "c", "d"].map((name) => tile(name, true));
  for (const item of tiles) {
    box.show(as_element(item), "div", () => true);
    mock.timers.tick(100);
  }
  assert.deepEqual(events, []);
  mock.timers.tick(300);
  assert.ok(entered().every((event) => /@(page|d|d-link|d-img)$/.test(event)), events.join());
  assert.ok(events.some((event) => event === "mouseover@d-img"));
  box.clear();
});

test("a change of item unhovers the old item, and hovers the new one after the wait", () => {
  const box = overlay();
  box.show(as_element(tile("a", true)), "div", () => true);
  mock.timers.tick(300);
  events = [];
  box.show(as_element(tile("b", true)), "div", () => true);
  assert.ok(left().includes("mouseleave@a-img"), events.join());
  assert.deepEqual(entered(), []);
  mock.timers.tick(300);
  assert.ok(entered().includes("mouseenter@b-img"));
  box.clear();
});

test("an item removed before the wait ends gets no hover", () => {
  const box = overlay();
  const item = tile("a", true);
  box.show(as_element(item), "div", () => true);
  item.isConnected = false;
  mock.timers.tick(300);
  assert.deepEqual(events, []);
  box.clear();
});

test("a redraw on the same item neither unhovers nor hovers again", () => {
  const box = overlay();
  const item = as_element(tile("a", true));
  box.show(item, "div", () => true);
  mock.timers.tick(300);
  events = [];
  box.show(item, "div", () => true);
  mock.timers.tick(1000);
  assert.deepEqual(events, []);
  box.clear();
});

test("clear unhovers a hovered item, and cancels a hover still waiting", () => {
  const box = overlay();
  box.show(as_element(tile("a", true)), "div", () => true);
  mock.timers.tick(300);
  events = [];
  box.clear();
  assert.ok(left().includes("mouseleave@a-img"));
  events = [];
  box.show(as_element(tile("b", true)), "div", () => true);
  mock.timers.tick(100);
  box.clear();
  mock.timers.tick(1000);
  assert.deepEqual(events, []);
});

test("clear twice unhovers once, and leaves no timer running", () => {
  const box = overlay();
  box.show(as_element(tile("a", true)), "div", () => true);
  mock.timers.tick(300);
  box.clear();
  events = [];
  box.clear();
  mock.timers.tick(5000);
  assert.deepEqual(events, []);
});

test("a box without the hover flag sends no event, and the focus mark never hovers", () => {
  const box = overlay();
  box.show(as_element(tile("a", true)), "div");
  box.show(as_element(tile("b", true)));
  mock.timers.tick(1000);
  box.clear();
  assert.deepEqual(events, []);
});

test("the 100 ms watch that clears a box with a removed item also unhovers it", () => {
  const box = overlay();
  const item = tile("a", true);
  box.show(as_element(item), "div", () => true);
  mock.timers.tick(300);
  events = [];
  item.isConnected = false;
  mock.timers.tick(100);
  assert.ok(left().includes("mouseleave@a-img"), events.join());
});

test("a box drawn in item mode clears and unhovers once the frame leaves item mode, and one drawn in normal mode stays in both", () => {
  let mode = "item";
  const box = overlay(() => mode);
  box.show(as_element(tile("a", true)), "div", () => true);
  mock.timers.tick(300);
  events = [];
  // A step from another frame ends the mode here, with no input in this frame.
  mode = "normal";
  mock.timers.tick(100);
  assert.ok(left().includes("mouseleave@a-img"), events.join());
  box.show(as_element(tile("b", true)), "div", () => true);
  mock.timers.tick(300);
  events = [];
  mode = "item";
  mock.timers.tick(100);
  mode = "normal";
  mock.timers.tick(1000);
  assert.deepEqual(left(), []);
  box.clear();
});

// move_item hands the hover to highlight as its third argument.
function hover_page(items: Fake[], thumbs: boolean[]) {
  const calls: unknown[] = [];
  const elements = items.map((item, index) => Object.assign(item, {
    tabIndex: 0, focus: () => {}, setAttribute: () => {}, scrollIntoView: () => {}, getClientRects: () => [item.rect], checkVisibility: () => true,
    querySelector: () => null, getAttribute: () => null, closest: () => null, pictures: thumbs[index] ? [wire(fake("img", item, 160))] : [],
  }));
  const page = {
    doc: { querySelectorAll: () => elements, scrollingElement: null },
    view: { innerHeight: 800, innerWidth: 1000, scrollY: 0 },
    focused: () => null,
    toast: () => {},
    scroll_by: () => {},
    highlight: (_item: unknown, _selector: string, hover?: () => boolean) => calls.push(hover?.() ?? false),
    box_shown: () => false,
    derived: { sections_: () => [], items_: () => elements as unknown as Element[], link_of_: () => undefined, selector_: () => "div", grew_: () => false, grid_: () => true },
    overflow_y_: () => "visible",
    wait_: async () => {},
    now_: () => 0,
    watch_user_: () => ({ left_: () => false, stop_: () => {} }),
  } as unknown as ItemPage;
  return { page, calls };
}

test("a row that names its selector and sets hover hovers every item it lands on", () => {
  const { page, calls } = hover_page([wire(fake("a", page_root)), wire(fake("b", page_root))], [false, false]);
  move_item(page, { selector: "div", direction: "current", hover: true } as ItemArgs);
  assert.deepEqual(calls, [true]);
});

test("the item finder hovers an item with a thumbnail and not a text item", () => {
  const first = hover_page([wire(fake("a", page_root))], [true]);
  move_item(first.page, { direction: "current", hover: true });
  assert.deepEqual(first.calls, [true]);
  const text = hover_page([wire(fake("a", page_root))], [false]);
  move_item(text.page, { direction: "current", hover: true });
  assert.deepEqual(text.calls, [false]);
});

test("without the hover arg no land asks for a hover", () => {
  const { page, calls } = hover_page([wire(fake("a", page_root))], [true]);
  move_item(page, { selector: "div", direction: "current" });
  assert.deepEqual(calls, [false]);
});

// The setting: it fills the hover arg of the item keys and of the shipped video rows, and off removes it.
const compiled = (settings: Record<string, unknown> = {}) =>
  compile_config({ config: { ...empty_config(), settings: settings as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
const step_of = async (keymap: CompiledKeymap, url: string, key: string) => {
  const reply = (await page_keymap_for({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: keymap }) } as never, [url]))!;
  return ((reply.keymap.modes.item as TreeBranch).children[key] as TreeLeaf).steps[0]!.invocation;
};

test("item_hover is on by default: the item keys and the video rows carry hover", async () => {
  const result = compiled();
  assert.deepEqual(result.warnings, []);
  assert.equal((await step_of(result.compiled, "https://a.test/", "j")).args?.["hover"], true);
  assert.equal((await step_of(result.compiled, "https://duckduckgo.com/?q=x&iax=videos&ia=videos", "j")).args?.["hover"], true);
  assert.equal((await step_of(result.compiled, "https://www.google.com/search?q=x&udm=7", "j")).args?.["hover"], true);
});

test("a text result row never carries hover", async () => {
  assert.notEqual((await step_of(compiled().compiled, "https://duckduckgo.com/?q=x", "j")).args?.["hover"], true);
});

test("item_hover off removes the arg from the item keys and the video rows", async () => {
  const result = compiled({ item_hover: false });
  assert.deepEqual(result.warnings, []);
  assert.notEqual((await step_of(result.compiled, "https://a.test/", "j")).args?.["hover"], true);
  assert.notEqual((await step_of(result.compiled, "https://duckduckgo.com/?q=x&iax=videos&ia=videos", "j")).args?.["hover"], true);
});

test("a request that turns on for the shown item waits and hovers", () => {
  const box = overlay();
  const item = as_element(tile("a", true));
  box.show(item, "div");
  box.show(item, "div", () => true);
  assert.deepEqual(events, []);
  mock.timers.tick(300);
  assert.ok(entered().length > 0);
  box.clear();
});

test("a request that turns off cancels a pending wait and unhovers a running hover", () => {
  const box = overlay();
  const item = as_element(tile("a", true));
  box.show(item, "div", () => true);
  box.show(item, "div");
  mock.timers.tick(1000);
  assert.deepEqual(events, []);
  box.show(item, "div", () => true);
  mock.timers.tick(300);
  events = [];
  box.show(item, "div");
  assert.ok(left().includes("mouseleave@a-img"), events.join());
  box.clear();
});

test("an item that loses its thumbnail during the wait gets no hover when the finder asked", () => {
  const item = tile("a", true);
  let check: (() => boolean) | undefined;
  const { page } = hover_page([item], [true]);
  (page as unknown as { highlight: (_i: unknown, _s: string, hover?: () => boolean) => void }).highlight = (_i, _s, hover) => { check = hover; };
  move_item(page, { direction: "current", hover: true });
  const box = overlay();
  box.show(as_element(item), "div", check);
  item.pictures = [];
  mock.timers.tick(300);
  assert.deepEqual(events, []);
  box.clear();
});

test("a row that names its selector keeps the hover on the item itself when its picture is gone", () => {
  const item = tile("a", true);
  let check: (() => boolean) | undefined;
  const { page } = hover_page([item], [true]);
  (page as unknown as { highlight: (_i: unknown, _s: string, hover?: () => boolean) => void }).highlight = (_i, _s, hover) => { check = hover; };
  move_item(page, { selector: "div", direction: "current", hover: true });
  const box = overlay();
  box.show(as_element(item), "div", check);
  item.pictures = [];
  mock.timers.tick(300);
  assert.ok(entered().includes("mouseenter@a"), events.join());
  box.clear();
});

test("a j that only scrolls a tall item redraws its box with the hover request, so the hover stays", () => {
  const item = tile("tall", true);
  // The move reads `top` and `bottom` of the item box.
  item.rect = { left: 0, top: 0, width: 200, height: 2000, right: 200, bottom: 2000 } as Rect;
  const { page } = hover_page([item], [true]);
  const box = overlay();
  Object.assign(page, { highlight: box.show, focused: () => item as unknown as Element });
  move_item(page, { selector: "div", direction: "current", hover: true });
  mock.timers.tick(300);
  assert.ok(entered().length > 0);
  events = [];
  move_item(page, { selector: "div", direction: "down", hover: true });
  mock.timers.tick(1000);
  assert.deepEqual(events, []);
  box.clear();
});
