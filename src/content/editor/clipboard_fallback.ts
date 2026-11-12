// The way into editors that show only part of their text (CodeMirror, Ace, Monaco): their own select-all and copy read the whole document, and select-all and paste write it back. The clipboard is the only channel, so its text is saved first and put back after each use.

import { exec_clipboard_command } from "../site_actions/clipboard.ts";
import type { ClipboardCommandDocument } from "../site_actions/clipboard.ts";
import { copy_text } from "../caret/copy_text.ts";
import { deepest_focused_element } from "../editable.ts";
import { RuntimeRefusal } from "../../shared/command.ts";

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

// `execCommand("selectAll")` selects only the lines the editor drew, so the select-all is the editor's own Ctrl+A. An editor that handles the key cancels it. One that does not would copy only the line at the caret (what these editors copy with no selection), so an uncancelled key counts as a failure.
function select_all_then(field: HTMLElement, action: "copy" | "cut" | "paste"): void {
  // The focus check comes with the clipboard command. An editor that did not take focus loses only a selection.
  field.focus();
  const key = { key: "a", code: "KeyA", keyCode: 65, ctrlKey: true, bubbles: true, cancelable: true };
  if (field.dispatchEvent(new KeyboardEvent("keydown", key))) throw new RuntimeRefusal("The editor did not select all on Ctrl+A");
  // The untrusted paste event that `page.clipboard` falls back to is left out: with `clipboardRead` a paste through `execCommand` fires, or the page refused it.
  if (!exec_clipboard_command(page_document, field, action)) throw new RuntimeRefusal(`The page did not take ${action}`);
}

// A copy that did nothing leaves the clipboard as it was, which would open the old clipboard text as the document. A fresh marker tells the two apart.
async function copy_whole_text(field: HTMLElement): Promise<string> {
  const marker = `desertfox-marker-${crypto.randomUUID()}`;
  if (!(await copy_text(navigator.clipboard, marker))) throw new RuntimeRefusal("Could not write to the clipboard");
  select_all_then(field, "copy");
  const copied = await navigator.clipboard.readText();
  if (copied === marker) throw new RuntimeRefusal("The editor did not copy its text");
  return copied;
}

// Only text is saved, as the Clipboard API writes back only text. An image or HTML on the clipboard is lost, which the toast says.
async function with_clipboard_saved<T>(use: () => Promise<T>): Promise<T> {
  let saved: string;
  try {
    saved = await navigator.clipboard.readText();
  } catch {
    throw new RuntimeRefusal("Could not read the clipboard to save it");
  }
  try {
    return await use();
  } finally {
    await copy_text(navigator.clipboard, saved);
  }
}

// The clipboard text is back before the editor opens, so a navigation while it is open strands nothing there.
export const copy_through_clipboard = (field: HTMLElement): Promise<string> =>
  with_clipboard_saved(() => copy_whole_text(field)).catch((error: unknown) => {
    throw new RuntimeRefusal(`This editor shows only part of its text and its clipboard copy failed (${(error as Error).message}), so it cannot be edited externally`);
  });

// The same stale check as a plain field: the result goes in only while the editor still holds the text it opened with. An empty result is a cut, because pasting nothing leaves the selection in place.
export async function paste_through_clipboard(field: HTMLElement, text: string, original: string): Promise<PasteOutcome> {
  if (!field.isConnected) return "changed";
  try {
    return await with_clipboard_saved(async () => {
      if ((await copy_whole_text(field)) !== original) return "changed";
      if (text === "") {
        select_all_then(field, "cut");
        return "pasted";
      }
      if (!(await copy_text(navigator.clipboard, text))) return "refused";
      select_all_then(field, "paste");
      return "pasted";
    });
  } catch {
    return "refused";
  }
}
