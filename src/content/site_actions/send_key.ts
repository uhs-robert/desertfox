import { RuntimeRefusal } from "../../shared/command.ts";
import { SEND_KEY_MAX_TIMES } from "../../shared/send_key_limit.ts";

export type SendKeyArgs = { key: string; key_code: number; target?: string; times?: number; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean; keypress?: boolean };

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
  const init = { key: args.key, keyCode: args.key_code, ctrlKey: args.ctrl === true, shiftKey: args.shift === true, altKey: args.alt === true, metaKey: args.meta === true, bubbles: true, cancelable: true };
  const keydown_kept = element.dispatchEvent(make_event("keydown", init));
  // A page that cancels the keydown gets no keypress, as with a real key. A printable key carries its character code, which keypress handlers read.
  if (args.keypress === true && keydown_kept) element.dispatchEvent(make_event("keypress", args.key.length === 1 ? { ...init, charCode: args.key.charCodeAt(0), which: args.key.charCodeAt(0) } : init));
  element.dispatchEvent(make_event("keyup", init));
}

// Sheets applies only the first of several key pairs that arrive in the same millisecond. Pairs 4 ms apart all land, and 10 ms leaves margin.
export const KEY_PAIR_GAP_MS = 10;

// One queue per page. A call is one entry, so all its pairs go out before the next call starts: a count never has another key land between its steps. A refusal rejects its own call and leaves the queue running.
let queue_tail: Promise<unknown> = Promise.resolve();
let last_sent_at = Number.NEGATIVE_INFINITY;

export function send_key_queued(doc: KeyTargetDocument, args: SendKeyArgs, make_event: (type: string, init: KeyboardEventInit) => Event): Promise<void> {
  const times = args.times ?? 1;
  if (times > SEND_KEY_MAX_TIMES) return Promise.reject(new RuntimeRefusal(`A count of ${times} is over the limit of ${SEND_KEY_MAX_TIMES} for page.send_key`));
  const run = async () => {
    for (let sent = 0; sent < times; sent++) {
      // Capped at one gap, so a clock that jumps back cannot stall the queue.
      const wait_ms = Math.min(last_sent_at + KEY_PAIR_GAP_MS - Date.now(), KEY_PAIR_GAP_MS);
      if (wait_ms > 0) await new Promise((resolve) => setTimeout(resolve, wait_ms));
      last_sent_at = Date.now();
      send_key(doc, args, make_event);
    }
  };
  const result = queue_tail.then(run);
  queue_tail = result.catch(() => undefined);
  return result;
}
