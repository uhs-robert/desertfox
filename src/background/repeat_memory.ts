// The request `.` replays, in `storage.session` so a background restart keeps it. A private window has its own slot, cleared when the last private window closes.

import type { BoundInvocation } from "../shared/invocation.ts";
import { REPEAT_PRIVATE_STORAGE_KEY, REPEAT_STORAGE_KEY } from "./storage_keys.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

export type RepeatMemory = {
  save: (invocations: BoundInvocation[], is_private: boolean) => Promise<void>;
  load: (is_private: boolean) => Promise<BoundInvocation[] | undefined>;
};

// `in_turn` runs a job in the queue that owns every write to the slot. The job gets the memory without its own queueing, because a write inside a job must not wait for the job itself.
export type QueuedRepeatMemory = RepeatMemory & {
  in_turn: <Result>(job: (unqueued: RepeatMemory) => Promise<Result>) => Promise<Result>;
  clear_private_without_window: () => Promise<void>;
};

export const no_repeat_memory: RepeatMemory = { save: async () => undefined, load: async () => undefined };

const slot_key = (is_private: boolean) => (is_private ? REPEAT_PRIVATE_STORAGE_KEY : REPEAT_STORAGE_KEY);

// Every write goes through one queue, entered before the job's first await. So the last key press wins, a `.` typed next waits for the write,
// and a private write cannot land after the clear. The window check runs inside the job, so a window that just opened keeps its slot.
export function create_repeat_memory(storage: SessionStorage, has_private_window: () => Promise<boolean> = async () => true): QueuedRepeatMemory {
  let queue: Promise<unknown> = Promise.resolve();
  const in_turn = <Result>(job: () => Promise<Result>): Promise<Result> => {
    const turn = queue.then(job, job);
    queue = turn.catch(() => undefined);
    return turn;
  };
  const unqueued: RepeatMemory = {
    save: async (invocations, is_private) => {
      // A private command that finishes after its last window closed must not outlive it.
      if (is_private && !(await has_private_window())) return;
      await storage.set({ [slot_key(is_private)]: invocations });
    },
    load: async (is_private) => {
      const stored = (await storage.get(slot_key(is_private)))[slot_key(is_private)];
      return Array.isArray(stored) ? (stored as BoundInvocation[]) : undefined;
    },
  };
  return {
    in_turn: (job) => in_turn(() => job(unqueued)),
    save: (invocations, is_private) => in_turn(() => unqueued.save(invocations, is_private)),
    load: (is_private) => in_turn(() => unqueued.load(is_private)),
    clear_private_without_window: () =>
      in_turn(async () => {
        if (await has_private_window()) return;
        await storage.remove(REPEAT_PRIVATE_STORAGE_KEY);
      }),
  };
}

// A key binding's prompt and label are not part of what ran.
export const as_stored = ({ id, args, count }: BoundInvocation): BoundInvocation => ({ id, ...(args === undefined ? {} : { args }), ...(count === undefined ? {} : { count }) });
