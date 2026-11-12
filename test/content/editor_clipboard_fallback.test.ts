import assert from "node:assert/strict";
import { test } from "node:test";

// A fake page with one clipboard and a code editor that handles Ctrl+A, copy, cut and paste itself, as CodeMirror, Ace and Monaco do. Like them, it copies the caret line when nothing is selected, pastes at the caret, and keeps a selection after a copy.
const clipboard = { text: "saved by the user", reads_fail: false, writes: [] as string[], refuses: undefined as string | undefined, on_write: undefined as ((text: string) => void) | undefined };
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
  // A vim or emacs keymap cancels Ctrl+A but runs another command.
  ctrl_a_selects = true;
  read_only = false;
  sees_clipboard_events = true;
  // The lines on screen, a slice of `doc`.
  drawn_lines: string[] = [];
  takes_focus = true;
  // An editor can see the copy event and still put nothing on the clipboard.
  copies = true;
  selected_all = false;
  on_copy: (() => void) | undefined;
  focus() {
    if (this.takes_focus) page_document.activeElement = this;
  }
  closest(selector: string) {
    return selector.includes(".cm-editor") ? { querySelectorAll: () => this.drawn_lines.map((innerText) => ({ innerText })) } : null;
  }
  dispatchEvent(event: { type: string; ctrlKey?: boolean; metaKey?: boolean; key?: string }) {
    const select_all_key = navigator.platform === "MacIntel" ? event.metaKey : event.ctrlKey;
    if (event.type === "keydown" && select_all_key && event.key === "a" && this.takes_ctrl_a) {
      if (this.ctrl_a_selects) this.selected_all = true;
      return false;
    }
    if (event.key === "ArrowLeft") this.selected_all = false;
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
    if (!editor || !editor.sees_clipboard_events) return false;
    editor.on_copy?.();
    const copied = editor.selected_all ? editor.doc : `${editor.doc.split("\n")[0]}\n`;
    if ((command === "copy" || command === "cut") && editor.copies) clipboard.text = copied;
    if (!editor.read_only) {
      if (command === "cut") editor.doc = editor.selected_all ? "" : editor.doc;
      if (command === "paste") editor.doc = editor.selected_all ? clipboard.text : clipboard.text + editor.doc;
    }
    if (command !== "copy") editor.selected_all = false;
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
    platform: "Linux x86_64",
    clipboard: {
      readText: async () => {
        if (clipboard.reads_fail) throw new Error("denied");
        return clipboard.text;
      },
      writeText: async (text: string) => {
        if (text === clipboard.refuses) throw new Error("denied");
        clipboard.on_write?.(text);
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
const reset = () => ((sent.length = 0), (toasts.length = 0), (exec_log = []), (answer = { ok: true }), (clipboard.text = "saved by the user"), (clipboard.reads_fail = false), (clipboard.writes = []), (clipboard.refuses = undefined), (clipboard.on_write = undefined), (clipboard_at_open = ""));
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
  assert.match(toasts.at(-1) ?? "", /Used the clipboard/);
});

test("an unchanged editor takes the result by select-all and paste, and the clipboard is back after", async () => {
  reset();
  const field = await opened_editor("draft");
  assert.equal(await done("final"), true);
  assert.equal(field.doc, "final");
  assert.deepEqual(exec_log, ["copy", "copy", "paste", "copy"], "the last copy reads the result back");
  assert.equal(clipboard.text, "saved by the user");
  assert.equal(yanked().length, 0);
});

test("an empty result clears the editor with a cut, because pasting nothing leaves the selection", async () => {
  reset();
  const field = await opened_editor("draft");
  await done("");
  assert.equal(field.doc, "");
  assert.deepEqual(exec_log.slice(-2), ["cut", "copy"]);
  assert.equal(clipboard.text, "saved by the user");
});

test("a copy that leaves the marker on the clipboard keeps the refusal, restores the clipboard and sends nothing", async () => {
  reset();
  editor("draft").copies = false;
  await assert.rejects(run(), /only part of its text.*its clipboard copy failed: The editor did not copy its text/);
  assert.equal(clipboard.text, "saved by the user");
  assert.equal(sent.length, 0);
  // The editor ignores the copy: its page never sees the event.
  reset();
  const ignoring = editor("draft");
  ignoring.sees_clipboard_events = false;
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

test("an editor that cancels Ctrl+A but runs another command (a vim or emacs keymap) copies the caret line, which is refused as it misses drawn lines", async () => {
  reset();
  const field = editor("line 1\nline 2\nline 3");
  field.drawn_lines = ["line 1", "line 2", "line 3"];
  field.ctrl_a_selects = false;
  await assert.rejects(run(), /misses lines the editor shows/);
  assert.equal(clipboard.text, "saved by the user");
  assert.equal(sent.length, 0);
});

test("a paste the editor sees but drops (a read-only editor) is read back, and the result goes to the register", async () => {
  reset();
  const field = await opened_editor("draft");
  field.read_only = true;
  await done("final");
  assert.equal(field.doc, "draft");
  assert.deepEqual(yanked().at(-1), { type: "register_yank", name: "", text: "final" });
  assert.match(toasts.at(-1) ?? "", /did not take the edited text/);
  assert.equal(clipboard.text, "saved by the user");
});

test("no select-all is left behind for the next key to replace: after the open, a changed return and a dropped paste", async () => {
  reset();
  const field = await opened_editor("draft");
  assert.equal(field.selected_all, false, "after the open");
  field.doc = "draft, then typed";
  await done("final");
  assert.equal(field.selected_all, false, "after a changed return");
  reset();
  const read_only = await opened_editor("draft");
  read_only.read_only = true;
  await done("final");
  assert.equal(read_only.selected_all, false, "after a dropped paste");
  reset();
  const too_big = editor("x".repeat(128 * 1024 + 1));
  await assert.rejects(run(), /over the 128 KiB/);
  assert.equal(too_big.selected_all, false, "after a size refusal");
});

test("an edit on screen while the result goes onto the clipboard is seen before the paste", async () => {
  reset();
  const field = editor("draft");
  field.drawn_lines = ["draft"];
  await run();
  clipboard.on_write = (text) => {
    if (text !== "final") return;
    field.doc = "draft, edited by a collaborator";
    field.drawn_lines = ["draft, edited by a collaborator"];
  };
  await done("final");
  assert.equal(field.doc, "draft, edited by a collaborator");
  assert.match(toasts.at(-1) ?? "", /field changed/);
  assert.equal(yanked().length, 1);
});

test("a clipboard that cannot be restored refuses the open, and after a paste the toast says so instead of the success", async () => {
  reset();
  editor("draft");
  clipboard.refuses = "saved by the user";
  await assert.rejects(run(), /[Cc]lipboard could not be restored/);
  assert.equal(sent.length, 0);
  reset();
  const field = await opened_editor("draft");
  clipboard.refuses = "saved by the user";
  await done("final");
  assert.equal(field.doc, "final");
  assert.match(toasts.at(-1) ?? "", /[Cc]lipboard could not be restored/);
  assert.doesNotMatch(toasts.at(-1) ?? "", /Its text is back/);
});

test("on macOS the select-all is Cmd+A", async () => {
  reset();
  const platform = navigator.platform;
  Object.assign(navigator, { platform: "MacIntel" });
  try {
    await opened_editor("draft");
    assert.equal(opened().text, "draft");
  } finally {
    Object.assign(navigator, { platform });
  }
});

test("two quick presses run one after the other, so the second never saves the first one's marker as the user's clipboard", async () => {
  reset();
  editor("draft");
  let second: Promise<void> | undefined;
  clipboard.on_write = (text) => {
    // The second press reads the clipboard once the marker is on it.
    if (text.startsWith("desertfox-marker-")) second ??= Promise.resolve().then(run);
  };
  await run();
  await second;
  assert.equal(clipboard.text, "saved by the user");
  assert.equal(clipboard_at_open, "saved by the user");
});

test("a paste that shortens the document passes the read-back while the drawn lines still show the old text, as Ace and Monaco redraw on the next frame", async () => {
  reset();
  const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1} of the snippet`);
  const field = editor(lines.join("\n"));
  field.drawn_lines = lines;
  await run();
  await done("short");
  assert.equal(field.doc, "short");
  assert.equal(yanked().length, 0);
  assert.match(toasts.at(-1) ?? "", /Used the clipboard/);
});

test("a caret-line copy at least as long as the drawn lines is still refused, because it misses a drawn line", async () => {
  reset();
  const field = editor("a much longer first line at the caret\nline 2\nline 3");
  field.drawn_lines = ["line 2", "line 3"];
  field.ctrl_a_selects = false;
  await assert.rejects(run(), /misses lines the editor shows/);
  assert.equal(sent.length, 0);
  assert.equal(clipboard.text, "saved by the user");
});

test("an empty result that a read-only editor of only whitespace drops is not taken as cleared", async () => {
  reset();
  const field = await opened_editor("   ");
  field.read_only = true;
  await done("");
  assert.equal(field.doc, "   ");
  assert.deepEqual(yanked().at(-1), { type: "register_yank", name: "", text: "" });
  assert.match(toasts.at(-1) ?? "", /did not take the edited text/);
});
