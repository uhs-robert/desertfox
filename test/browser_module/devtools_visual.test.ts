// Visual mode in DevTools, the module's half (browser_module/desertfox-devtools.js), against small stand-ins for the DevTools documents, their selection and a CodeMirror editor.
// It drives the key flow: `v` starts the mode in a text area or a code area, the mode's keys move the end of the selection, `y` copies, Escape and other keys end it, and each refusal.
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import * as protocol from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { create_firefox, key_event } from "./fake_firefox.ts";
import type { FakeEvent } from "./fake_firefox.ts";

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setImmediate(resolve));
const TABLE = [...protocol.DEVTOOLS_TREE_KEYS, protocol.DEVTOOLS_HINT_KEY, protocol.DEVTOOLS_VISUAL_KEY];
const STATE = { v: 1, enabled: true, keys: [{ key: "J", id: "tab.next", args: {} }], tabs: {} };
const SHOWN = { left: 0, top: 0, bottom: 500, right: 500, width: 500, height: 500 };
const BELOW = { left: 0, top: 900, bottom: 920, right: 500, width: 500, height: 20 };

type Listener = (event: Record<string, unknown>) => void;

// An element of a DevTools document: a tag, classes or an id for `closest`, children, and text nodes as `text` children.
class El {
  readonly nodeType = 1;
  localName: string;
  classes: string[];
  id: string;
  children: (El | Text)[] = [];
  parentNode: El | null = null;
  ownerDocument: Doc;
  isContentEditable = false;
  visible = true;
  box = SHOWN;
  dispatched: { key: string; shiftKey: boolean; ctrlKey: boolean }[] = [];
  constructor(doc: Doc, local_name: string, { classes = [] as string[], id = "" } = {}) {
    this.ownerDocument = doc;
    this.localName = local_name;
    this.classes = classes;
    this.id = id;
  }
  add(child: El | Text) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  matches(selector: string): boolean {
    return selector.split(",").some((one): boolean => {
      const part = one.trim().split(" ").at(-1)!;
      return part.startsWith("#") ? this.id === part.slice(1) : part.startsWith(".") ? this.classes.includes(part.slice(1)) : part === this.localName;
    });
  }
  closest(selector: string) {
    for (let node: El | null = this; node; node = node.parentNode) if (node.matches(selector)) return node;
    return null;
  }
  contains(other: unknown) {
    for (let node = other as { parentNode: El | null } | null; node; node = node.parentNode) if (node === this) return true;
    return false;
  }
  descendants(): (El | Text)[] {
    return this.children.flatMap((child) => (child instanceof El ? [child, ...child.descendants()] : [child]));
  }
  querySelector(selector: string) {
    return (this.descendants().find((node) => node instanceof El && node.matches(selector)) as El | undefined) ?? null;
  }
  checkVisibility() {
    return this.visible;
  }
  getBoundingClientRect() {
    return this.box;
  }
  // A CodeMirror editor gets the keys the module makes. They come back to the core's window listener, as a chrome-made key does in Firefox, and `on_key` says whether the module stopped one.
  on_key: (event: FakeEvent) => FakeEvent = (event) => event;
  dispatchEvent(event: { key: string; shiftKey: boolean; ctrlKey: boolean }) {
    this.dispatched.push({ key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey });
    return !this.on_key(key_event(event.key, { ...event, target: this, originalTarget: this })).prevented;
  }
}

class Text {
  readonly nodeType = 3;
  data: string;
  parentNode: El | null = null;
  constructor(data: string) {
    this.data = data;
  }
  get parentElement() {
    return this.parentNode;
  }
}

// The selection of one document. A `modify` keeps the focus in its text node, unless a test sets where the next one lands.
class Selection {
  calls: string[] = [];
  anchorNode: Text | null = null;
  focusNode: Text | null = null;
  focusOffset = 0;
  next_focus: Text | null = null;
  text = "selected";
  // CodeMirror's own selection, as the DOM shows it while the editor has the focus.
  isCollapsed = false;
  get rangeCount() {
    return this.focusNode ? 1 : 0;
  }
  collapse(node: Text, offset: number) {
    this.calls.push(`collapse ${node.data}@${offset}`);
    this.anchorNode = this.focusNode = node;
    this.focusOffset = offset;
  }
  extend(node: Text, offset: number) {
    this.calls.push(`extend ${node.data}@${offset}`);
    this.focusNode = node;
    this.focusOffset = offset;
  }
  modify(alter: string, direction: string, unit: string) {
    this.calls.push(`${alter} ${direction} ${unit}`);
    this.focusNode = this.next_focus ?? this.focusNode;
    this.next_focus = null;
  }
  toString() {
    return this.text;
  }
}

