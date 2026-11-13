// Hands a hint pick to the devtools page of the picked tab. A devtools page connects when its toolbox opens and names its tab, so the ports are kept by tab id. A pick that finds no port waits in `storage.session` and goes out when the page connects.

import type { DevtoolsPick } from "../shared/messages.ts";
import { PICK_EXPIRY_MS } from "../shared/inspect.ts";
import type { InspectAnswer } from "../shared/inspect.ts";
import { INSPECT_PENDING_STORAGE_KEY } from "./storage_keys.ts";
import { keep_chain } from "../shared/swallow.ts";

export type RelayPort = { postMessage: (message: DevtoolsPick) => void };

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set">;

type Pending = Record<string, number>;

const PICK: DevtoolsPick = { type: "devtools_pick" };

export function create_inspect_relay(storage: SessionStorage, now: () => number) {
  // Only the ports are in memory: a restarted background gets them back when the devtools pages reconnect.
  const ports = new Map<number, RelayPort>();
  // Updates run one after another, so a pick and a drain cannot overwrite each other's read.
  let queue: Promise<unknown> = Promise.resolve();

  const update = <T>(change: (pending: Pending) => { pending: Pending; result: T }): Promise<T> => {
    const run = queue.then(async () => {
      const stored = (await storage.get(INSPECT_PENDING_STORAGE_KEY))[INSPECT_PENDING_STORAGE_KEY];
      const fresh = Object.entries(stored && typeof stored === "object" ? (stored as Pending) : {}).filter(([, at]) => typeof at === "number" && now() - at < PICK_EXPIRY_MS);
      const { pending, result } = change(Object.fromEntries(fresh));
      await storage.set({ [INSPECT_PENDING_STORAGE_KEY]: pending });
      return result;
    });
    queue = keep_chain(run);
    return run;
  };

  const without = (pending: Pending, tab_id: number): Pending => Object.fromEntries(Object.entries(pending).filter(([id]) => id !== String(tab_id)));

  return {
    // Sends the pick to the tab's open toolbox, or keeps it for 60 s.
    pick(tab_id: number): Promise<InspectAnswer> {
      const port = ports.get(tab_id);
      if (port) {
        try {
          port.postMessage(PICK);
          return Promise.resolve({ ok: true });
        } catch {
          ports.delete(tab_id);
        }
      }
      return update((pending) => ({ pending: { ...pending, [tab_id]: now() }, result: { ok: true, waiting: true } as InspectAnswer }));
    },

    // The devtools page of `tab_id` is up. A fresh pick that waited goes out now, and an expired one is dropped.
    connected(tab_id: number, port: RelayPort, on_disconnect: (listener: () => void) => void): Promise<void> {
      ports.set(tab_id, port);
      // A stale port's late disconnect must not remove the port that replaced it.
      on_disconnect(() => {
        if (ports.get(tab_id) === port) ports.delete(tab_id);
      });
      return update((pending) => {
        if (pending[tab_id] === undefined) return { pending, result: undefined };
        try {
          port.postMessage(PICK);
        } catch {
          return { pending, result: undefined };
        }
        return { pending: without(pending, tab_id), result: undefined };
      });
    },

    // A navigation or a closed tab: the picked element is gone, so the pick is too.
    forget(tab_id: number): Promise<void> {
      return update((pending) => ({ pending: without(pending, tab_id), result: undefined }));
    },
  };
}
