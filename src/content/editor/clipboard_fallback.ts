// The way into editors that show only part of their text (CodeMirror, Ace, Monaco): their own select-all and copy read the whole document, and select-all and paste write it back. The clipboard is the only channel, so its text is saved first and put back after each use.

import { exec_clipboard_command } from "../site_actions/clipboard.ts";
import type { ClipboardCommandDocument } from "../site_actions/clipboard.ts";
import { queued_in_page } from "../site_actions/send_key.ts";
import { copy_text } from "../caret/copy_text.ts";
import { deepest_focused_element } from "../editable.ts";
import { RuntimeRefusal } from "../../shared/command.ts";

// Editors that draw only the lines near the viewport, or keep the focus in a hidden textarea. What they expose is a slice of the document.
export const VIRTUALIZED_EDITOR = ".cm-editor, .CodeMirror, .monaco-editor, .ace_editor";
// One element per drawn line in CodeMirror 6, CodeMirror 5, Ace and Monaco. The gutters sit outside them.
const DRAWN_LINE = ".cm-line, .CodeMirror-line, .ace_line, .view-line";

const { clipboard } = navigator;

export const CLIPBOARD_NOT_RESTORED = "The clipboard could not be restored";

export type PasteOutcome = "pasted" | "changed" | "refused";

// A field inside a shadow root shows in `document.activeElement` only as its host, so the focus check walks down.
const page_document: ClipboardCommandDocument = {
  get activeElement() {
    return deepest_focused_element();
  },
  addEventListener: (...args: Parameters<Document["addEventListener"]>) => document.addEventListener(...args),
  removeEventListener: (...args: Parameters<Document["removeEventListener"]>) => document.removeEventListener(...args),
  execCommand: (command) => document.execCommand(command),
};

const drawn_lines = (field: HTMLElement): string[] => Array.from(field.closest(VIRTUALIZED_EDITOR)?.querySelectorAll<HTMLElement>(DRAWN_LINE) ?? [], (line) => line.innerText);

const send_key = (field: HTMLElement, init: KeyboardEventInit): boolean => field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

// `execCommand("selectAll")` selects only the lines the editor drew, so the select-all is the editor's own Ctrl+A (Cmd+A on macOS). An editor that handles the key cancels it. One that does not would copy only the line at the caret (what these editors copy with no selection), so an uncancelled key counts as a failure.
function select_all_then(field: HTMLElement, action: "copy" | "cut" | "paste"): void {
  // The focus check comes with the clipboard command. An editor that did not take focus loses only a selection.
  field.focus();
  const modifier = /Mac/.test(navigator.platform) ? "metaKey" : "ctrlKey";
  if (send_key(field, { key: "a", code: "KeyA", keyCode: 65, [modifier]: true })) throw new RuntimeRefusal("The editor did not select all");
  // The untrusted paste event that `page.clipboard` falls back to is left out: with `clipboardRead` a paste through `execCommand` fires, or the page refused it.
  if (!exec_clipboard_command(page_document, field, action)) throw new RuntimeRefusal(`The page did not take ${action}`);
}

// A select-all left in place lets the next typed key replace the whole document. The arrow puts the caret at the start of the document.
const collapse_selection = (field: HTMLElement): void => void send_key(field, { key: "ArrowLeft", keyCode: 37 });

// A copy that did nothing leaves the clipboard as it was, which would open the old clipboard text as the document. A fresh marker tells the two apart.
async function copy_whole_text(field: HTMLElement): Promise<string> {
  const marker = `desertfox-marker-${crypto.randomUUID()}`;
  if (!(await copy_text(clipboard, marker))) throw new RuntimeRefusal("Could not write to the clipboard");
  select_all_then(field, "copy");
  const copied = await clipboard.readText();
  if (copied === marker) throw new RuntimeRefusal("The editor did not copy its text");
  return copied;
}

