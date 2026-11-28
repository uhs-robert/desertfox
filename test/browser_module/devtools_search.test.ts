// The Inspector search keys, the module's half (browser_module/desertfox-devtools.js), against a small stand-in for a docked toolbox.
// It drives each rule and each way the kept markup line goes: a click, a blur, a node gone, an unload, a new hello, the pref off and a shut down.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as protocol from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { Node } from "./chrome_dom.ts";
import { create_firefox, key_event } from "./fake_firefox.ts";
import type { FakeEvent } from "./fake_firefox.ts";

const settle = () => new Promise((resolve) => setImmediate(resolve));
const STATE = { v: 1, enabled: true, keys: [{ key: "J", id: "tab.next", args: {} }], tabs: {} };
const TABLE = [...protocol.DEVTOOLS_TREE_KEYS, ...protocol.DEVTOOLS_FLAGGED_KEYS.flatMap(({ keys }) => keys)];

// An element that records the mouse events dispatched on it and the focus it takes, and tells its document.
class Element extends Node {
  dispatched: string[] = [];
  value = "";
  doc: Doc | null = null;
  dispatchEvent(event: { type: string }) {
    this.dispatched.push(event.type);
    return true;
  }
  focus() {
    this.doc!.focus_on(this);
  }
  blur() {
    if (this.doc!.activeElement === this) this.doc!.focus_on(null);
  }
}

type Doc = ReturnType<typeof make_document>;

function make_document(url: string, frame: unknown, docked_in?: unknown) {
  const root = new Node("#root");
  const html = new Element("html");
  root.append(html);
  const view = Object.assign(new Node("#view"), {
    frameElement: docked_in ? null : frame,
    browsingContext: { isContent: false, embedderElement: docked_in ?? frame },
    focused: 0,
    focus: () => void view.focused++,
    MouseEvent: class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
  });
  const doc = {
    documentURI: url,
    documentElement: html,
    defaultView: view,
    activeElement: null as Element | null,
    querySelectorAll: (selector: string) => html.querySelectorAll(selector),
    querySelector: (selector: string) => html.querySelector(selector),
    getElementById: (id: string) => html.descendants().find((node) => node.id === id) ?? null,
    // The element that had the focus hears its blur, as in Firefox, while the new one is already the active element.
    focus_on(element: Element | null) {
      const before = doc.activeElement;
      doc.activeElement = element;
      if (before && before !== element) before.fire("blur", { target: before });
    },
  };
  html.doc = doc as Doc;
  // Adds an element under `parent`. `selector` lists it under a selector the module asks for that the stand-in cannot match.
  const add = (tag: string, props: Partial<Element> = {}, { parent = html as Node, selector = "" } = {}) => {
    const element = Object.assign(new Element(tag, props), { ownerDocument: doc, doc });
    parent.append(element);
    if (selector) html.query[selector] = [...(html.query[selector] ?? []), element];
    return element;
  };
  return Object.assign(doc, { html, view, add });
}

function frame_in(parent: Doc, url: string) {
  const frame = parent.add("iframe");
  const inner = make_document(url, frame);
  Object.assign(frame, { contentDocument: inner });
  return inner;
}

// A docked toolbox with the Inspector (its search box, match buttons and the markup view with three lines, the first selected) and the Console tool (its input editor with a Vim prompt, and its output).
function toolbox_in(win: { document: unknown }) {
  const holder = { classList: { contains: (name: string) => name === "devtools-toolbox-iframe" }, ownerDocument: win.document };
  const toolbox = make_document("about:devtools-toolbox", holder, holder);
  const inspector_tab = toolbox.add("button", { id: "toolbox-tab-inspector", className: "devtools-tab selected" });
  const console_tab = toolbox.add("button", { id: "toolbox-tab-webconsole", className: "devtools-tab" });
  const inspector = frame_in(toolbox, "chrome://devtools/content/inspector/index.xhtml");
  const box = inspector.add("input", { id: "inspector-searchbox" });
  const next = inspector.add("button", { id: "inspector-searchnavigation-button-next" });
  const prev = inspector.add("button", { id: "inspector-searchnavigation-button-prev" });
  const rules = inspector.add("div", { id: "ruleview-container" });
  const markup = frame_in(inspector, "chrome://devtools/content/inspector/markup/markup.html");
  const markup_root = markup.add("div", { id: "root" });
  const lines = [0, 1, 2].map(() => markup.add("div", { className: "tag-line" }, { parent: markup_root }));
  const select_line = (line: Element) => (markup.html.query[".tag-line > .tag-state.theme-selected"] = [markup.add("span", { className: "tag-state theme-selected" }, { parent: line })]);
  select_line(lines[0]!);
  const webconsole = frame_in(toolbox, "chrome://devtools/content/webconsole/index.html");
  const container = webconsole.add("div", { className: "jsterm-input-container" });
  const editor = webconsole.add("div", { className: "CodeMirror" }, { parent: container });
  const input = webconsole.add("textarea", {}, { parent: editor });
  const dialog = webconsole.add("div", { className: "CodeMirror-dialog" }, { parent: editor });
  const prompt = webconsole.add("input", {}, { parent: dialog });
  webconsole.add("div", { className: "webconsole-output" });
  // The Console tool selected, as a tool switch would leave it.
  const select_tool = (tool: "inspector" | "webconsole") => {
    inspector_tab.className = tool === "inspector" ? "devtools-tab selected" : "devtools-tab";
    console_tab.className = tool === "webconsole" ? "devtools-tab selected" : "devtools-tab";
  };
  const show_popup = (shown: boolean) => (toolbox.html.query[".tooltip-visible .devtools-autocomplete-popup"] = shown ? [toolbox.add("div")] : []);
  return { toolbox, inspector, box, next, prev, rules, markup, lines, select_line, webconsole, input, prompt, select_tool, show_popup };
}