type Doc = ReturnType<typeof make_document>;

// A DevTools panel document at `url`, in a panel frame of the docked toolbox, as the core finds DevTools.
function make_document(url: string, toolbox_doc: unknown) {
  const listeners = new Map<string, Set<Listener>>();
  const commands: string[] = [];
  const doc = {
    documentURI: url,
    body: undefined as unknown as El,
    documentElement: undefined as unknown as El,
    selection: undefined as unknown as Selection,
    copy_text: "",
    cleared: 0,
    commands,
    listeners,
    querySelector: (selector: string) => doc.documentElement.querySelector(selector),
    // A filter's reject leaves out an element with all it holds, as a DOM tree walker does.
    createTreeWalker: (root: El, _what: number, filter?: { acceptNode(node: El | Text): number }) => {
      const walk = (element: El): (El | Text)[] => element.children.flatMap((child) => (filter?.acceptNode(child) === 2 ? [] : child instanceof El ? walk(child) : [child]));
      const nodes = walk(root);
      let index = -1;
      return { nextNode: () => nodes[++index] ?? null };
    },
    defaultView: {
      frameElement: { classList: { contains: () => false }, ownerDocument: toolbox_doc },
      browsingContext: { isContent: false },
      KeyboardEvent: class {
        type: string;
        constructor(type: string, init: Record<string, unknown>) {
          this.type = type;
          Object.assign(this, init);
        }
      },
      getSelection: () => doc.selection,
      addEventListener: (type: string, listener: Listener) => void listeners.set(type, (listeners.get(type) ?? new Set()).add(listener)),
      removeEventListener: (type: string, listener: Listener) => void listeners.get(type)?.delete(listener),
      // The copy command fires `copy`, with the text CodeMirror would put in it.
      docShell: {
        doCommand: (command: string) => {
          commands.push(command);
          const data = { getData: () => doc.copy_text, clearData: () => void doc.cleared++ };
          for (const listener of [...(listeners.get("copy") ?? [])]) listener({ clipboardData: data });
        },
      },
    },
  };
  doc.documentElement = new El(doc, "html");
  doc.body = doc.documentElement.add(new El(doc, "body")) as El;
  doc.selection = new Selection();
  return doc;
}

