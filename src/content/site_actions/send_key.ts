import { RuntimeRefusal } from "../../shared/command.ts";
import { SEND_KEY_MAX_TIMES, UNTIL_STABLE_MAX_PRESSES, UNTIL_STABLE_PAUSE_MS, UNTIL_STABLE_RETRIES } from "../../shared/send_key_limit.ts";
import { keep_chain } from "../../shared/swallow.ts";

export type SendKeyArgs = { key: string; key_code: number; target?: string; times?: number; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean; keypress?: boolean; focus?: boolean; until_stable?: boolean };

// What the handler needs from the page, so a test can pass a fake.
export type KeyTargetDocument = { querySelector(selector: string): EventTarget | null; activeElement: EventTarget | null };

// The validator hands an omitted optional string over as "", so "" means no target.
export function key_target(doc: KeyTargetDocument, selector: string | undefined): EventTarget {
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
// Answers whether the page left the keydown alone, as `dispatchEvent` does.
export function send_key(doc: KeyTargetDocument, args: SendKeyArgs, make_event: (type: string, init: KeyboardEventInit) => Event): boolean {
  const element = key_target(doc, args.target);
  if (args.focus === true) (element as HTMLElement).focus();
  const init = { key: args.key, keyCode: args.key_code, ctrlKey: args.ctrl === true, shiftKey: args.shift === true, altKey: args.alt === true, metaKey: args.meta === true, bubbles: true, cancelable: true, composed: true };
  const keydown_kept = element.dispatchEvent(make_event("keydown", init));
  // A page that cancels the keydown gets no keypress, as with a real key. A printable key carries its character code, which keypress handlers read.
  if (args.keypress === true && keydown_kept) element.dispatchEvent(make_event("keypress", args.key.length === 1 ? { ...init, charCode: args.key.charCodeAt(0), which: args.key.charCodeAt(0) } : init));
  element.dispatchEvent(make_event("keyup", init));
  return keydown_kept;
}

// Sheets applies only the first of several key pairs that arrive in the same millisecond. Pairs 4 ms apart all land, and 10 ms leaves margin.
export const KEY_PAIR_GAP_MS = 10;

// One queue per page, shared by key sends and clipboard actions, so `l l x` cuts the range after both arrows. A call is one entry, so all its pairs go out before the next call starts: a count never has another key land between its steps. A refusal rejects its own call and leaves the queue running.
let queue_tail: Promise<unknown> = Promise.resolve();
let last_sent_at = Number.NEGATIVE_INFINITY;

// Waits out the rest of the gap since the last send, then stamps now as the last send.
export async function wait_for_gap(): Promise<void> {
  // Capped at one gap, so a clock that jumps back cannot stall the queue.
  const wait_ms = Math.min(last_sent_at + KEY_PAIR_GAP_MS - Date.now(), KEY_PAIR_GAP_MS);
  if (wait_ms > 0) await new Promise((resolve) => setTimeout(resolve, wait_ms));
  last_sent_at = Date.now();
}

export function queued_in_page<T>(task: () => Promise<T>): Promise<T> {
  const result = queue_tail.then(async () => (await wait_for_gap(), task()));
  queue_tail = keep_chain(result);
  return result;
}

// A count prefix replaces `times` after the validator has checked it, so the limit is checked again here, before a long count takes the queue. The check is synchronous, so a call that passes takes its place in the queue in the caller's turn.
export const refused_times = (times: number, id: string): Promise<never> | undefined =>
  times > SEND_KEY_MAX_TIMES ? Promise.reject(new RuntimeRefusal(`A count of ${times} is over the limit of ${SEND_KEY_MAX_TIMES} for ${id}`)) : undefined;


// A page that draws only the items near the view replaces an item's element as it scrolls, so a focused item counts by its data-id where it has one.
const focus_mark = (doc: KeyTargetDocument): unknown => (doc.activeElement as Element | null)?.getAttribute("data-id") || doc.activeElement;

// The pause after each press, so the page can move its selection, scroll and draw. A timer and not the next frame, because a hidden tab draws no frames and the run would stall there.
export const pause_after_press = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, UNTIL_STABLE_PAUSE_MS));

export function send_key_queued(doc: KeyTargetDocument, args: SendKeyArgs, make_event: (type: string, init: KeyboardEventInit) => Event, pressed_keys: () => number, wait: () => Promise<void>): Promise<void> {
  // Presses until the focus stops moving: the end of a list that only the page's own keys can reach. Any key the user presses ends the run.
  if (args.until_stable)
    return queued_in_page(async () => {
      const keys_at_start = pressed_keys();
      let unchanged = 0;
      for (let press = 0; press < UNTIL_STABLE_MAX_PRESSES && unchanged <= UNTIL_STABLE_RETRIES && pressed_keys() === keys_at_start; press++) {
        const before = focus_mark(doc);
        send_key(doc, args, make_event);
        await wait();
        unchanged = focus_mark(doc) === before ? unchanged + 1 : 0;
      }
    });
  const times = args.times ?? 1;
  return (
    refused_times(times, "page.send_key") ??
    queued_in_page(async () => {
      for (let sent = 0; sent < times; sent++) {
        if (sent > 0) await wait_for_gap();
        send_key(doc, args, make_event);
      }
    })
  );
}