function started({ table = TABLE as unknown } = {}) {
  const firefox = create_firefox();
  firefox.start_extension();
  const window = firefox.make_window();
  window.load();
  window.add_tab();
  firefox.write_state(STATE);
  const dom = toolbox_in(window.win);
  let sent = 0;
  const push = (keys: unknown) => firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [{ v: 1, id: `r${sent++}`, kind: "devtools.keys", args: { keys }, sent_at: Date.now() }]);
  if (table !== null) push(table);
  // A key on the element with the focus. Each press is 1000 ms after the one before unless `after_ms` says otherwise.
  let now = 10_000;
  const press = (key: string, target: Node, { after_ms = 1000, ...patch }: Partial<FakeEvent> & { after_ms?: number } = {}) => {
    now += after_ms;
    return window.press(key_event(key, { target, originalTarget: target, timeStamp: now, ...patch })).prevented;
  };
  const focus_box_by_key = () => {
    dom.markup.focus_on(dom.lines[0]!);
    assert.equal(press("/", dom.lines[0]!), true, "/ in the markup view");
    assert.equal(dom.inspector.activeElement, dom.box);
  };
  return { firefox, window, dom, press, push, focus_box_by_key };
}

test("the hello says devtools_search, so the extension may push the search rows", async () => {
  const { firefox } = started();
  await settle();
  assert.equal((firefox.hello() as { devtools_search?: boolean }).devtools_search, true);
});

test("/ in the markup view or the rule view focuses the search box, and Escape there keeps the text and presses the line selected before", async () => {
  for (const from of ["markup", "rules"] as const) {
    const { dom, press } = started();
    await settle();
    const target = from === "markup" ? dom.lines[0]! : dom.rules;
    assert.equal(press("/", target), true, from);
    assert.equal(dom.inspector.activeElement, dom.box, from);
    dom.box.value = "p.hit";
    // A search moved the selection to another line.
    dom.select_line(dom.lines[2]!);
    assert.equal(press("Escape", dom.box), true, from);
    assert.equal(dom.box.value, "p.hit");
    assert.deepEqual(dom.lines[0]!.dispatched, ["mousedown", "mouseup", "click"], from);
    assert.deepEqual(dom.lines[2]!.dispatched, [], from);
    assert.equal(dom.markup.view.focused, 1, "the markup document takes the focus before the press");
  }
});

test("n and N press the match buttons outside the box, and with an empty box, in the box or outside the Inspector they go on", async () => {
  const { dom, press } = started();
  await settle();
  assert.equal(press("n", dom.lines[0]!), false, "an empty box");
  dom.box.value = "p.hit";
  assert.equal(press("n", dom.lines[0]!), true);
  assert.equal(press("N", dom.rules), true);
  assert.deepEqual([dom.next.clicks, dom.prev.clicks], [1, 1]);
  assert.equal(press("n", dom.box), false, "n types in the box");
  assert.equal(press("n", dom.webconsole.add("div")), false, "the console output");
  assert.equal(press("/", dom.toolbox.add("div")), false, "the toolbox");
  assert.deepEqual([dom.next.clicks, dom.prev.clicks], [1, 1]);
});

test("Escape in a box a click focused presses the line selected now: the markup view gets the focus and nothing is restored", async () => {
  const { dom, press } = started();
  await settle();
  dom.inspector.focus_on(dom.box);
  dom.select_line(dom.lines[1]!);
  assert.equal(press("Escape", dom.box), true);
  assert.deepEqual(dom.lines[1]!.dispatched, ["mousedown", "mouseup", "click"]);
  assert.deepEqual(dom.lines[0]!.dispatched, []);
});

