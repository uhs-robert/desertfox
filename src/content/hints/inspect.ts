// The `inspect` action: leaves the picked element on the page window for the devtools page, which selects it in the Inspector and deletes the property.

import type { Outcome } from "../../shared/messages.ts";

// The devtools page evals a constant string that reads this name, so it must not change on its own.
const PICK_PROPERTY = "__desertfox_pick";

// A pick that never gets selected (no toolbox, an expired queue) must not stay on the page. The background drops its pick after the same time.
const LEAVE_MS = 60_000;

type PickWindow = { wrappedJSObject: Record<string, unknown>; top: unknown };

export function hand_to_devtools(win: PickWindow & object, element: Element, send_pick: () => Promise<Outcome | undefined>, later: (action: () => void, ms: number) => void): Promise<Outcome> {
  // The eval of the devtools page runs in the top window, and a script in a frame sets the property on its own.
  if (win.top !== win) return Promise.resolve({ ok: false, message: "Inspect works from the top page only" });
  const page = win.wrappedJSObject;
  const drop = () => void delete page[PICK_PROPERTY];
  page[PICK_PROPERTY] = element;
  later(() => {
    if (page[PICK_PROPERTY] === element) drop();
  }, LEAVE_MS);
  return send_pick().then(
    (outcome) => {
      if (!outcome) drop();
      return outcome ?? { ok: false, message: "The inspect action got no answer" };
    },
    () => {
      drop();
      return { ok: false, message: "Could not reach DevTools" };
    },
  );
}
