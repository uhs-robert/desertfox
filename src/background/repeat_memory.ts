// The request `.` replays, in `storage.session` so a background restart keeps it. A private window has its own slot.

import type { CommandDef } from "../shared/command.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import type { CheckedArgs } from "../shared/command.ts";
import { check_args, type EnumSources } from "../shared/registry/check_args.ts";
import { REPEAT_PRIVATE_STORAGE_KEY, REPEAT_STORAGE_KEY } from "./storage_keys.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set">;

export type RepeatMemory = {
  save: (invocations: BoundInvocation[], is_private: boolean) => Promise<void>;
  load: (is_private: boolean) => Promise<BoundInvocation[] | undefined>;
};

export const no_repeat_memory: RepeatMemory = { save: async () => undefined, load: async () => undefined };

const slot_key = (is_private: boolean) => (is_private ? REPEAT_PRIVATE_STORAGE_KEY : REPEAT_STORAGE_KEY);

export function create_repeat_memory(storage: SessionStorage): RepeatMemory {
  return {
    save: (invocations, is_private) => storage.set({ [slot_key(is_private)]: invocations }),
    load: async (is_private) => {
      const stored = (await storage.get(slot_key(is_private)))[slot_key(is_private)];
      return Array.isArray(stored) ? (stored as BoundInvocation[]) : undefined;
    },
  };
}

// A key binding's prompt and label are not part of what ran.
export const as_stored = ({ id, args, count }: BoundInvocation): BoundInvocation => ({ id, ...(args === undefined ? {} : { args }), ...(count === undefined ? {} : { count }) });

// What a page script may record: one content command with checked args, which is the hint start. The page already
// sends `run` messages, so this adds no reach, but the slot must hold only what the router would accept.
export function page_record(message: unknown, get_command: (id: string) => CommandDef | undefined, sources: EnumSources): BoundInvocation | undefined {
  const invocation = (message as { invocation?: { id?: unknown; args?: unknown } } | undefined)?.invocation;
  if (typeof invocation?.id !== "string") return undefined;
  const command = get_command(invocation.id);
  if (command?.runs_in !== "content" || command.repeatable === false) return undefined;
  const args = invocation.args;
  if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) return undefined;
  const checked = check_args(command, args as Record<string, unknown> | undefined, sources);
  return checked.ok ? { id: command.id, args: checked.args as CheckedArgs } : undefined;
}
