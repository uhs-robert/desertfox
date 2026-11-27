// Hints in DevTools, the module's half (browser_module/desertfox-devtools.js), against a small stand-in for a toolbox and its panel documents.
// It drives the key flow: the hint key's ask, the letters dropped until the labels show, the collect, the draw, the keys, the pick and each end.
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import * as protocol from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { create_firefox, key_event, source_of } from "./fake_firefox.ts";
import { Node } from "./chrome_dom.ts";
import type { Box } from "./chrome_dom.ts";
import type { FakeEvent } from "./fake_firefox.ts";

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setImmediate(resolve));
// The DevTools hints draw with the drawing chrome hints lend through the core.
const CHROME_HINTS_FILE = "desertfox-chrome-hints.js";
const TABLE = [...protocol.DEVTOOLS_TREE_KEYS, protocol.DEVTOOLS_HINT_KEY];
const STATE = { v: 1, enabled: true, keys: [{ key: "J", id: "tab.next", args: {} }], tabs: {} };

// An element of a DevTools document: it records the events dispatched on it and the focus it takes.
class Element extends Node {
  dispatched: string[] = [];
  focused = 0;
  dispatchEvent(event: { type: string }) {
    this.dispatched.push(event.type);
    return true;
  }
  focus() {
    this.focused++;
  }
}

type Doc = ReturnType<typeof make_document>;

// A DevTools document at `url`, in `frame` (a frame element of its parent document, or the docked toolbox's <browser>). The hit test finds the smallest shown element that holds the point.
function make_document(url: string, frame: unknown, docked_in?: unknown) {
  const root = new Node("#root");
  const html = new Element("html");
  root.append(html);
  const view = Object.assign(new Node("#view"), {
    innerWidth: 1000,
    innerHeight: 600,
    frameElement: docked_in ? null : frame,
    browsingContext: { isContent: false, embedderElement: docked_in ?? frame },
    focused: 0,
    focus() {
      view.focused++;
    },
    KeyboardEvent: class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
    MouseEvent: class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
    CSSStyleSheet: class {
      text = "";
      replaceSync(text: string) {
        this.text = text;
      }
    },
  });
  const holds = (box: Box, x: number, y: number) => x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height;
  const doc = {
    documentURI: url,
    documentElement: html,
    defaultView: view,
    createElementNS: (_ns: string, name: string) => Object.assign(new Element(name), { ownerDocument: doc }),
    querySelectorAll: (selector: string) => html.querySelectorAll(selector),
    elementFromPoint: (x: number, y: number) =>
      html
        .descendants()
        .filter((node) => node.visible && !node.attrs.has("covered") && node.box.width > 0 && holds(node.box, x, y))
        .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0] ?? null,
    getElementById: () => null,
  };
  // Adds an element under `parent`, with a box, listed under the `selector` the module asks for.
  const add = (selector: string, box: Box, { parent = html as Node, tag = "div", props = {} as Partial<Element> } = {}) => {
    const element = Object.assign(new Element(tag, { box, ...props }), { ownerDocument: doc });
    parent.append(element);
    html.query[selector] = [...(html.query[selector] ?? []), element];
    return element;
  };
  return { doc, html, view, add };
}

// A panel frame in `parent` that shows `inner`.
function frame_in(parent: Doc, box: Box, inner_url: string | null, { visible = true } = {}) {
  const frame = Object.assign(new Element("iframe", { box, visible }), { ownerDocument: parent.doc, clientLeft: 0, clientTop: 0 });
  parent.html.append(frame);
  const inner = inner_url === null ? null : make_document(inner_url, frame);
  Object.assign(frame, { contentDocument: inner?.doc ?? null });
  return { frame, inner };
}

