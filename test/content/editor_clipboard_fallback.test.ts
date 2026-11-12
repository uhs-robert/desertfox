import assert from "node:assert/strict";
import { test } from "node:test";

// A fake page with one clipboard and a code editor that handles Ctrl+A, copy, cut and paste itself, as CodeMirror, Ace and Monaco do.
const clipboard = { text: "saved by the user", reads_fail: false, writes: [] as string[] };
const capture_listeners = new Map<string, () => void>();
let exec_log: string[] = [];

class FakeHTMLElement {
  tagName = "DIV";
  isContentEditable = true;
  isConnected = true;
  innerText = "the slice on screen";
  // The whole document, which only the editor's own copy reveals.
  doc = "";
  takes_ctrl_a = true;
  takes_focus = true;
  // An editor can see the copy event and still put nothing on the clipboard.
  copies = true;
  selected_all = false;
  on_copy: (() => void) | undefined;
  focus() {
    if (this.takes_focus) page_document.activeElement = this;
  }
  closest(selector: string) {
    return selector.includes(".cm-editor") ? this : null;
  }
  dispatchEvent(event: { type: string; ctrlKey?: boolean; key?: string }) {
    if (event.type === "keydown" && event.ctrlKey && event.key === "a" && this.takes_ctrl_a) {
      this.selected_all = true;
      return false;
    }
    return true;
  }
}
class FakeHTMLInputElement extends FakeHTMLElement {}
class FakeHTMLTextAreaElement extends FakeHTMLElement {}
class FakeKeyboardEvent {
  type: string;
  constructor(type: string, init: Record<string, unknown>) {
    this.type = type;
    Object.assign(this, init);
  }
}

const page_document = {
  activeElement: null as FakeHTMLElement | null,
  addEventListener: (type: string, listener: () => void) => capture_listeners.set(type, listener),
  removeEventListener: (type: string) => capture_listeners.delete(type),
  execCommand(command: string) {
    exec_log.push(command);
    const editor = page_document.activeElement;
    if (!editor || !editor.selected_all) return false;
    editor.on_copy?.();
    if ((command === "copy" || command === "cut") && editor.copies) clipboard.text = editor.doc;
    if (command === "cut") editor.doc = "";
    if (command === "paste") editor.doc = clipboard.text;
    editor.selected_all = false;
    capture_listeners.get(command)?.();
    return true;
  },
};

const globals = globalThis as Record<string, unknown>;
globals.HTMLElement = FakeHTMLElement;
globals.HTMLInputElement = FakeHTMLInputElement;
globals.HTMLTextAreaElement = FakeHTMLTextAreaElement;
globals.KeyboardEvent = FakeKeyboardEvent;
globals.document = page_document;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    clipboard: {
      readText: async () => {
        if (clipboard.reads_fail) throw new Error("denied");
        return clipboard.text;
      },
      writeText: async (text: string) => {
        clipboard.writes.push(text);
        clipboard.text = text;
      },
    },
  },
});

type Handler = (args: Record<string, unknown>) => Promise<void> | void;
const handlers = new Map<string, Handler>();
const toasts: string[] = [];
const sent: Record<string, unknown>[] = [];
let answer: unknown = { ok: true };
let listener: ((message: unknown) => Promise<boolean> | undefined) | undefined;
// What the clipboard held when the background got the open, which is when the editor starts.
let clipboard_at_open = "";

globals.window = { desertfox_host: { register_handler_: (id: string, handler: Handler) => handlers.set(id, handler), show_toast_: (message: string) => toasts.push(message) } };
globals.browser = {
  runtime: {
    sendMessage: async (message: Record<string, unknown>) => {
      sent.push(message);
      if (message.type === "editor_open") clipboard_at_open = clipboard.text;
      return message.type === "editor_open" ? answer : { ok: true };
    },
    onMessage: { addListener: (fn: typeof listener) => (listener = fn) },
  },
};
await import("../../src/content/editor/main.ts");

const run = async (): Promise<void> => handlers.get("text.edit_external")!({});
const opened = () => sent.filter((message) => message.type === "editor_open").at(-1) as { token: string; text: string };
const done = (text: string, token = opened().token) => listener!({ type: "editor_done", token, text });
const yanked = () => sent.filter((message) => message.type === "register_yank");
const reset = () => ((sent.length = 0), (toasts.length = 0), (exec_log = []), (answer = { ok: true }), (clipboard.text = "saved by the user"), (clipboard.reads_fail = false), (clipboard.writes = []), (clipboard_at_open = ""));
const editor = (doc: string) => {
  const field = Object.assign(new FakeHTMLElement(), { doc });
  page_document.activeElement = field;
  return field;
};
const opened_editor = async (doc: string) => {
  const field = editor(doc);
  await run();
  return field;
};

test("a code editor opens its whole text, copied through the clipboard, and the clipboard is back before the editor starts", async () => {
  reset();
  await opened_editor("line 1\nline 2\nline 300");
  assert.equal(opened().text, "line 1\nline 2\nline 300");
  assert.equal(clipboard_at_open, "saved by the user", "navigation while the editor is open strands nothing on the clipboard");
  assert.equal(clipboard.text, "saved by the user");
  assert.deepEqual(exec_log, ["copy"]);
  assert.match(toasts.at(-1) ?? "", /went through the clipboard/);
});