function started({ table = TABLE as unknown, visual_table = protocol.DEVTOOLS_VISUAL_KEYS as unknown } = {}) {
  const firefox = create_firefox();
  const copied: string[] = [];
  firefox.Components.classes["@mozilla.org/widget/clipboardhelper;1"] = { getService: () => ({ copyString: (text: string) => void copied.push(text) }) };
  firefox.Components.interfaces.nsIClipboardHelper = {};
  firefox.start_extension();
  const window = firefox.make_window();
  window.load();
  window.add_tab();
  firefox.write_state(STATE);
  const toolbox_doc = { defaultView: { frameElement: null, browsingContext: { isContent: false, embedderElement: { classList: { contains: (name: string) => name === "devtools-toolbox-iframe" }, ownerDocument: window.win.document } } } };
  const panel = (url: string) => make_document(url, toolbox_doc);

  // The console: an output with two shown messages, a third scrolled out, and the input, a CodeMirror editor.
  const console_doc = panel("chrome://devtools/content/webconsole/index.html");
  const output = console_doc.body.add(new El(console_doc, "div", { classes: ["webconsole-output"] })) as El;
  const messages = ["  ", "first line", "second line", "far below"].map((text) => {
    const message = output.add(new El(console_doc, "div", { classes: ["message"] })) as El;
    message.add(new Text(text));
    return message;
  });
  messages[3]!.box = BELOW;
  const input_editor = console_doc.body.add(new El(console_doc, "div", { classes: ["cm-editor"] })) as El;
  const input = input_editor.add(new El(console_doc, "div", { classes: ["cm-content"] })) as El;
  input.isContentEditable = true;

  // The Inspector: the rule view, and a toolbar outside it.
  const inspector_doc = panel("chrome://devtools/content/inspector/index.xhtml");
  const rules = inspector_doc.body.add(new El(inspector_doc, "div", { id: "ruleview-container" })) as El;
  const rule = rules.add(new El(inspector_doc, "div", { classes: ["ruleview-rule"] })) as El;
  rule.add(new Text("color: red"));
  const toolbar = inspector_doc.body.add(new El(inspector_doc, "div", { classes: ["devtools-toolbar"] })) as El;
  const toolbar_text = toolbar.add(new Text("Filter")) as Text;

  // The Debugger: a source in a CodeMirror editor.
  const debugger_doc = panel("chrome://devtools/content/debugger/index.html");
  const mount = debugger_doc.body.add(new El(debugger_doc, "div", { classes: ["editor-mount"] })) as El;
  const source = (mount.add(new El(debugger_doc, "div", { classes: ["cm-editor"] })) as El).add(new El(debugger_doc, "div", { classes: ["cm-content"] })) as El;
  source.isContentEditable = true;
  // The breakpoint condition: an editor that types, drawn inside the source's own content.
  const condition = (source.add(new El(debugger_doc, "div", { classes: ["cm-editor"] })) as El).add(new El(debugger_doc, "div", { classes: ["cm-content"] })) as El;
  condition.isContentEditable = true;
  // The logpoint's stack trace checkbox, in the same panel but outside the condition's editor.
  const stacktrace = source.add(new El(debugger_doc, "input")) as El;

  // The Network response: a CodeMirror editor and the filter box in one panel.
  const network_doc = panel("chrome://devtools/content/netmonitor/index.html");
  const response = network_doc.body.add(new El(network_doc, "div", { id: "response-panel" })) as El;
  const filter = response.add(new El(network_doc, "input")) as El;
  const response_source = (response.add(new El(network_doc, "div", { classes: ["cm-editor"] })) as El).add(new El(network_doc, "div", { classes: ["cm-content"] })) as El;

  // The markup view: a tag line, while the document keeps the focus.
  const markup_doc = panel("chrome://devtools/content/inspector/markup/markup.html");
  const tree = markup_doc.body.add(new El(markup_doc, "ul", { id: "root" })) as El;
  (tree.add(new El(markup_doc, "div", { classes: ["tag-line"] })) as El).add(new Text("section"));

  const press = (key: string, target: unknown, patch: Partial<FakeEvent> = {}) => window.press(key_event(key, { target, originalTarget: target, ...patch }));
  // The editor's keys come back to the window listener, as in Firefox.
  source.on_key = (event) => window.press(event);
  let pushes = 0;
  const push = async (kind: string, keys: unknown) => {
    firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [{ v: 1, id: `p${pushes++}`, kind, args: { keys }, sent_at: Date.now() }]);
    await settle();
  };
  const ready = async () => {
    if (visual_table !== null) await push("devtools.visual_keys", visual_table);
    if (table !== null) await push("devtools.keys", table);
  };
  return { firefox, window, copied, press, push, ready, markup_doc, console_doc, output, messages, input, inspector_doc, rules, rule, toolbar_text, debugger_doc, source, condition, stacktrace, filter, response_source };
}

test("the hello says devtools_visual, so the extension may push the v row and the mode's keys", async () => {
  const { firefox } = started();
  await settle();
  assert.equal((firefox.hello() as { devtools_visual?: boolean }).devtools_visual, true);
});

test("v in the console output selects the first shown character, word moves extend it, line moves do nothing there, and y copies and ends the mode", async () => {
  const { ready, press, output, console_doc, copied, window } = started();
  await ready();
  const event = press("v", output);
  assert.ok(event.prevented && event.stopped);
  assert.deepEqual(console_doc.selection.calls, ["collapse first line@0", "extend forward character"], "the blank message is skipped");
  console_doc.selection.calls = [];
  for (const key of ["w", "j", "k", "$", "b", "0", "h", "l"]) assert.ok(press(key, output).prevented, key);
  assert.deepEqual(console_doc.selection.calls, ["extend forward word", "extend forward lineboundary", "extend backward word", "extend backward lineboundary", "extend backward character", "extend forward character"]);
  assert.ok(press("y", output).prevented);
  assert.deepEqual(copied, ["selected"]);
  assert.equal(press("w", output).prevented, false, "the mode ended with the copy");
});