// A docked toolbox (or the toolbox of a DevTools window) with two tool tabs, the Inspector with a rule view and the markup view with three lines, a hidden Console frame and a frame of another process.
function toolbox_in(win: { document: unknown }, docked: boolean) {
  // The <browser> that docks the toolbox under the page, or the frame of a DevTools window, at the top left of its window.
  const holder = { classList: { contains: (name: string) => docked && name === "devtools-toolbox-iframe" }, ownerDocument: win.document, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const toolbox = make_document("about:devtools-toolbox", holder, docked ? holder : undefined);
  const tabs = [0, 1].map((index) => toolbox.add(".devtools-tab", { left: 10 + index * 80, top: 5, width: 70, height: 20 }));
  const { inner } = frame_in(toolbox, { left: 0, top: 30, width: 1000, height: 570 }, "chrome://devtools/content/inspector/index.xhtml");
  const inspector = inner!;
  const rules = inspector.add("#ruleview-container", { left: 600, top: 40, width: 400, height: 500 });
  const search = inspector.add("#inspector-searchbox", { left: 10, top: 5, width: 200, height: 20 }, { tag: "input" });
  const { inner: markup_inner } = frame_in(inspector, { left: 0, top: 30, width: 590, height: 500 }, "chrome://devtools/content/inspector/markup/markup.html");
  const markup = markup_inner!;
  const lines = [0, 1, 2].map((index) => markup.add(".tag-line", { left: 20, top: 10 + index * 20, width: 400, height: 18 }));
  // A twisty inside a line, which is a button of its own: the line's label covers it.
  inspector.add(".devtools-button", { left: 900, top: 5, width: 20, height: 20 });
  markup.add("button, [role=button], [role=tab], [role=treeitem]", { left: 22, top: 12, width: 10, height: 10 }, { parent: lines[0]!, tag: "button" });
  frame_in(toolbox, { left: 0, top: 30, width: 1000, height: 570 }, "chrome://devtools/content/webconsole/index.html", { visible: false });
  frame_in(toolbox, { left: 0, top: 30, width: 1000, height: 570 }, null);
  return { toolbox, tabs, inspector, rules, search, markup, lines };
}

function started({ table = TABLE as unknown, docked = true } = {}) {
  const firefox = create_firefox({ extra_files: { [CHROME_HINTS_FILE]: source_of(CHROME_HINTS_FILE) } });
  // Chrome hints watch new windows. None here is one they label.
  Object.assign(firefox.Services, { ww: { registerNotification: () => undefined, unregisterNotification: () => undefined } });
  const extension = firefox.start_extension();
  Object.assign(extension, { baseURI: { resolve: (path: string) => `moz-extension://uuid/${path}` } });
  const browser_window = firefox.make_window();
  browser_window.load();
  browser_window.add_tab();
  const window = docked ? browser_window : firefox.make_window({ devtools_window: true });
  if (!docked) window.open();
  firefox.write_state(STATE);
  const dom = toolbox_in(window.win, docked);
  let focused: unknown = dom.lines[0];
  Object.assign(window.win.document, { commandDispatcher: { get focusedElement() { return focused; } } });
  Object.assign(window.win, { innerWidth: 1200, innerHeight: 800 });
  // The window as the module's files see it: a browser window is the global of its context, not the object the context was made from. The core takes a DevTools window as it opens.
  (firefox.Services.focus as { activeWindow: unknown }).activeWindow = docked ? vm.runInContext("globalThis", window.win.context!) : window.win;
  let sent = 0;
  const send = (kind: string, args: Record<string, unknown>, sent_at = Date.now()) => {
    const id = `r${sent++}`;
    const list = (plain(firefox.read_holder(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY) ?? []) as unknown[]).slice(-10);
    firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [...list, { v: 1, id, kind, args, sent_at }]);
    return id;
  };
  const from_module = () => plain(firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY) ?? []) as { kind?: string; args?: Record<string, unknown>; reply_to?: string; ok?: boolean; error?: string }[];
  const reply = (id: string) => from_module().find((message) => message.reply_to === id);
  const pushes = (kind: string) => from_module().filter((message) => message.kind === kind).map((message) => message.args!);
  const press = (key: string, patch: Partial<FakeEvent> = {}, target: unknown = focused) => window.press(key_event(key, { target, originalTarget: target, ...patch }));
  const asked = () => pushes("devtools_hints.ask").at(-1)?.ask as number;
  const call = async (kind: string, args: Record<string, unknown>) => {
    const id = send(kind, args);
    await settle();
    return reply(id);
  };
  const collect = (session = 1, ask = asked(), colors = "") => call("devtools_hints.collect", { session, ask, colors });
  const target_rows = () => pushes("chrome_hints.targets").flatMap((args) => JSON.parse(args.targets as string) as number[][]);
  const draw = async (session: number, gen: number, rows: [number, string][], typed = "") => {
    send("devtools_hints.draw", { session, gen, part: 0, parts: 1, typed, labels: JSON.stringify(rows) });
    await settle();
  };
  const layers = () => [dom.toolbox, dom.inspector, dom.markup].flatMap(({ html }) => html.children.filter((child) => child.className === "desertfox-devtools-hints"));
  const labels = () =>
    layers().flatMap((host) => host.shadow!.children.find((child) => child.className === "desertfox-hints")!.children.map((node) => ({ text: node.textContent, left: node.style.left, top: node.style.top })));
  // A session drawn with one label per target, "a", "b", ... in target order.
  const drawn = async () => {
    press("f");
    await settle();
    await collect();
    const rows = target_rows().map(([id], index) => [id!, String.fromCharCode(97 + index)] as [number, string]);
    await draw(1, 1, rows);
    return rows;
  };
  const set_focus = (element: unknown) => (focused = element);
  if (table !== null) {
    send("devtools.keys", { keys: table });
  }
  return { firefox, window, dom, send, from_module, reply, pushes, press, asked, call, collect, target_rows, draw, layers, labels, drawn, set_focus };
}

