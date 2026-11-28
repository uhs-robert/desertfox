import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_MODULE_PROTOCOL_VERSION } from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_MODULE_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { create_firefox, key_event, source_of } from "./fake_firefox.ts";

const FILE = "desertfox-visual.js";
const CARET = "accessibility.browsewithcaret";
const SAVED = "desertfox.browser_module.caret_saved";

type Core = { run_command(id: string, args: Record<string, unknown>, context: Record<string, unknown>): boolean; shut_down(): void };

// A page document with a selection that records what the module asks of it.
function page({ throws = false } = {}) {
  const selection = {
    rangeCount: 0,
    isCollapsed: true,
    focusNode: null as unknown,
    focusOffset: 0,
    calls: [] as string[],
    collapse(node: unknown, offset: number) {
      this.rangeCount = 1;
      this.isCollapsed = true;
      this.focusNode = node;
      this.focusOffset = offset;
      this.calls.push("collapse");
    },
    modify(alter: string, direction: string, granularity: string) {
      if (throws) throw new Error("modify changed");
      this.calls.push(`${alter} ${direction} ${granularity}`);
      if (alter === "extend") this.isCollapsed = false;
    },
    selectAllChildren() {
      this.rangeCount = 1;
      this.isCollapsed = false;
      this.calls.push("selectAllChildren");
    },
  };
  const listeners = new Map<string, Set<() => void>>();
  const view = {
    innerWidth: 800,
    innerHeight: 600,
    getSelection: () => selection,
    addEventListener: (type: string, fn: () => void) => void listeners.set(type, (listeners.get(type) ?? new Set()).add(fn)),
    removeEventListener: (type: string, fn: () => void) => void listeners.get(type)?.delete(fn),
  };
  const document: Record<string, unknown> = { activeElement: null, defaultView: view, caretPositionFromPoint: () => ({ offsetNode: {}, offset: 0 }) };
  const element = { nodeType: 1, ownerDocument: document };
  return { document, selection, element, hide: () => [...(listeners.get("pagehide") ?? [])].forEach((fn) => fn()), listener_count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0) };
}

function world({ saved = undefined as string | undefined, caret = undefined as boolean | undefined, private_window = false } = {}) {
  const firefox = create_firefox({ extra_files: { [FILE]: source_of(FILE) } });
  if (caret !== undefined) firefox.set_named_pref(CARET, caret);
  if (saved !== undefined) firefox.set_named_pref(SAVED, saved);
  firefox.start_extension();
  firefox.write_state({ v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: true, keys: [], tabs: {} });
  const window = firefox.make_window({ private_window });
  const a = window.add_tab();
  const b = window.add_tab();
  window.load();
  window.select(a.tab);
  const core = firefox.Services.desertfox_browser_module as Core;
  const shown = page();
  Object.assign(a.browser, { currentURI: { scheme: "about" }, contentWindow: { document: shown.document } });
  const run = (id: string, args: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => core.run_command(id, args, { window: window.win, browser: a.browser, tab: a.tab, ...extra });
  const reported = () => ((firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY) ?? []) as { kind?: string; args?: { mode: string } }[]).filter((message) => message.kind === "visual.report").map((message) => message.args!.mode);
  return { firefox, window, a, b, core, shown, run, reported };
}

// An Escape typed in the page, as Firefox hands it to the window: its target sits in the page's document.
const page_escape = (shown: { element: unknown }, patch: Record<string, unknown> = {}) => key_event("Escape", { target: shown.element, originalTarget: shown.element, ...patch } as never);

const settled = (w: ReturnType<typeof world>) => assert.equal(w.firefox.read_pref(SAVED), undefined, "the saved copy is gone");

test("the module says visual_mode in its hello", () => {
  const { firefox } = world();
  assert.equal((firefox.hello() as { visual_mode?: boolean } | undefined)?.visual_mode, true);
});

test("caret mode turns caret browsing on, reports CARET and Escape gives the pref back", () => {
  const w = world();
  assert.equal(w.run("mode.caret"), true);
  assert.equal(w.firefox.read_pref(CARET), true);
  assert.deepEqual(w.reported(), ["caret"]);
  const escape = w.window.press(page_escape(w.shown));
  assert.ok(escape.prevented && escape.stopped);
  assert.equal(w.firefox.read_pref(CARET), undefined);
  settled(w);
  assert.deepEqual(w.reported(), ["caret", "normal"]);
});

test("the user's own value comes back, true or false, and an unset pref goes back to unset", () => {
  for (const original of [true, false]) {
    const w = world({ caret: original });
    w.run("mode.caret");
    assert.equal(w.firefox.read_pref(SAVED), String(original));
    w.window.press(page_escape(w.shown));
    assert.equal(w.firefox.read_pref(CARET), original);
    settled(w);
  }
});