test("v starts at the focused message when the focus sits inside the area", async () => {
  const { ready, press, messages, console_doc } = started();
  await ready();
  press("v", messages[2]);
  assert.equal(console_doc.selection.calls[0], "collapse second line@0");
});

test("the area pass skips the focused message it already searched, so its blank text counts once against the limit", async () => {
  const { ready, press, messages, console_doc } = started();
  await ready();
  for (let index = 0; index < 3000; index++) messages[0]!.add(new Text(" "));
  assert.ok(press("v", messages[0]).prevented);
  assert.equal(console_doc.selection.calls[0], "collapse first line@0");
});

test("with the document itself focused, v starts at the area's first shown text", async () => {
  const { ready, press, console_doc } = started();
  await ready();
  press("v", console_doc.body);
  assert.deepEqual(console_doc.selection.calls, ["collapse first line@0", "extend forward character"]);
});

test("v in the markup view is DevTools', since its tag lines stop a selection at each span", async () => {
  const { ready, press, markup_doc } = started();
  await ready();
  assert.equal(press("v", markup_doc.body).prevented, false);
  assert.deepEqual(markup_doc.selection.calls, []);
});

test("a move that would leave the area goes back, so the rule view's selection never takes in the toolbar", async () => {
  const { ready, press, rules, inspector_doc, toolbar_text } = started();
  await ready();
  press("v", rules);
  inspector_doc.selection.calls = [];
  inspector_doc.selection.next_focus = toolbar_text;
  press("j", rules);
  assert.deepEqual(inspector_doc.selection.calls, ["extend forward line", "extend color: red@0"]);
});

test("Escape ends the mode, drops the selection and stays here, so DevTools opens no split console", async () => {
  const { ready, press, output, console_doc } = started();
  await ready();
  press("v", output);
  console_doc.selection.calls = [];
  const escape = press("Escape", output);
  assert.ok(escape.prevented && escape.stopped);
  assert.deepEqual(console_doc.selection.calls, ["collapse first line@0"]);
  assert.equal(press("Escape", output).prevented, false, "Escape after the mode is DevTools' again");
});

test("f, v and keys with no row do nothing in the mode, so no hints start and no tree moves", async () => {
  const { ready, press, output, console_doc, firefox } = started();
  await ready();
  press("v", output);
  console_doc.selection.calls = [];
  for (const key of ["f", "v", "x", "G"]) assert.ok(press(key, output).prevented, key);
  assert.deepEqual(console_doc.selection.calls, []);
  const sent = plain(firefox.read_holder("desertfox_browser_module_from_module") ?? []) as { kind?: string }[];
  assert.equal(sent.filter(({ kind }) => kind === "devtools_hints.ask").length, 0);
});

test("a named key or a chord ends the mode and goes on, keeping the selection; so does a click or the window leaving the front", async () => {
  const { ready, press, output, console_doc, window } = started();
  await ready();
  for (const [key, patch] of [["ArrowDown", {}], ["Tab", {}], ["c", { ctrlKey: true }]] as const) {
    press("v", output);
    console_doc.selection.calls = [];
    assert.equal(press(key, output, patch).prevented, false, key);
    assert.deepEqual(console_doc.selection.calls, [], `${key} dropped the selection`);
    assert.equal(press("w", output).prevented, false, `${key} left the mode on`);
  }
  for (const type of ["mousedown", "deactivate"]) {
    press("v", output);
    window.fire(type);
    assert.equal(press("w", output).prevented, false, type);
  }
});

