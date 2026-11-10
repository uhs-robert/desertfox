// Hands a held key back to the page, and the guards that keep our own listeners off the events it makes.
import type { create_cancelled_keys, HeldPress } from "./cancelled_keys.ts";

type KeyFields = Pick<KeyboardEvent, "key" | "code" | "location" | "repeat" | "keyCode" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">;
type Dispatcher = { dispatchEvent: (event: Event) => boolean; isConnected?: boolean };
type CancelledKeys = ReturnType<typeof create_cancelled_keys>;

// The element the key was pressed on. A shadow tree makes event.target its host, and the path is empty once the event has finished, so read this during the keydown.
export const press_target = (event: Pick<Event, "target" | "composedPath">): EventTarget | null => event.composedPath()[0] ?? event.target;

// A synthetic keydown on the original element, and a keyup when the real one was already swallowed. A key still down gets its real keyup. An element that left the page cannot take the key, and no other element is a better target. A synthetic event cannot start a default action such as scrolling.
export function replay_key_to_page(
  event: KeyFields,
  target: Dispatcher,
  press: HeldPress,
  cancelled_keys: CancelledKeys,
  make_event: (type: string, init: KeyboardEventInit) => Event,
): void {
  const keyup_swallowed = cancelled_keys.release_for_replay_(event.code, press);
  if (target.isConnected === false) return;
  const init: KeyboardEventInit = {
    key: event.key, code: event.code, location: event.location, repeat: event.repeat, keyCode: event.keyCode,
    ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
    bubbles: true, cancelable: true, composed: true,
  };
  target.dispatchEvent(make_event("keydown", init));
  if (keyup_swallowed) target.dispatchEvent(make_event("keyup", init));
}

// Only a real key press has a cancelled code. The synthetic events of a replay, a page or an extension must not read or clear one.
export const cancels_keypress = (event: Pick<KeyboardEvent, "isTrusted" | "code">, cancelled_keys: CancelledKeys): boolean =>
  event.isTrusted && cancelled_keys.cancels_keypress_(event.code);
export const cancels_keyup = (event: Pick<KeyboardEvent, "isTrusted" | "code">, cancelled_keys: CancelledKeys): boolean =>
  event.isTrusted && cancelled_keys.take_keyup_(event.code);
