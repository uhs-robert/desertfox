// The DevTools tool keys (gt, gT) and tab keys (J, K), and the prefix hold under them (browser_module/desertfox-devtools.js), against a small stand-in for a docked toolbox.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as protocol from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { Node } from "./chrome_dom.ts";
import { create_firefox, key_event } from "./fake_firefox.ts";

const settle = () => new Promise((resolve) => setImmediate(resolve));
const STATE = { v: 1, enabled: true, keys: [{ key: "J", id: "tab.next", args: {} }, { key: "K", id: "tab.prev", args: {} }], tabs: {} };
const TABLE = [...protocol.DEVTOOLS_TREE_KEYS, ...protocol.DEVTOOLS_FLAGGED_KEYS.flatMap(({ keys }) => keys)];

type Dispatched = { type: string; key: string; code: string; keyCode: number; ctrlKey: boolean };

// An element that records the keys dispatched on it and tells its document.
class Element extends Node {
  dispatched: Dispatched[] = [];
  doc: { focus_on(element: Element | null): void } | null = null;
  dispatchEvent(event: Dispatched) {
    this.dispatched.push(event);
    return true;
  }
  focus() {
    this.doc!.focus_on(this);
  }
}

function toolbox_in(win: { document: unknown }) {
  const holder = { classList: { contains: (name: string) => name === "devtools-toolbox-iframe" }, ownerDocument: win.document };
  const view = Object.assign(new Node("#view"), {
    frameElement: null,
    browsingContext: { isContent: false, embedderElement: holder },
    KeyboardEvent: class {
      type: string;
      key: string;
      code: string;
      keyCode: number;
      ctrlKey: boolean;
      constructor(type: string, init: { key: string; code: string; keyCode: number; ctrlKey: boolean }) {
        this.type = type;
        this.key = init.key;
        this.code = init.code;
        this.keyCode = init.keyCode;
        this.ctrlKey = init.ctrlKey;
      }
    },
  });
  const doc = {
    documentURI: "about:devtools-toolbox",
    defaultView: view,
    activeElement: null as Element | null,
    focus_on(element: Element | null) {
      const before = doc.activeElement;
      doc.activeElement = element;
      if (before && before !== element) before.fire("blur", { target: before });
    },
  };
  const element = (local_name: string) => Object.assign(new Element(local_name), { ownerDocument: doc, doc });
  return { doc, view, element };
}

function started({ table = TABLE as unknown } = {}) {
  const firefox = create_firefox();
  firefox.start_extension();
  const window = firefox.make_window();
  window.load();
  window.add_tab();
  firefox.write_state(STATE);
  const dom = toolbox_in(window.win);
  const tree = dom.element("div");
  let sent = 0;
  const push = async (keys: unknown) => {
    firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [{ v: 1, id: `t${sent++}`, kind: "devtools.keys", args: { keys }, sent_at: Date.now() }]);
    await settle();
  };
  if (table !== null) void push(table);
  const press = (key: string, patch = {}, target: Node = tree) => window.press(key_event(key, { target, originalTarget: target, ...patch })).prevented;
  const chords = (target: Element = tree) => target.dispatched.map(({ key, code, keyCode, ctrlKey }) => `${ctrlKey ? "C-" : ""}${key} ${code} ${keyCode}`);
  return { firefox, window, dom, tree, press, push, chords };
}

const NEXT = "C-] BracketRight 221";
const PREV = "C-[ BracketLeft 219";

test("the hello says devtools_tools, so the extension may push the tool and tab rows", async () => {
  const { firefox } = started();
  await settle();
  assert.equal((firefox.hello() as { devtools_tools?: boolean }).devtools_tools, true);
});

test("gt sends Ctrl+] and gT sends Ctrl+[ once to the focused element, and each key of the pair stops there", async () => {
  const { press, chords, tree } = started();
  await settle();
  assert.equal(press("g"), true);
  assert.equal(press("t"), true);
  assert.equal(press("g"), true);
  assert.equal(press("T", { shiftKey: true }), true);
  assert.deepEqual(chords(), [NEXT, PREV]);
  assert.equal(press("t"), false, "t with no g before it is DevTools'");
  assert.equal(press("T", { shiftKey: true }), false);
  assert.equal(tree.dispatched.length, 2);
});

test("a key after g that is no t or T ends the hold and goes on to its own row: g j moves the tree, and a later t is DevTools'", async () => {
  const { press, chords } = started();
  await settle();
  press("g");
  assert.equal(press("j"), true);
  assert.equal(press("t"), false);
  assert.deepEqual(chords(), ["ArrowDown ArrowDown 40"]);
  press("g");
  assert.equal(press("x"), false, "a key with no row ends the hold and passes");
  assert.equal(press("t"), false);
  press("g");
  press("g");
  assert.equal(press("t"), true, "a second g starts the hold again");
  assert.deepEqual(chords(), ["ArrowDown ArrowDown 40", NEXT]);
});