test("the Debugger source gets CodeMirror's own Shift+arrow keys, its keys pass back through, and y runs the copy command", async () => {
  const { ready, press, source, debugger_doc, copied } = started();
  await ready();
  assert.ok(press("v", source).prevented, "the read-only editor of the code table starts the mode, though it is editable");
  for (const key of ["j", "k", "w", "b", "0", "$", "h", "l"]) press(key, source);
  assert.deepEqual(source.dispatched, [
    { key: "ArrowRight", shiftKey: false, ctrlKey: false },
    { key: "ArrowLeft", shiftKey: false, ctrlKey: false },
    { key: "ArrowRight", shiftKey: true, ctrlKey: false },
    { key: "ArrowDown", shiftKey: true, ctrlKey: false },
    { key: "ArrowUp", shiftKey: true, ctrlKey: false },
    { key: "ArrowRight", shiftKey: true, ctrlKey: true },
    { key: "ArrowLeft", shiftKey: true, ctrlKey: true },
    { key: "Home", shiftKey: true, ctrlKey: false },
    { key: "End", shiftKey: true, ctrlKey: false },
    { key: "ArrowLeft", shiftKey: true, ctrlKey: false },
    { key: "ArrowRight", shiftKey: true, ctrlKey: false },
  ]);
  debugger_doc.copy_text = "const a = 1;";
  assert.ok(press("y", source).prevented);
  assert.deepEqual(debugger_doc.commands, ["cmd_copy"]);
  assert.equal(debugger_doc.cleared, 0);
  assert.deepEqual(copied, [], "CodeMirror fills the clipboard itself");
  assert.equal(debugger_doc.listeners.get("copy")?.size ?? 0, 0, "the copy listener went");
});

test("v in a field inside a code area types there: the Debugger's breakpoint condition, its stack trace checkbox and the response filter box", async () => {
  const { ready, press, source, condition, stacktrace, filter, response_source } = started();
  await ready();
  assert.equal(press("v", condition).prevented, false, "the condition editor");
  assert.equal(press("v", stacktrace).prevented, false, "the checkbox");
  assert.equal(press("v", filter).prevented, false, "the filter box");
  assert.deepEqual([source.dispatched, condition.dispatched, response_source.dispatched], [[], [], []]);
  assert.ok(press("v", response_source).prevented, "the response editor itself still starts the mode");
});

test("y with CodeMirror's selection empty copies nothing, so the editor never copies its whole line", async () => {
  const { ready, press, source, debugger_doc } = started();
  await ready();
  press("v", source);
  press("h", source);
  debugger_doc.selection.isCollapsed = true;
  assert.ok(press("y", source).prevented);
  assert.deepEqual(debugger_doc.commands, []);
  assert.equal(press("w", source).prevented, false, "the mode ended");
});

test("Escape in a code area drops CodeMirror's selection with a plain arrow", async () => {
  const { ready, press, source } = started();
  await ready();
  press("v", source);
  assert.ok(press("Escape", source).prevented);
  assert.deepEqual(source.dispatched.at(-1), { key: "ArrowRight", shiftKey: false, ctrlKey: false });
});

test("a copy over the cap copies nothing, in a text area and in a code area", async () => {
  const { ready, press, output, console_doc, source, debugger_doc, copied } = started();
  await ready();
  press("v", output);
  console_doc.selection.text = "x".repeat(1_000_001);
  press("y", output);
  assert.deepEqual(copied, []);
  press("v", source);
  debugger_doc.copy_text = "x".repeat(1_000_001);
  press("y", source);
  assert.equal(debugger_doc.cleared, 1);
});

test("a key in a field ends the mode and types there, Escape too, also a field inside the source editor", async () => {
  for (const key of ["w", "Escape"]) {
    const { ready, press, output, input, console_doc } = started();
    await ready();
    press("v", output);
    console_doc.selection.calls = [];
    assert.equal(press(key, input).prevented, false, key);
    assert.deepEqual(console_doc.selection.calls, [], `${key} moved or dropped the selection`);
    assert.equal(press("w", output).prevented, false, `${key} left the mode on`);
  }
  // In the Debugger the condition editor and its checkbox sit inside the source's own content.
  for (const key of ["w", "Escape"]) {
    for (const field of ["condition", "stacktrace"] as const) {
      const fixture = started();
      const { ready, press, source } = fixture;
      await ready();
      press("v", source);
      const sent = source.dispatched.length;
      assert.equal(press(key, fixture[field]).prevented, false, `${key} in the ${field}`);
      assert.equal(source.dispatched.length, sent, `${key} in the ${field} moved or dropped the selection`);
      assert.equal(press("w", source).prevented, false, `${key} in the ${field} left the mode on`);
    }
  }
});