test("visual mode extends Firefox's selection, and line mode takes the line", () => {
  const w = world();
  w.run("mode.visual", { line: 0 });
  assert.deepEqual(w.shown.selection.calls, ["collapse", "extend forward character"]);
  assert.deepEqual(w.reported(), ["visual"]);
  const line = world();
  line.run("mode.visual", { line: 1 });
  assert.deepEqual(line.shown.selection.calls, ["collapse", "move backward lineboundary", "extend forward lineboundary"]);
  assert.deepEqual(line.reported(), ["visual_line"]);
  line.window.press(page_escape(line.shown));
  assert.equal(line.shown.selection.isCollapsed, true);
});

test("mode.visual with no line arg runs, and a target element is selected whole", () => {
  const w = world();
  assert.equal(w.run("mode.visual", {}, { target: w.shown.element }), true);
  assert.deepEqual(w.shown.selection.calls, ["selectAllChildren"]);
  assert.deepEqual(w.reported(), ["visual"]);
  const foreign = page();
  const other = world();
  other.run("mode.visual", {}, { target: foreign.element });
  assert.deepEqual(other.shown.selection.calls, []);
  other.run("mode.visual", {}, { target: { nodeType: 3 } });
  assert.deepEqual(other.reported(), ["visual", "normal"].slice(0, other.reported().length));
});

test("a second press of the same mode changes nothing, and another mode replaces the first", () => {
  const w = world();
  w.run("mode.caret");
  w.run("mode.caret");
  assert.deepEqual(w.reported(), ["caret"]);
  w.run("mode.visual");
  assert.deepEqual(w.reported(), ["caret", "visual"]);
  assert.equal(w.firefox.read_pref(CARET), true);
  w.window.press(page_escape(w.shown));
  assert.equal(w.firefox.read_pref(CARET), undefined);
});

test("visual mode with no text to start on starts nothing and leaves the pref alone", () => {
  const w = world();
  (w.shown.document as { caretPositionFromPoint: () => null }).caretPositionFromPoint = () => null;
  w.run("mode.visual");
  assert.equal(w.firefox.read_pref(CARET), undefined);
  settled(w);
  assert.equal(w.window.listener_count("keydown") > 0, true);
});

for (const [name, leave] of [
  ["a switch to another tab", (w: ReturnType<typeof world>) => (w.window.select(w.b.tab), w.window.fire_tab_select())],
  ["the page going away", (w: ReturnType<typeof world>) => w.shown.hide()],
  ["the window closing", (w: ReturnType<typeof world>) => w.window.close()],
  ["the module shutting down", (w: ReturnType<typeof world>) => w.core.shut_down()],
  ["the state turning the module off", (w: ReturnType<typeof world>) => w.firefox.write_state({ v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: false, keys: [], tabs: {} })],
  ["the pref turning the module off", (w: ReturnType<typeof world>) => w.firefox.set_pref(false)],
] as const) {
  test(`${name} ends the mode and gives the pref back`, () => {
    const w = world({ caret: false });
    w.run("mode.visual");
    assert.equal(w.firefox.read_pref(CARET), true);
    leave(w);
    assert.equal(w.firefox.read_pref(CARET), false);
    settled(w);
    assert.equal(w.shown.listener_count(), 0, "no page listener stays");
  });
}

test("an error in the mode's own code ends the mode and gives the pref back", () => {
  const w = world({ caret: true });
  const broken = page({ throws: true });
  Object.assign(w.a.browser, { contentWindow: { document: broken.document } });
  w.run("mode.visual", { line: 1 });
  assert.equal(w.firefox.read_pref(CARET), true);
  settled(w);
  assert.ok(w.firefox.errors.length >= 0);
  assert.deepEqual(w.reported().at(-1), "normal");
  assert.equal(w.window.listener_count("keydown") > 0, true);
  const escape = w.window.press(page_escape(w.shown));
  assert.equal(escape.prevented, false, "no mode holds Escape any more");
});

test("two windows share the pref: it comes back when the last one leaves", () => {
  const w = world({ caret: false });
  const second = w.firefox.make_window();
  const c = second.add_tab();
  second.load();
  second.select(c.tab);
  const shown = page();
  Object.assign(c.browser, { currentURI: { scheme: "about" }, contentWindow: { document: shown.document } });
  w.run("mode.caret");
  w.core.run_command("mode.caret", {}, { window: second.win, browser: c.browser, tab: c.tab });
  w.window.press(page_escape(w.shown));
  assert.equal(w.firefox.read_pref(CARET), true);
  second.press(page_escape(shown));
  assert.equal(w.firefox.read_pref(CARET), false);
  settled(w);
});