test("the hello says devtools_hints, so the extension may push the hint key", async () => {
  const { firefox } = started();
  await settle();
  assert.equal((firefox.hello() as { devtools_hints?: boolean }).devtools_hints, true);
});

test("f sends one ask and takes the key, and the letters typed before the labels show are dropped, never reaching a DevTools tree", async () => {
  const { press, pushes, dom } = started();
  await settle();
  const event = press("f");
  assert.ok(event.prevented && event.stopped);
  await settle();
  assert.equal(pushes("devtools_hints.ask").length, 1);
  for (const key of ["h", "j", "x", "Backspace"]) assert.ok(press(key).prevented, key);
  assert.deepEqual(dom.lines[0]!.dispatched, [], "a dropped h hid or collapsed the node");
  assert.equal(pushes("chrome_hints.key").length, 0);
  // A key that is no letter, such as an arrow, still reaches DevTools, and ends the ask.
  assert.equal(press("ArrowDown").prevented, false);
  assert.equal(press("x").prevented, false, "the ask outlived the arrow");
});

test("a lost ask, which a busy or restarted background never answers, gives the window's keys back after its time", async () => {
  const { press, window, dom, collect } = started();
  await settle();
  press("f");
  await settle();
  window.run_timers();
  assert.equal(press("x").prevented, false);
  assert.ok(press("j").prevented, "j moves the tree again");
  assert.deepEqual(dom.lines[0]!.dispatched, ["keydown"]);
  assert.equal((await collect())?.error, "The hint key is stale", "a collect after the time finds no ask");
});

test("Escape or a click during the ask ends it and the next letter goes to DevTools; a key with Ctrl ends it and goes on", async () => {
  for (const end of ["Escape", "click", "ctrl"]) {
    const { press, window } = started();
    await settle();
    press("f");
    if (end === "Escape") assert.ok(press("Escape").prevented, "Escape went on to open the split console");
    else if (end === "click") window.fire("mousedown");
    else assert.equal(press("c", { ctrlKey: true }).prevented, false);
    assert.equal(press("x").prevented, false, end);
  }
});

test("without the hint key in the table, as from an older extension, f stays DevTools'", async () => {
  const { press, pushes } = started({ table: protocol.DEVTOOLS_TREE_KEYS });
  await settle();
  assert.equal(press("f").prevented, false);
  await settle();
  assert.equal(pushes("devtools_hints.ask").length, 0);
});

test("f in a field types, and f with a modifier is DevTools'", async () => {
  const { press, dom, pushes } = started();
  await settle();
  assert.equal(press("f", {}, dom.search).prevented, false);
  assert.equal(press("f", { ctrlKey: true }).prevented, false);
  await settle();
  assert.equal(pushes("devtools_hints.ask").length, 0);
});

