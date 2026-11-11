import { RuntimeRefusal } from "../../shared/command.ts";

export type SendKeyArgs = { key: string; key_code: number; target?: string };

// What the handler needs from the page, so a test can pass a fake.
export type KeyTargetDocument = { querySelector(selector: string): EventTarget | null; activeElement: EventTarget | null };

// A page script cannot tell this event from a real press except by `isTrusted`, which DesertFox itself ignores, so the key does not loop back into the keymap.
export function send_key(doc: KeyTargetDocument, args: SendKeyArgs, make_event: (type: string, init: KeyboardEventInit) => Event): void {
  const element = args.target === undefined ? doc.activeElement : doc.querySelector(args.target);
  if (!element) throw new RuntimeRefusal(args.target === undefined ? "No focused element to send the key to" : `Nothing on the page matches ${args.target}`);
  const init = { key: args.key, keyCode: args.key_code, bubbles: true, cancelable: true };
  element.dispatchEvent(make_event("keydown", init));
  element.dispatchEvent(make_event("keyup", init));
}
