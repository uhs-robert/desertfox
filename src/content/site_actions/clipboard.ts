import { RuntimeRefusal } from "../../shared/command.ts";
import { key_target } from "./send_key.ts";
import type { KeyTargetDocument } from "./send_key.ts";

export type ClipboardArgs = { action: "cut" | "copy" | "paste"; target?: string };

export type ClipboardCommandDocument = Pick<KeyTargetDocument, "activeElement"> & Pick<EventTarget, "addEventListener" | "removeEventListener"> & { execCommand(command: string): boolean };
export type ClipboardDocument = KeyTargetDocument & ClipboardCommandDocument;

// A target that takes focus and listens, which is all the handler asks of the element.
type ClipboardTarget = EventTarget & { focus?: () => void };

// Runs `execCommand` first because it makes the browser fire the real, trusted event with the real clipboard, which is what Ctrl+X or Ctrl+V does. Where it fires nothing, a paste falls back to `paste_by_api`.
export async function clipboard_action(doc: ClipboardDocument, args: ClipboardArgs, paste_by_api: (target: EventTarget) => Promise<void>): Promise<void> {
  const target = key_target(doc, args.target);
  if (exec_clipboard_command(doc, target, args.action)) return;
  if (args.action !== "paste") throw new RuntimeRefusal(`The page did not take ${args.action}`);
  await paste_by_api(target);
}

// Whether the page saw the event. The editor bundle calls it directly and so skips the selector lookup.
// The event is the proof the page saw the action, so the return value of `execCommand` is ignored: Firefox returns false when the page cancelled the event. The marker listens in the capture phase on the document, so a page listener that stops propagation cannot hide the event.
export function exec_clipboard_command(doc: ClipboardCommandDocument, target: ClipboardTarget, action: ClipboardArgs["action"]): boolean {
  target.focus?.();
  // `execCommand` fires on the focused element, so a target that did not take focus would paste into something else.
  if (doc.activeElement !== target) throw new RuntimeRefusal("The target did not take focus");
  let event_fired = false;
  const mark = () => (event_fired = true);
  doc.addEventListener(action, mark, { capture: true, once: true });
  doc.execCommand(action);
  doc.removeEventListener(action, mark, { capture: true });
  return event_fired;
}

// The fallback. The page sees an untrusted paste event that carries the clipboard text, and the HTML too where the browser lets the content script read it.
export async function paste_through_clipboard_api(target: EventTarget): Promise<void> {
  const data = new DataTransfer();
  try {
    for (const item of await navigator.clipboard.read()) {
      for (const type of ["text/plain", "text/html"]) if (item.types.includes(type)) data.setData(type, await (await item.getType(type)).text());
    }
  } catch {
    // `read` can be missing or refused where `readText` works.
  }
  if (data.types.length === 0) {
    try {
      data.setData("text/plain", await navigator.clipboard.readText());
    } catch {
      throw new RuntimeRefusal("Could not read the clipboard to paste");
    }
  }
  // A page that uses the paste cancels it. An uncancelled event did nothing, and a silent `p` is worse than a toast.
  const page_used_it = !target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  if (!page_used_it) throw new RuntimeRefusal("The page did not use the pasted text");
}