async function copy_then_collapse(field: HTMLElement): Promise<string> {
  try {
    return await copy_whole_text(field);
  } finally {
    collapse_selection(field);
  }
}

// An editor can bind Ctrl+A to another command (vim's increment, emacs's line start) and still cancel it. Its copy then holds the caret line only, which misses the other lines it draws. The compare drops whitespace, as Monaco and Ace draw tabs and spaces as other characters.
// Only the open checks this. Ace and Monaco redraw on the next frame, so after a paste the drawn lines are stale, and the return compares whole texts instead.
async function copy_covering_drawn(field: HTMLElement): Promise<string> {
  const drawn = drawn_lines(field);
  const copied = await copy_then_collapse(field);
  const squeeze = (text: string) => text.replace(/\s+/g, "");
  const whole = squeeze(copied);
  let at = 0;
  if (!drawn.every((line) => (at = whole.indexOf(squeeze(line), at)) >= 0)) throw new RuntimeRefusal("The copy misses lines the editor shows");
  return copied;
}

// Only text is saved, as the Clipboard API writes back only text. An image or HTML on the clipboard is lost, which the toast says. A failed save refuses before anything is written.
async function with_clipboard_saved<T>(use: () => Promise<T>): Promise<{ value?: T; error?: unknown; restored: boolean }> {
  let saved: string;
  try {
    saved = await clipboard.readText();
  } catch {
    throw new RuntimeRefusal("Could not read the clipboard");
  }
  const settled = await use().then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  return { ...settled, restored: await copy_text(clipboard, saved) };
}

// The clipboard text is back before the editor opens, so a navigation while it is open strands nothing there. One queue per page keeps a second press from saving the first press's marker as the user's clipboard.
export const copy_through_clipboard = (field: HTMLElement): Promise<string> =>
  queued_in_page(async () => {
    let why: string;
    try {
      const { value, error, restored } = await with_clipboard_saved(() => copy_covering_drawn(field));
      if (restored && value !== undefined) return value;
      why = restored ? (error as Error).message : CLIPBOARD_NOT_RESTORED;
    } catch (error) {
      why = (error as Error).message;
    }
    throw new RuntimeRefusal(`This editor shows only part of its text, and its clipboard copy failed: ${why}`);
  });

// The same stale check as a plain field: the result goes in only while the editor still holds the text it opened with. An empty result is a cut, because pasting nothing leaves the selection in place.
async function replace_whole_text(field: HTMLElement, text: string, original: string): Promise<PasteOutcome> {
  let replaced = false;
  try {
    if ((await copy_whole_text(field)) !== original) return "changed";
    const drawn_at_check = drawn_lines(field).join();
    if (!(await copy_text(clipboard, text))) return "refused";
    // The page can change the editor while the result goes onto the clipboard. The drawn lines are read again with no await before the paste, so a change on screen in that gap is seen. A change to an undrawn line in that gap is not.
    if (drawn_lines(field).join() !== drawn_at_check) return "changed";
    select_all_then(field, text === "" ? "cut" : "paste");
    replaced = true;
  } finally {
    if (!replaced) collapse_selection(field);
  }
  // A paste event proves only that the editor saw it. A read-only editor drops the text, so the document is read back. An empty document copies as nothing (the marker stays) or, where the editor copies the caret line, as one line break.
  const now_holds = await copy_then_collapse(field).catch(() => "");
  return now_holds === text || (text === "" && now_holds === "\n") ? "pasted" : "refused";
}

export function paste_through_clipboard(field: HTMLElement, text: string, original: string): Promise<{ outcome: PasteOutcome; restored: boolean }> {
  if (!field.isConnected) return Promise.resolve({ outcome: "changed", restored: true });
  return queued_in_page(async () => {
    const { value, restored } = await with_clipboard_saved(() => replace_whole_text(field, text, original));
    return { outcome: value ?? "refused", restored };
  }).catch(() => ({ outcome: "refused" as const, restored: true }));
}
