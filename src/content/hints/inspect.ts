// The `inspect` action: leaves the picked element on the page window for the devtools page, which selects it in the Inspector and deletes the property.

import type { Outcome } from "../../shared/messages.ts";
import { PICK_EXPIRY_MS, TOOLBOX_CLOSED_MESSAGE } from "../../shared/inspect.ts";
import type { InspectAnswer } from "../../shared/inspect.ts";

// The devtools page evals a constant string that reads this name, so it must not change on its own.
const PICK_PROPERTY = "__desertfox_pick";

type PickWindow = { wrappedJSObject: Record<string, unknown>; top: unknown };

export function hand_to_devtools(win: PickWindow & object, element: Element, send_pick: () => Promise<InspectAnswer | undefined>, later: (action: () => void, ms: number) => void, show_notice: (message: string) => void): Promise<Outcome> {
  // The eval of the devtools page runs in the top window, and a script in a frame sets the property on its own.
  if (win.top !== win) return Promise.resolve({ ok: false, message: "Inspect works from the top page only" });
  const page = win.wrappedJSObject;
  const drop = () => void delete page[PICK_PROPERTY];
  page[PICK_PROPERTY] = element;
  later(() => {
    if (page[PICK_PROPERTY] === element) drop();
  }, PICK_EXPIRY_MS);
  return send_pick().then(
    (outcome) => {
      if (!outcome) drop();
      if (outcome?.ok && outcome.waiting) {
        // A queued pick is accepted, so it answers ok and a key sequence goes on.
        show_notice(TOOLBOX_CLOSED_MESSAGE);
        return { ok: true };
      }
      return outcome ?? { ok: false, message: "The inspect action got no answer" };
    },
    () => {
      drop();
      return { ok: false, message: "Could not reach DevTools" };
    },
  );
}
