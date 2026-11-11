import { RuntimeRefusal } from "../../shared/command.ts";

export type SendKeyArgs = { key: string; key_code: number; target?: string };

// What the handler needs from the page, so a test can pass a fake.
export type KeyTargetDocument = { querySelector(selector: string): EventTarget | null; activeElement: EventTarget | null };

// The validator hands an omitted optional string over as "", so "" means no target.
function key_target(doc: KeyTargetDocument, selector: string | undefined): EventTarget {
  if (selector === undefined || selector === "") return doc.activeElement ?? refuse("No focused element to send the key to");
  let found: EventTarget | null;
  try {
    found = doc.querySelector(selector);
  } catch {
    return refuse(`${selector} is not a valid CSS selector`);
  }
  return found ?? refuse(`Nothing on the page matches ${selector}`);
}

const refuse = (message: string): never => {
  throw new RuntimeRefusal(message);
};

// A page script cannot tell this event from a real press except by `isTrusted`, which DesertFox itself ignores, so the key does not loop back into the keymap.
export function send_key(doc: KeyTargetDocument, args: SendKeyArgs, make_event: (type: string, init: KeyboardEventInit) => Event): void {
  const element = key_target(doc, args.target);
  const init = { key: args.key, keyCode: args.key_code, bubbles: true, cancelable: true };
  element.dispatchEvent(make_event("keydown", init));
  element.dispatchEvent(make_event("keyup", init));
}

// Sheets applies only the first of several key pairs that arrive in the same millisecond. Pairs 4 ms apart all land, and 10 ms leaves margin.
export const KEY_PAIR_GAP_MS = 10;

// One queue per page, so a count and two quick separate calls all keep their order and their gap. A refusal rejects its own call and leaves the queue running.
let queue_tail: Promise<unknown> = Promise.resolve();
let last_sent_at = Number.NEGATIVE_INFINITY;

export function send_key_queued(doc: KeyTargetDocument, args: SendKeyArgs, make_event: (type: string, init: KeyboardEventInit) => Event): Promise<void> {
  const run = async () => {
    const wait_ms = last_sent_at + KEY_PAIR_GAP_MS - Date.now();
    if (wait_ms > 0) await new Promise((resolve) => setTimeout(resolve, wait_ms));
    last_sent_at = Date.now();
    send_key(doc, args, make_event);
  };
  const result = queue_tail.then(run);
  queue_tail = result.catch(() => undefined);
  return result;
}