test("a collect for the ask labels the tool tabs, the shown panel, the rule view as an area and one label per markup line, in the top window's pixels", async () => {
  const { press, collect, target_rows, pushes, from_module } = started();
  await settle();
  press("f");
  await settle();
  assert.deepEqual(await collect(), { v: 1, reply_to: "r1", ok: true });
  assert.deepEqual(pushes("chrome_hints.targets").map(({ session, part, parts }) => ({ session, part, parts })), [{ session: 1, part: 0, parts: 1 }]);
  // Two tabs, the toolbar button, the search field, the rule view, three markup lines. The hidden Console, the frame of another process and the twisty inside a line get none.
  assert.deepEqual(
    target_rows().map((row) => row.slice(1)),
    [
      [10, 5, 70, 20],
      [90, 5, 70, 20],
      [900, 35, 20, 20],
      [10, 35, 200, 20],
      [600, 70, 400, 500],
      [20, 70, 400, 18],
      [20, 90, 400, 18],
      [20, 110, 400, 18],
    ],
  );
  assert.ok(protocol.validate_message_list(from_module(), protocol.MODULE_TO_EXTENSION_KINDS, Date.now()).ok);
});

test("a collect is refused for an unknown ask, a second collect with the same ask, the focus outside DevTools, a window not in front, nothing to hint and the pref off", async () => {
  const run = async (setup: (fixture: ReturnType<typeof started>) => void, what: string, error: string, second = false) => {
    const fixture = started();
    await settle();
    fixture.press("f");
    await settle();
    setup(fixture);
    if (second) await fixture.collect();
    assert.equal((await fixture.collect(2, what === "unknown" ? fixture.asked() + 1 : fixture.asked()))?.error, error, what);
    assert.equal(fixture.layers().length, 0);
  };
  await run(() => undefined, "unknown", "The hint key is stale");
  await run(() => undefined, "spent", "The hint key is stale", true);
  await run(({ set_focus, window }) => set_focus({ localName: "input", ownerDocument: window.win.document }), "focus", "The focus left DevTools");
  await run(({ firefox }) => ((firefox.Services.focus as { activeWindow: unknown }).activeWindow = {}), "front", "The window is not in front");
  await run(({ dom }) => [...dom.tabs, ...dom.lines, dom.rules, dom.search, ...dom.inspector.html.query[".devtools-button"]!].forEach((node) => (node.visible = false)), "nothing", "Nothing to hint here");
});

test("a draw puts each label in its own document's layer with the fixed sheet and the colors in a constructed sheet, and letters then go to the extension", async () => {
  const { press, collect, target_rows, draw, layers, labels, pushes } = started();
  await settle();
  press("f");
  await settle();
  await collect(1, undefined, JSON.stringify({ dark: { primary: "#ff0000", bg_core: "url(x)" }, light: {} }));
  const rows = target_rows().map(([id], index) => [id!, `a${String.fromCharCode(97 + index)}`] as [number, string]);
  await draw(1, 1, rows);
  assert.equal(layers().length, 3, "one layer in the toolbox, the Inspector and the markup view");
  const [host] = layers();
  assert.equal(host!.shadow!.children[0]!.getAttribute("href"), "moz-extension://uuid/chrome_hints.css");
  const sheet = (host!.shadow as unknown as { adoptedStyleSheets: { text: string }[] }).adoptedStyleSheets[0]!;
  assert.ok(sheet.text.includes("--desertfox-primary: #ff0000;") && !sheet.text.includes("url(x)"), sheet.text);
  assert.equal(labels().length, 8);
  // The labels sit at each box in its own document; the rule view's label sits at its middle.
  assert.deepEqual(labels().find((label) => label.text === "ae"), { text: "ae", left: "800px", top: "290px" });
  assert.deepEqual(labels().find((label) => label.text === "af"), { text: "af", left: "20px", top: "10px" });
  assert.ok(press("a").prevented);
  assert.ok(press("Backspace").prevented);
  assert.deepEqual(pushes("chrome_hints.key").map(({ seq, key }) => [seq, key]), [[1, "a"], [2, "Backspace"]]);
});

test("a bad draw is dropped whole: an id of no target, a long label, a label with a blank, another session", async () => {
  const { press, collect, target_rows, draw, labels } = started();
  await settle();
  press("f");
  await settle();
  await collect();
  const [id] = target_rows()[0]!;
  for (const rows of [[[999999, "a"]], [[id!, "abcdefghijk"]], [[id!, "a b"]]] as [number, string][][]) await draw(1, 1, rows);
  await draw(2, 1, [[id!, "a"]]);
  assert.deepEqual(labels(), []);
});