test("a modifier on the second key ends the hold and sends nothing: Ctrl+t, Alt+T, Meta+t", async () => {
  const { press, chords } = started();
  await settle();
  for (const patch of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
    press("g");
    assert.equal(press("t", patch), false, JSON.stringify(patch));
    assert.equal(press("t"), false, "the hold ended");
  }
  assert.deepEqual(chords(), []);
});

test("g in an editable field or a frame of another process passes, and a t after it is no tool key", async () => {
  const { press, dom, chords } = started();
  await settle();
  const input = dom.element("input");
  const frame = dom.element("iframe");
  for (const target of [input, frame]) {
    assert.equal(press("g", {}, target), false, target.localName);
    assert.equal(press("t", {}, target), false, target.localName);
    assert.deepEqual(chords(target), []);
  }
});

test("the hold ends on a blur of the element, a click in the window, a page hide, a new hello, the pref off and its time", async () => {
  const ends: Record<string, (env: ReturnType<typeof started>) => void | Promise<void>> = {
    "a blur": ({ dom, tree }) => {
      tree.focus();
      dom.doc.focus_on(null);
    },
    "a click": ({ window }) => void window.fire("mousedown"),
    "a page hide": ({ dom }) => void dom.view.fire("pagehide", { target: dom.view }),
    "a new hello": async ({ firefox }) => {
      firefox.start_extension();
      await settle();
    },
    "the pref off": ({ firefox }) => firefox.set_pref(false),
    "its time": ({ window }) => window.run_timers(),
  };
  for (const [name, end] of Object.entries(ends)) {
    const env = started();
    await settle();
    env.tree.focus();
    assert.equal(env.press("g"), true, name);
    await end(env);
    assert.equal(env.press("t"), false, `t after ${name}`);
    assert.deepEqual(env.chords(), [], name);
  }
});

test("the hold keeps no timer once it ended", async () => {
  const { press, window } = started();
  await settle();
  press("g");
  assert.equal(window.timer_count(), 1);
  press("t");
  assert.equal(window.timer_count(), 0);
});

test("a g in another element does not complete in this one", async () => {
  const { press, dom, chords, tree } = started();
  await settle();
  const other = dom.element("div");
  press("g", {}, other);
  assert.equal(press("t", {}, tree), false);
  assert.deepEqual(chords(), []);
});

test("J and K switch browser tabs from DevTools, and a held g does not eat them", async () => {
  const { press, window } = started();
  await settle();
  assert.equal(press("J"), true);
  assert.equal(press("K"), true);
  press("g");
  assert.equal(press("J"), true);
  assert.deepEqual(window.tab_moves, [1, -1, 1]);
});

test("J and K in a field or with a modifier stay DevTools'", async () => {
  const { press, dom, window } = started();
  await settle();
  assert.equal(press("J", {}, dom.element("input")), false);
  assert.equal(press("J", { ctrlKey: true }), false);
  assert.deepEqual(window.tab_moves, []);
});

test("a table without the rows, as from an older extension, takes none of these keys", async () => {
  const { press, chords, window } = started({ table: protocol.DEVTOOLS_TREE_KEYS });
  await settle();
  press("g");
  assert.equal(press("t"), false);
  assert.equal(press("J"), false);
  assert.deepEqual(chords(), []);
  assert.deepEqual(window.tab_moves, []);
});

test("the Ctrl+] the module sends comes back to the core and passes: no row takes a Ctrl chord", async () => {
  const { press } = started();
  await settle();
  assert.equal(press("]", { ctrlKey: true, isTrusted: true }), false);
  assert.equal(press("[", { ctrlKey: true, isTrusted: true }), false);
});

test("J and K in a DevTools window act on the newest browser window, and not on a private window the module may not touch", async () => {
  const { firefox } = started();
  const devtools_window = firefox.make_window({ devtools_window: true });
  devtools_window.open();
  const normal = firefox.make_window();
  normal.load();
  normal.add_tab();
  const private_window = firefox.make_window({ private_window: true });
  private_window.load();
  private_window.add_tab();
  firefox.write_state(STATE);
  await settle();
  const target = devtools_window.devtools_document().element("div");
  const in_devtools_window = (key: string) => devtools_window.press(key_event(key, { target, originalTarget: target })).prevented;
  firefox.most_recent_window = normal.win;
  assert.equal(in_devtools_window("J"), true);
  assert.equal(in_devtools_window("K"), true);
  assert.deepEqual(normal.tab_moves, [1, -1]);
  firefox.most_recent_window = private_window.win;
  assert.equal(in_devtools_window("J"), false, "no private access: the key stays DevTools'");
  assert.deepEqual(private_window.tab_moves, []);
  firefox.most_recent_window = null;
  assert.equal(in_devtools_window("J"), false);
});