test("an unchanged editor takes the result by select-all and paste, and the clipboard is back after", async () => {
  reset();
  const field = await opened_editor("draft");
  assert.equal(await done("final"), true);
  assert.equal(field.doc, "final");
  assert.deepEqual(exec_log, ["copy", "copy", "paste"]);
  assert.equal(clipboard.text, "saved by the user");
  assert.equal(yanked().length, 0);
});

test("an empty result clears the editor with a cut, because pasting nothing leaves the selection", async () => {
  reset();
  const field = await opened_editor("draft");
  await done("");
  assert.equal(field.doc, "");
  assert.equal(exec_log.at(-1), "cut");
  assert.equal(clipboard.text, "saved by the user");
});

test("a copy that leaves the marker on the clipboard keeps the refusal, restores the clipboard and sends nothing", async () => {
  reset();
  editor("draft").copies = false;
  await assert.rejects(run(), /only part of its text.*copy.*failed.*cannot be edited externally/);
  assert.equal(clipboard.text, "saved by the user");
  assert.equal(sent.length, 0);
  // The editor ignores the copy: its page never sees the event.
  reset();
  const ignoring = editor("draft");
  ignoring.dispatchEvent = () => false;
  await assert.rejects(run(), /did not take copy/);
  assert.equal(clipboard.text, "saved by the user");
});

test("an editor that does not cancel the synthetic Ctrl+A is refused, as its copy would hold only the line at the caret", async () => {
  reset();
  const field = editor("draft");
  field.takes_ctrl_a = false;
  await assert.rejects(run(), /did not select all/);
  assert.equal(clipboard.text, "saved by the user");
  assert.deepEqual(exec_log, []);
});

test("a clipboard that cannot be read is refused before anything is written to it", async () => {
  reset();
  editor("draft");
  clipboard.reads_fail = true;
  await assert.rejects(run(), /Could not read the clipboard/);
  assert.deepEqual(clipboard.writes, []);
  assert.equal(sent.length, 0);
});

test("a page copy handler that throws still gets the clipboard restored, at the open and at the return", async () => {
  reset();
  const field = editor("draft");
  field.on_copy = () => {
    throw new Error("page bug");
  };
  await assert.rejects(run(), /page bug/);
  assert.equal(clipboard.text, "saved by the user");
  field.on_copy = undefined;
  await run();
  field.on_copy = () => {
    throw new Error("page bug");
  };
  await done("final");
  assert.equal(field.doc, "draft");
  assert.equal(clipboard.text, "saved by the user");
  assert.deepEqual(yanked().at(-1), { type: "register_yank", name: "", text: "final" });
});

test("a refusal from the background still leaves the clipboard restored and waits for nothing", async () => {
  reset();
  await editor("draft");
  answer = { ok: false, message: "An editor is already open for this tab" };
  await assert.rejects(run(), /already open/);
  assert.equal(clipboard.text, "saved by the user");
  assert.equal(await done("final"), false);
});

test("an editor whose text changed meanwhile keeps it, and the result goes to the register", async () => {
  reset();
  const field = await opened_editor("draft");
  field.doc = "draft, then typed";
  await done("final");
  assert.equal(field.doc, "draft, then typed");
  assert.deepEqual(exec_log, ["copy", "copy"]);
  assert.deepEqual(yanked().at(-1), { type: "register_yank", name: "", text: "final" });
  assert.match(toasts.at(-1) ?? "", /field changed.*unnamed register/);
  assert.equal(clipboard.text, "saved by the user");
});

test("an editor removed or replaced before the return is not touched, and the clipboard is not used", async () => {
  reset();
  const field = await opened_editor("draft");
  field.isConnected = false;
  const writes_before = clipboard.writes.length;
  await done("final");
  assert.deepEqual(exec_log, ["copy"]);
  assert.equal(clipboard.writes.length, writes_before);
  assert.match(toasts.at(-1) ?? "", /field changed/);
  assert.equal(yanked().length, 1);
});

test("focus that moved away is taken back for the paste, and an editor that will not take it sends the result to the register", async () => {
  reset();
  const field = await opened_editor("draft");
  page_document.activeElement = new FakeHTMLElement();
  await done("final");
  assert.equal(field.doc, "final", "the paste refocused the editor");
  reset();
  const stubborn = await opened_editor("draft");
  page_document.activeElement = new FakeHTMLElement();
  stubborn.takes_focus = false;
  await done("final");
  assert.equal(stubborn.doc, "draft");
  assert.match(toasts.at(-1) ?? "", /did not take the edited text.*unnamed register/);
  assert.equal(clipboard.text, "saved by the user");
});

test("a second return for the same job, even while the first is still pasting, writes nothing", async () => {
  reset();
  const field = await opened_editor("draft");
  const token = opened().token;
  const first = done("final", token);
  const second = done("other", token);
  assert.equal(await second, false);
  assert.equal(await first, true);
  assert.equal(field.doc, "final");
  assert.equal(await done("again", token), false);
  assert.equal(field.doc, "final");
  assert.equal(clipboard.text, "saved by the user");
});