test("the kept line goes when the box loses the focus, and a window sent to the back keeps it", async () => {
  const { dom, press, focus_box_by_key } = started();
  await settle();
  focus_box_by_key();
  // A window in the back blurs the box, which stays the active element.
  dom.box.fire("blur", { target: dom.box });
  dom.select_line(dom.lines[2]!);
  assert.equal(press("Escape", dom.box), true);
  assert.deepEqual(dom.lines[0]!.dispatched.length, 3, "the window's blur dropped the kept line");
  focus_box_by_key();
  dom.inspector.focus_on(dom.rules);
  dom.inspector.focus_on(dom.box);
  dom.select_line(dom.lines[1]!);
  press("Escape", dom.box);
  assert.deepEqual(dom.lines[1]!.dispatched.length, 3, "the line selected now");
  assert.deepEqual(dom.lines[0]!.dispatched.length, 3, "the kept line was pressed again after the blur");
});

test("a kept line gone from the markup view, as after its node left the page or the page reloaded, gives the line selected now", async () => {
  const { dom, press, focus_box_by_key } = started();
  await settle();
  focus_box_by_key();
  dom.lines[0]!.remove();
  dom.select_line(dom.lines[1]!);
  assert.equal(press("Escape", dom.box), true);
  assert.deepEqual(dom.lines[1]!.dispatched, ["mousedown", "mouseup", "click"]);
  assert.deepEqual(dom.lines[0]!.dispatched, []);
});

test("with no line selected, Escape focuses the markup view's root", async () => {
  const { dom, press } = started();
  await settle();
  dom.markup.html.query[".tag-line > .tag-state.theme-selected"] = [];
  dom.inspector.focus_on(dom.box);
  assert.equal(press("Escape", dom.box), true);
  assert.equal(dom.markup.activeElement, null);
  assert.equal(dom.markup.view.focused, 1);
});

test("the Inspector's unload, a new hello, the pref off and a shut down each drop the kept line and its listeners", async () => {
  const steps = {
    unload: ({ dom }: ReturnType<typeof started>) => dom.inspector.view.fire("pagehide"),
    hello: ({ firefox, push }: ReturnType<typeof started>) => {
      firefox.start_extension();
      firefox.write_state(STATE);
      push(TABLE);
    },
    // The pref on says the hello again, which the extension answers with the table.
    pref: ({ firefox, push }: ReturnType<typeof started>) => {
      firefox.set_pref(false);
      firefox.set_pref(true);
      push(TABLE);
    },
  };
  for (const [name, step] of Object.entries(steps)) {
    const fixture = started();
    await settle();
    fixture.focus_box_by_key();
    step(fixture);
    await settle();
    fixture.dom.select_line(fixture.dom.lines[2]!);
    assert.equal(fixture.press("Escape", fixture.dom.box), true, name);
    assert.deepEqual(fixture.dom.lines[0]!.dispatched, [], name);
    assert.equal(fixture.dom.box.listener_total(), 0, `${name} left a listener on the box`);
  }
  const { dom, firefox, focus_box_by_key } = started();
  await settle();
  focus_box_by_key();
  (firefox.Services.desertfox_browser_module as { shut_down(): void }).shut_down();
  assert.equal(dom.box.listener_total() + dom.inspector.view.listener_total(), 0);
});

test("Escape in the box stays DevTools' while the suggestion popup shows, with a modifier, in another box and without the search rows", async () => {
  const { dom, press, focus_box_by_key } = started();
  await settle();
  focus_box_by_key();
  dom.show_popup(true);
  assert.equal(press("Escape", dom.box), false, "the popup shows");
  dom.show_popup(false);
  assert.equal(press("Escape", dom.box, { shiftKey: true }), false, "Shift");
  const filter = dom.inspector.add("input", { id: "ruleview-searchbox" });
  assert.equal(press("Escape", filter), false, "the rule view's filter");
  assert.deepEqual(dom.lines[0]!.dispatched, []);
  assert.equal(press("Escape", dom.box), true, "the kept line outlives the passed Escapes");
  assert.deepEqual(dom.lines[0]!.dispatched.length, 3);
  const older = started({ table: [...protocol.DEVTOOLS_TREE_KEYS, protocol.DEVTOOLS_HINT_KEY, protocol.DEVTOOLS_VISUAL_KEY] });
  await settle();
  older.dom.inspector.focus_on(older.dom.box);
  assert.equal(older.press("/", older.dom.lines[0]!), false, "/ without the search rows");
  assert.equal(older.press("Escape", older.dom.box), false, "Escape without the search rows");
});