test("Escape ends the session, tells the extension and takes every layer and listener away", async () => {
  const { press, pushes, layers, drawn, window } = started();
  await settle();
  const before = window.listener_count("mousedown");
  await drawn();
  assert.equal(layers().length, 3);
  assert.ok(press("Escape").prevented, "Escape went on to open the split console");
  await settle();
  assert.deepEqual(pushes("chrome_hints.end"), [{ session: 1 }]);
  assert.equal(layers().length, 0);
  assert.equal(window.listener_count("mousedown"), before);
  assert.equal(press("x").prevented, false);
});

test("a key the labels pass on (F6, F5, the context menu key, an arrow) ends the session and goes on, and the session holds the window's keys until it ends", async () => {
  for (const key of ["F6", "F5", "ContextMenu", "ArrowDown"]) {
    const { press, pushes, layers, drawn, firefox, window } = started();
    await settle();
    const core = firefox.Services.desertfox_browser_module as { keys_held_by(win: unknown): unknown };
    const seen_window = vm.runInContext("globalThis", window.win.context!);
    await drawn();
    assert.equal(core.keys_held_by(seen_window), "devtools_hints", "the popup walk could take the session's letters");
    assert.equal(press(key).prevented, false, key);
    await settle();
    assert.deepEqual(pushes("chrome_hints.end"), [{ session: 1 }], key);
    assert.equal(layers().length, 0, key);
    assert.equal(core.keys_held_by(seen_window), undefined, key);
    assert.equal(press("x").prevented, false, key);
  }
});

test("while another feature holds the window's keys, f asks for nothing and stays DevTools'", async () => {
  const { press, pushes, firefox, window } = started();
  await settle();
  const core = firefox.Services.desertfox_browser_module as { hold_keys(win: unknown, owner: string): boolean };
  core.hold_keys(vm.runInContext("globalThis", window.win.context!), "popup_walk");
  assert.equal(press("f").prevented, false);
  await settle();
  assert.equal(pushes("devtools_hints.ask").length, 0);
});

test("labels sit clear of what they mark: a markup line's left of the line, an icon button's over its middle, a tool tab's at its corner", async () => {
  const { drawn, layers } = started();
  await settle();
  await drawn();
  const placed = layers().flatMap((host) => host.shadow!.children.find((child) => child.className === "desertfox-hints")!.children);
  const at = (text: string) => {
    const { left, top, transform } = placed.find((node) => node.textContent === text)!.style;
    return { left, top, transform };
  };
  // In target order: two tabs, the toolbar button, the search field, the rule view, the markup lines.
  assert.deepEqual(at("a"), { left: "10px", top: "5px", transform: undefined });
  assert.deepEqual(at("c"), { left: "910px", top: "15px", transform: "translate(-50%, -50%)" });
  assert.deepEqual(at("f"), { left: "20px", top: "10px", transform: "translateX(-100%)" });
});

test("no labels within the time, a click, the pref off, the toolbar switch off and a new hello each end the session", async () => {
  for (const end of ["timer", "click", "pref", "switch", "hello"]) {
    const fixture = started();
    await settle();
    if (end === "timer") {
      fixture.press("f");
      await settle();
      await fixture.collect();
      fixture.window.run_timers();
    } else {
      await fixture.drawn();
      if (end === "click") fixture.window.fire("mousedown");
      if (end === "pref") fixture.firefox.set_pref(false);
      if (end === "switch") fixture.firefox.write_state({ ...STATE, enabled: false });
      if (end === "hello") {
        fixture.firefox.start_extension();
        fixture.firefox.write_state(STATE);
      }
    }
    assert.equal(fixture.layers().length, 0, end);
  }
});