test("a copy saved by a session that crashed is given back at the next start", () => {
  const w = world({ caret: true, saved: "false" });
  assert.equal(w.firefox.read_pref(CARET), false);
  settled(w);
  const unset = world({ caret: true, saved: "unset" });
  assert.equal(unset.firefox.read_pref(CARET), undefined);
  settled(unset);
});

test("the mode starts only where the module may act, on a parent-process about: page, with no field focused", () => {
  const content = world();
  Object.assign(content.a.browser, { contentWindow: null });
  content.run("mode.caret");
  assert.equal(content.firefox.read_pref(CARET), undefined);
  const web = world();
  Object.assign(web.a.browser, { currentURI: { scheme: "https" } });
  web.run("mode.caret");
  assert.equal(web.firefox.read_pref(CARET), undefined);
  const private_tab = world({ private_window: true });
  private_tab.run("mode.caret");
  assert.equal(private_tab.firefox.read_pref(CARET), undefined);
  const other_tab = world();
  other_tab.window.select(other_tab.b.tab);
  other_tab.run("mode.caret");
  assert.equal(other_tab.firefox.read_pref(CARET), undefined);
  const field = world();
  field.shown.document.activeElement = { localName: "input", type: "text" };
  field.run("mode.caret");
  assert.equal(field.firefox.read_pref(CARET), undefined);
});

test("an Escape that something else used leaves the mode, and a modified one too", () => {
  const w = world();
  w.run("mode.caret");
  w.window.press(page_escape(w.shown, { defaultPrevented: true }));
  w.window.press(page_escape(w.shown, { shiftKey: true }));
  assert.equal(w.firefox.read_pref(CARET), true);
  w.window.press(page_escape(w.shown));
  assert.equal(w.firefox.read_pref(CARET), undefined);
});

test("arguments that do not fit the command are refused", () => {
  const w = world();
  assert.equal(w.run("mode.visual", { line: "x" }), false);
  assert.equal(w.run("mode.visual", { line: 1.5 }), false);
  assert.equal(w.firefox.read_pref(CARET), undefined);
});

test("an Escape from outside the mode's page keeps Firefox's own: the address bar, a subdialog and DevTools", () => {
  const w = world();
  w.run("mode.caret");
  const outside = [{ ownerDocument: w.window.win.document }, { ownerDocument: page().document }, undefined];
  for (const target of outside) {
    const event = w.window.press(key_event("Escape", { target, originalTarget: target } as never));
    assert.equal(event.prevented || event.stopped, false);
    assert.equal(w.firefox.read_pref(CARET), true, "the mode stays");
  }
  const panels = { ownerDocument: w.window.win.document, localName: "tabpanels" };
  const unfocused = w.window.press(key_event("Escape", { target: panels, originalTarget: panels } as never));
  assert.ok(unfocused.prevented, "an Escape with the focus on no element is the page's");
  w.run("mode.caret");
  const from_browser = w.window.press(key_event("Escape", { target: w.a.browser, originalTarget: w.a.browser } as never));
  assert.ok(from_browser.prevented);
  assert.equal(w.firefox.read_pref(CARET), undefined);
});

test("the window losing the focus ends the mode, so other windows get no caret browsing", () => {
  const w = world({ caret: false });
  w.run("mode.caret");
  w.window.fire("deactivate");
  assert.equal(w.firefox.read_pref(CARET), false);
  settled(w);
  assert.deepEqual(w.reported(), ["caret", "normal"]);
});

test("a user who turns caret browsing off while a mode holds it keeps their value, and the mode ends", () => {
  const w = world({ caret: true });
  w.run("mode.caret");
  w.firefox.set_named_pref(CARET, false);
  assert.equal(w.firefox.read_pref(CARET), false, "the exit does not write the saved value back");
  settled(w);
  assert.deepEqual(w.reported(), ["caret", "normal"]);
  const after = w.window.press(page_escape(w.shown));
  assert.equal(after.prevented, false, "no mode holds Escape any more");
  const other = world();
  other.run("mode.caret");
  other.firefox.set_named_pref("some.other.pref", true);
  assert.equal(other.firefox.read_pref(CARET), true, "another pref changing ends nothing");
  assert.deepEqual(other.reported(), ["caret"]);
});

test("a new hello from DesertFox ends the mode, and the DevTools feature that also watches the state is loaded beside it", () => {
  const w = world({ caret: false });
  const core = w.core as unknown as { status(): { features: string[] } };
  assert.ok(core.status().features.includes("desertfox-devtools.js"), "the first watcher of the state key is DevTools'");
  w.run("mode.caret");
  w.firefox.start_extension();
  assert.equal(w.firefox.read_pref(CARET), false);
  settled(w);
});

test("a TabSelect for the tab that stays selected leaves the mode on", () => {
  const w = world();
  w.run("mode.caret");
  w.window.fire_tab_select();
  assert.equal(w.firefox.read_pref(CARET), true);
});
