import { RuntimeRefusal } from "../../shared/command.ts";
import { key_target } from "./send_key.ts";
import type { KeyTargetDocument } from "./send_key.ts";

export type ClipboardArgs = { action: "cut" | "copy" | "paste"; target?: string };

export type ClipboardDocument = KeyTargetDocument & { execCommand(command: string): boolean };

// A target that takes focus and listens, which is all the handler asks of the element.
type ClipboardTarget = EventTarget & { focus?: () => void };

// Runs `execCommand` first because it makes the browser fire the real, trusted event with the real clipboard, which is what Ctrl+X or Ctrl+V does. Where it fires nothing, a paste falls back to `paste_by_api`.
export async function clipboard_action(doc: ClipboardDocument, args: ClipboardArgs, paste_by_api: (target: EventTarget) => Promise<void>): Promise<void> {
  const target: ClipboardTarget = key_target(doc, args.target);
  target.focus?.();
  let event_fired = false;
  const mark = () => (event_fired = true);
  target.addEventListener(args.action, mark, { once: true });
  const accepted = doc.execCommand(args.action);
  target.removeEventListener(args.action, mark);
  if (accepted && event_fired) return;
  if (args.action !== "paste") throw new RuntimeRefusal(`The page did not take ${args.action}`);
  await paste_by_api(target);
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
  target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
}