test("a pick runs the target's fixed action: a mouse press on a markup line or a tool tab, a click on a button, the focus into a field or an area, or out of a field for an area that takes none", async () => {
  const pick_label = async (choose: (dom: ReturnType<typeof toolbox_in>) => Node) => {
    const fixture = started();
    await settle();
    await fixture.drawn();
    const element = choose(fixture.dom);
    const order = [...fixture.dom.tabs, fixture.dom.inspector.html.query[".devtools-button"]![0]!, fixture.dom.search, fixture.dom.rules, ...fixture.dom.lines];
    const id = fixture.target_rows()[order.indexOf(element)]![0]!;
    const answer = await fixture.call("devtools_hints.pick", { session: 1, id });
    assert.equal(fixture.layers().length, 0, "the labels outlived the pick");
    return { answer, fixture };
  };
  const line = await pick_label((dom) => dom.lines[1]!);
  assert.equal(line.answer?.ok, true);
  assert.deepEqual((line.fixture.dom.lines[1] as Element).dispatched, ["mousedown", "mouseup", "click"]);
  // A tool tab selects on mousedown, so it gets a press too.
  const tab = await pick_label((dom) => dom.tabs[1]!);
  assert.deepEqual((tab.fixture.dom.tabs[1] as Element).dispatched, ["mousedown", "mouseup", "click"]);
  const button = await pick_label((dom) => dom.inspector.html.query[".devtools-button"]![0]!);
  assert.equal(button.fixture.dom.inspector.html.query[".devtools-button"]![0]!.clicks, 1);
  const field = await pick_label((dom) => dom.search);
  assert.equal((field.fixture.dom.search as Element).focused, 1);
  assert.equal(field.fixture.dom.inspector.view.focused, 1, "the field's document took the focus first");
  const area = await pick_label((dom) => {
    dom.rules.append(Object.assign(new Element("div", { box: { left: 600, top: 40, width: 0, height: 0 } }), { ownerDocument: dom.inspector.doc }));
    dom.rules.query["[tabindex], [contenteditable=true], input, textarea, select, button"] = [dom.rules.children[0]!];
    return dom.rules;
  });
  assert.equal((area.fixture.dom.rules.children[0] as Element).focused, 1, "the area's focusable child took the focus");
  // An area with nothing to focus, as the console output: the field with the focus lets it go, so the next keys reach the area's document.
  let blurred = 0;
  const bare = await pick_label((dom) => {
    Object.assign(dom.inspector.doc, { activeElement: { blur: () => void blurred++ } });
    return dom.rules;
  });
  assert.equal(bare.answer?.ok, true);
  assert.equal(blurred, 1);
});

test("a pick is refused for a target that moved or is gone, an id of no target and a session that ended", async () => {
  const fixture = started();
  await settle();
  await fixture.drawn();
  const [first, second] = fixture.target_rows();
  fixture.dom.tabs[0]!.box = { left: 50, top: 5, width: 70, height: 20 };
  assert.equal((await fixture.call("devtools_hints.pick", { session: 1, id: first![0] }))?.error, "The hint's target moved");
  assert.deepEqual((fixture.dom.tabs[0] as Element).dispatched, []);
  assert.equal((await fixture.call("devtools_hints.pick", { session: 1, id: second![0] }))?.error, "The hints have ended");
  const gone = started();
  await settle();
  await gone.drawn();
  gone.dom.tabs[0]!.remove();
  assert.equal((await gone.call("devtools_hints.pick", { session: 1, id: gone.target_rows()[0]![0] }))?.error, "The hint's target is gone");
});

test("a clear of the session ends it without telling the extension, and a clear of another session does nothing", async () => {
  const fixture = started();
  await settle();
  await fixture.drawn();
  await fixture.call("devtools_hints.clear", { session: 2 });
  assert.equal(fixture.layers().length, 3);
  await fixture.call("devtools_hints.clear", { session: 1 });
  assert.equal(fixture.layers().length, 0);
  assert.deepEqual(fixture.pushes("chrome_hints.end"), []);
});

test("hints work the same in a DevTools window of its own", async () => {
  const fixture = started({ docked: false });
  await settle();
  const event = fixture.press("f");
  assert.ok(event.prevented);
  await settle();
  assert.equal((await fixture.collect())?.ok, true);
  assert.equal(fixture.target_rows().length, 8);
  await fixture.draw(1, 1, fixture.target_rows().map(([id], index) => [id!, String.fromCharCode(97 + index)] as [number, string]));
  const id = fixture.target_rows()[1]![0]!;
  assert.equal((await fixture.call("devtools_hints.pick", { session: 1, id }))?.ok, true);
  assert.deepEqual((fixture.dom.tabs[1] as Element).dispatched, ["mousedown", "mouseup", "click"]);
});