test("a copy that fails still ends the mode and lets its keys go", async () => {
  const { ready, press, output, firefox } = started();
  await ready();
  firefox.Components.classes["@mozilla.org/widget/clipboardhelper;1"] = {
    getService: () => ({
      copyString: () => {
        throw new Error("NS_ERROR_FAILURE");
      },
    }),
  };
  press("v", output);
  press("y", output);
  assert.equal(press("w", output).prevented, false);
});

test("v in the console input, an editable field of no area, types there", async () => {
  const { ready, press, input, console_doc } = started();
  await ready();
  assert.equal(press("v", input).prevented, false);
  assert.deepEqual(console_doc.selection.calls, []);
  assert.deepEqual(input.dispatched, []);
});

test("v outside any area, or in an area with no shown text, starts nothing", async () => {
  const { ready, press, inspector_doc, toolbar_text, rule } = started();
  await ready();
  assert.equal(press("v", toolbar_text.parentNode).prevented, false, "the toolbar is no area");
  rule.box = BELOW;
  assert.equal(press("v", rule).prevented, false, "no text shows in the rule view");
  assert.deepEqual(inspector_doc.selection.calls, []);
});

test("with no visual table, or with no v row, v starts nothing, and the tree keys still work", async () => {
  for (const setup of [{ visual_table: null }, { table: [...protocol.DEVTOOLS_TREE_KEYS, protocol.DEVTOOLS_HINT_KEY] }]) {
    const { ready, press, output, console_doc } = started(setup);
    await ready();
    assert.equal(press("v", output).prevented, false, JSON.stringify(setup));
    assert.deepEqual(console_doc.selection.calls, []);
    assert.ok(press("j", output).prevented, "j moves the tree");
  }
});

test("a bad visual table is dropped and the last good one stays: an op off the list, a long key, a repeated key, too many rows", async () => {
  const { ready, press, push, output, console_doc } = started();
  await ready();
  const bad_tables = [
    [{ key: "w", op: "eval" }],
    [{ key: "<C-c>", op: "copy" }],
    [{ key: "w", op: "copy" }, { key: "w", op: "word.back" }],
    Array.from({ length: 17 }, (_, index) => ({ key: String.fromCharCode(97 + index), op: "copy" })),
    [{ key: "w", action: "copy" }],
  ];
  for (const table of bad_tables) await push("devtools.visual_keys", table);
  press("v", output);
  console_doc.selection.calls = [];
  press("w", output);
  assert.deepEqual(console_doc.selection.calls, ["extend forward word"], "w still extends by a word");
});

test("a new hello drops the mode and its table, so a DesertFox that never pushes one gets no mode", async () => {
  const { ready, press, output, firefox } = started();
  await ready();
  press("v", output);
  firefox.start_extension();
  firefox.write_state(STATE);
  assert.equal(press("w", output).prevented, false, "the mode ended");
  assert.equal(press("v", output).prevented, false, "no table of the new DesertFox");
});

test("the pref off ends the mode", async () => {
  const { ready, press, output, firefox } = started();
  await ready();
  press("v", output);
  firefox.set_pref(false);
  firefox.set_pref(true);
  assert.equal(press("w", output).prevented, false);
});

test("the consent setting or the toolbar switch off ends the mode and its key hold, so it never resumes when the module comes back on", async () => {
  const { ready, press, output, firefox, window } = started();
  await ready();
  press("v", output);
  const core = firefox.Services.desertfox_browser_module as { keys_held_by(win: unknown): unknown };
  const seen_window = vm.runInContext("globalThis", window.win.context!);
  assert.equal(core.keys_held_by(seen_window), "devtools_visual");
  firefox.write_state({ ...STATE, enabled: false });
  assert.equal(core.keys_held_by(seen_window), undefined);
  firefox.write_state(STATE);
  assert.equal(press("w", output).prevented, false);
});
