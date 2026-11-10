// The request `.` replays, in `storage.session` so a background restart keeps it. A private window has its own slot, cleared when the last private window closes.

import type { BoundInvocation } from "../shared/invocation.ts";
import { REPEAT_PRIVATE_STORAGE_KEY, REPEAT_STORAGE_KEY } from "./storage_keys.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

export type RepeatMemory = {
  save: (invocations: BoundInvocation[], is_private: boolean) => Promise<void>;
  load: (is_private: boolean) => Promise<BoundInvocation[] | undefined>;
};

// `track` lets a caller register a write that has not reached `save` yet, so a `load` right after it waits for the write.
export type TrackedRepeatMemory = RepeatMemory & { track: (write: Promise<unknown>) => void; clear_private: () => Promise<void> };

export const no_repeat_memory: RepeatMemory = { save: async () => undefined, load: async () => undefined };

const slot_key = (is_private: boolean) => (is_private ? REPEAT_PRIVATE_STORAGE_KEY : REPEAT_STORAGE_KEY);

export function create_repeat_memory(storage: SessionStorage): TrackedRepeatMemory {
  // A page record is sent after the command ran and can still be in flight when the next key asks for the slot.
  let pending: Promise<unknown> = Promise.resolve();
  return {
    track: (write) => void (pending = Promise.all([pending, write.catch(() => undefined)])),
    save: (invocations, is_private) => storage.set({ [slot_key(is_private)]: invocations }),
    clear_private: async () => {
      await pending;
      await storage.remove(REPEAT_PRIVATE_STORAGE_KEY);
    },
    load: async (is_private) => {
      await pending;
      const stored = (await storage.get(slot_key(is_private)))[slot_key(is_private)];
      return Array.isArray(stored) ? (stored as BoundInvocation[]) : undefined;
    },
  };
}

// A key binding's prompt and label are not part of what ran.
export const as_stored = ({ id, args, count }: BoundInvocation): BoundInvocation => ({ id, ...(args === undefined ? {} : { args }), ...(count === undefined ? {} : { count }) });

// A private command must not outlive the private session. Firefox deletes private data when the last private window closes, so the slot goes with it.
export async function forget_private_slot_when_last_window_closes(
  memory: Pick<TrackedRepeatMemory, "clear_private">,
  windows: { getAll: () => Promise<{ incognito: boolean }[]> },
): Promise<void> {
  if ((await windows.getAll()).some((window) => window.incognito)) return;
  await memory.clear_private();
}
