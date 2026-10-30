// The mode each tab last reported, kept in storage so a restarted background still knows it.

import type { CommandDef, Mode } from "../shared/command.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import { TAB_MODE_STORAGE_PREFIX } from "./storage_keys.ts";

type ModeStorage = Pick<typeof browser.storage.local, "get" | "set" | "remove">;

const key_of = (tab_id: number): string => TAB_MODE_STORAGE_PREFIX + tab_id;

export async function remember_tab_mode(storage: ModeStorage, tab_id: number, mode: Mode): Promise<void> {
  await storage.set({ [key_of(tab_id)]: mode });
}

export async function forget_tab_mode(storage: ModeStorage, tab_id: number): Promise<void> {
  await storage.remove(key_of(tab_id));
}

// A tab that never reported a mode is in normal mode.
export async function recall_tab_mode(storage: ModeStorage, tab_id: number): Promise<Mode> {
  const stored = await storage.get(key_of(tab_id));
  return (stored[key_of(tab_id)] as Mode | undefined) ?? "normal";
}

// In ignore mode a shortcut runs only if its commands can run there, which is how a binding leaves ignore mode.
export function shortcut_allowed(mode: Mode, invocations: BoundInvocation[], get_command: (id: string) => Pick<CommandDef, "modes"> | undefined): boolean {
  if (mode !== "ignore") return true;
  return invocations.every((invocation) => get_command(invocation.id)?.modes?.includes("ignore"));
}
